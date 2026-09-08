import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { RequirementRuntime } from "@/lib/types";
import { getRequirementVersionRuntimeContext, publishedDemoDirectory } from "@/services/requirement/local-store";

const DEFAULT_PORT_START = 41000;
const DEFAULT_PORT_END = 41999;
const START_TIMEOUT_MS = 30_000;
const HEALTH_INTERVAL_MS = 400;
const MAX_LOG_BYTES = 64 * 1024;
const execFileAsync = promisify(execFile);

type RuntimeState = "starting" | "running" | "stopped" | "failed";

type RuntimeRecord = {
  key: string;
  projectCode: string;
  requirementCode: string;
  versionNo: number;
  runtime: RequirementRuntime;
  port: number;
  state: RuntimeState;
  startedAt?: string;
  stoppedAt?: string;
  error?: string;
  child?: ChildProcess;
  logs: string;
};

const records = new Map<string, RuntimeRecord>();
const starting = new Map<string, Promise<RuntimeStatus>>();
const usedPorts = new Set<number>();
let nextPort = Number(process.env.REQUIREMENT_PLATFORM_RUNTIME_PORT_START) || DEFAULT_PORT_START;
const portEnd = Number(process.env.REQUIREMENT_PLATFORM_RUNTIME_PORT_END) || DEFAULT_PORT_END;

export type RuntimeStatus = {
  key: string;
  projectCode: string;
  requirementCode: string;
  versionNo: number;
  state: RuntimeState;
  port?: number;
  sourcePort: number;
  healthPath: string;
  startedAt?: string;
  stoppedAt?: string;
  error?: string;
  logs: string;
};

function keyFor(requirementCode: string, versionNo: number) {
  return `${requirementCode}:v${versionNo}`;
}

function statusOf(record: RuntimeRecord): RuntimeStatus {
  return {
    key: record.key,
    projectCode: record.projectCode,
    requirementCode: record.requirementCode,
    versionNo: record.versionNo,
    state: record.state,
    ...(record.port ? { port: record.port } : {}),
    sourcePort: record.runtime.port,
    healthPath: record.runtime.healthPath,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
    error: record.error,
    logs: record.logs.slice(-MAX_LOG_BYTES),
  };
}

function appendLog(record: RuntimeRecord, chunk: unknown) {
  const value = String(chunk);
  record.logs = `${record.logs}${value}`.slice(-MAX_LOG_BYTES);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function allocatePort() {
  const start = Math.max(DEFAULT_PORT_START, nextPort, Number(process.env.REQUIREMENT_PLATFORM_RUNTIME_PORT_START) || DEFAULT_PORT_START);
  const end = Math.max(start, portEnd);
  for (let offset = 0; offset <= end - start; offset += 1) {
    const candidate = start + offset;
    nextPort = candidate + 1 > end ? start : candidate + 1;
    if (usedPorts.has(candidate)) continue;
    if (await isPortAvailable(candidate)) {
      usedPorts.add(candidate);
      return candidate;
    }
  }
  throw new Error("没有可用的 Demo 运行端口，请调整 REQUIREMENT_PLATFORM_RUNTIME_PORT_START/END。");
}

function releasePort(port: number | undefined) {
  if (port) usedPorts.delete(port);
}

function runtimeEnvironment(port: number, command: RequirementRuntime["command"]) {
  // Never pass the requirement platform's secrets or tokens into uploaded
  // application code. Keep only process/runtime variables needed by npm and
  // the OS to launch a local HTTP server.
  const allowed = new Set(["PATH", "Path", "PATHEXT", "ComSpec", "SystemRoot", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL"]);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key) && typeof key === "string" && typeof process.env[key] === "string"));
  return {
    ...environment,
    NODE_ENV: command === "npm-dev" ? "development" : "production",
    HOST: "127.0.0.1",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    BROWSER: "none",
  };
}

function npmInvocation(command: RequirementRuntime["command"], script: string, demoRoot: string) {
  const directNode = /^node(?:\.exe)?\s+([^\s;&|<>]+)$/i.exec(script.trim());
  if (directNode && !directNode[1].startsWith("-")) {
    const entry = path.resolve(demoRoot, directNode[1].replaceAll("\\", "/"));
    if (entry.startsWith(`${demoRoot}${path.sep}`) && existsSync(entry)) return { executable: process.execPath, argumentsList: [entry] };
  }
  const argumentsList = command === "npm-dev" ? ["run", "dev"] : ["start"];
  if (process.platform !== "win32") return { executable: "npm", argumentsList };
  // Windows cannot spawn .cmd files with shell:false. Invoke npm's own CLI
  // through the trusted Node executable instead of falling back to cmd.exe.
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) throw new Error("运行节点缺少 npm CLI，无法启动 Demo。");
  return { executable: process.execPath, argumentsList: [npmCli, ...argumentsList] };
}

function markStopped(record: RuntimeRecord, state: RuntimeState, error?: string) {
  record.state = state;
  record.stoppedAt = new Date().toISOString();
  if (error) record.error = error;
  releasePort(record.port);
  record.child = undefined;
}

async function waitForHealth(record: RuntimeRecord) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  const url = `http://127.0.0.1:${record.port}${record.runtime.healthPath}`;
  while (Date.now() < deadline) {
    if (!record.child || record.child.exitCode !== null) throw new Error("Demo 进程在健康检查通过前退出。\n" + record.logs.slice(-4000));
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1500) });
      if (response.status >= 200 && response.status < 400) return;
    } catch {
      // The child may need a few seconds to bind its port.
    }
    await delay(HEALTH_INTERVAL_MS);
  }
  throw new Error(`Demo 运行实例在 ${START_TIMEOUT_MS / 1000} 秒内未通过健康检查：${record.runtime.healthPath}\n${record.logs.slice(-4000)}`);
}

async function stopRecord(record: RuntimeRecord) {
  if (!record.child || record.state === "stopped" || record.state === "failed") {
    markStopped(record, "stopped");
    return statusOf(record);
  }
  const child = record.child;
  if (process.platform === "win32" && child.pid) {
    try {
      await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 5000, windowsHide: true });
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([new Promise<void>((resolve) => child.once("close", () => resolve())), delay(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
  markStopped(record, "stopped");
  return statusOf(record);
}

async function stopOtherVersions(requirementCode: string, keepKey: string) {
  const pending = [...records.values()]
    .filter((record) => record.requirementCode === requirementCode && record.key !== keepKey && (record.state === "running" || record.state === "starting"))
    .map((record) => stopRecord(record));
  await Promise.allSettled(pending);
}

async function startRecord(requirementCode: string, versionNo: number): Promise<RuntimeStatus> {
  if (process.env.REQUIREMENT_PLATFORM_ENABLE_DEMO_RUNTIME !== "true") throw new Error("需求库运行态 Demo 尚未启用，请先设置 REQUIREMENT_PLATFORM_ENABLE_DEMO_RUNTIME=true。");
  const context = await getRequirementVersionRuntimeContext(requirementCode, versionNo);
  const runtime = context.version.runtime;
  if (!runtime || context.version.demoEntryUrl !== `/demo-runtime/${context.projectCode}/${requirementCode}/v${versionNo}/`) throw new Error("该版本没有可启动的 Demo 运行配置。");
  const demoRoot = path.join(publishedDemoDirectory(context.projectCode, requirementCode, versionNo), "demo");
  const packageFile = path.join(demoRoot, "package.json");
  try {
    await stat(packageFile);
  } catch {
    throw new Error("运行态 Demo 缺少 demo/package.json，无法安全启动。");
  }
  let script = "";
  try {
    const packageJson = JSON.parse(await readFile(packageFile, "utf8")) as { scripts?: { start?: unknown; dev?: unknown } };
    const configuredScript = runtime.command === "npm-dev" ? packageJson.scripts?.dev : packageJson.scripts?.start;
    if (typeof configuredScript !== "string" || !configuredScript.trim()) throw new Error(`demo/package.json 缺少 ${runtime.command === "npm-dev" ? "dev" : "start"} 脚本，无法安全启动。`);
    script = configuredScript.trim();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "demo/package.json 无法读取，无法安全启动。");
  }
  const port = await allocatePort();
  const record: RuntimeRecord = {
    key: keyFor(requirementCode, versionNo),
    projectCode: context.projectCode,
    requirementCode,
    versionNo,
    runtime,
    port,
    state: "starting",
    startedAt: new Date().toISOString(),
    logs: "",
  };
  records.set(record.key, record);
  const invocation = npmInvocation(runtime.command, script, demoRoot);
  const child = spawn(/* turbopackIgnore: true */ invocation.executable, invocation.argumentsList, {
    cwd: demoRoot,
    env: runtimeEnvironment(port, runtime.command) as NodeJS.ProcessEnv,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcess;
  record.child = child;
  child.stdout?.on("data", (chunk: Buffer) => appendLog(record, chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendLog(record, chunk));
  child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
    if (record.state === "running" || record.state === "starting") {
      markStopped(record, "failed", `Demo 进程已退出（code=${code ?? "-"}, signal=${signal ?? "-"}）。`);
    }
  });
  try {
    await waitForHealth(record);
    record.state = "running";
    // Keep the previous version alive until the new one passes health checks;
    // a failed rollout therefore leaves the last working Demo available.
    await stopOtherVersions(requirementCode, record.key);
    return statusOf(record);
  } catch (error) {
    await stopRecord(record);
    record.state = "failed";
    record.error = error instanceof Error ? error.message : "Demo 启动失败。";
    throw new Error(record.error);
  }
}

export async function ensureRequirementRuntime(requirementCode: string, versionNo: number) {
  const key = keyFor(requirementCode, versionNo);
  const existing = records.get(key);
  if (existing?.state === "running") return statusOf(existing);
  const pending = starting.get(key);
  if (pending) return pending;
  const promise = startRecord(requirementCode, versionNo);
  starting.set(key, promise);
  try {
    return await promise;
  } finally {
    starting.delete(key);
  }
}

export async function stopRequirementRuntime(requirementCode: string, versionNo: number) {
  const record = records.get(keyFor(requirementCode, versionNo));
  if (!record) {
    const context = await getRequirementVersionRuntimeContext(requirementCode, versionNo);
    if (!context.version.runtime) throw new Error("该版本没有可启动的 Demo 运行配置。");
    return { key: keyFor(requirementCode, versionNo), projectCode: context.projectCode, requirementCode, versionNo, state: "stopped" as const, sourcePort: context.version.runtime.port, healthPath: context.version.runtime.healthPath, logs: "" } satisfies RuntimeStatus;
  }
  return stopRecord(record);
}

export async function getRequirementRuntimeStatus(requirementCode: string, versionNo: number) {
  const record = records.get(keyFor(requirementCode, versionNo));
  if (record) return statusOf(record);
  const context = await getRequirementVersionRuntimeContext(requirementCode, versionNo);
  if (!context.version.runtime) throw new Error("该版本没有可启动的 Demo 运行配置。");
  return { key: keyFor(requirementCode, versionNo), projectCode: context.projectCode, requirementCode, versionNo, state: "stopped" as const, sourcePort: context.version.runtime.port, healthPath: context.version.runtime.healthPath, logs: "" } satisfies RuntimeStatus;
}

export function stopAllRequirementRuntimes() {
  for (const record of records.values()) {
    if (record.child && record.child.exitCode === null) record.child.kill("SIGTERM");
  }
}

process.once("exit", stopAllRequirementRuntimes);
