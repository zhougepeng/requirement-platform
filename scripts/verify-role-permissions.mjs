import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3313;
const baseUrl = `http://127.0.0.1:${port}`;
const sessionSecret = randomBytes(32).toString("base64url");
const dataDir = await mkdtemp(path.join(tmpdir(), "requirement-platform-permissions-"));

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sessionCookie(openId, name) {
  const payload = Buffer.from(JSON.stringify({ openId, name, expiresAt: Date.now() + 60_000 })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return `requirement_platform_session=${payload}.${signature}`;
}

async function request(pathname, openId, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Cookie", sessionCookie(openId, openId));
  return fetch(`${baseUrl}${pathname}`, {
    redirect: "manual",
    ...options,
    headers,
  });
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/login`);
      if (response.status === 200) return;
    } catch {
      // 服务进程仍在启动，继续等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("权限测试服务未能在 10 秒内启动。");
}

const timestamp = "2026-08-27 12:00";
const employee = (openId, role) => ({
  id: `employee_${openId}`,
  openId,
  name: openId,
  departmentNames: [],
  role,
  enabled: role !== "none",
  isAdmin: role === "admin",
  directoryActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});

await writeFile(path.join(dataDir, "employees.local.json"), JSON.stringify({
  schemaVersion: 1,
  employees: [employee("viewer", "viewer"), employee("publisher", "publisher"), employee("admin", "admin")],
}), "utf8");

const server = spawn(process.execPath, ["server.js"], {
  cwd: path.join(projectRoot, ".next", "standalone"),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    AUTH_MODE: "feishu",
    AUTH_COOKIE_SECURE: "false",
    APP_BASE_URL: baseUrl,
    AUTH_SESSION_SECRET: sessionSecret,
    REQUIREMENT_PLATFORM_DATA_DIR: dataDir,
    REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR: path.join(dataDir, "published-demos"),
  },
  stdio: "ignore",
});

async function stopServer() {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
}

try {
  await waitUntilReady();

  expect((await request("/api/v1/projects", "viewer")).status === 200, "查看角色无法读取项目列表。");
  const assistantResponse = await request("/api/v1/assistant", "viewer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "knowledge-base", question: "测试" }) });
  expect(assistantResponse.status !== 401 && assistantResponse.status !== 403, `查看角色被错误拒绝使用 AI 助手（HTTP ${assistantResponse.status}）。`);
  expect((await request("/api/v1/projects", "viewer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "VIEWER", name: "禁止创建", description: "" }) })).status === 403, "查看角色错误获得发布权限。");

  expect((await request("/api/v1/projects", "publisher", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "PUB", name: "发布测试项目", description: "" }) })).status === 201, "发布角色无法创建项目。");
  expect((await request("/api/v1/admin/employees", "publisher")).status === 403, "发布角色错误获得管理员权限。");

  expect((await request("/api/v1/admin/employees", "admin")).status === 200, "管理角色无法读取员工权限。");
  expect((await request("/api/v1/models", "admin")).status === 200, "管理角色无法读取模型管理。");

  console.log("权限回归测试通过：查看可读和使用 AI、发布可创建项目、管理可进入管理员接口，越权请求均被拒绝。");
} finally {
  await stopServer();
  await rm(dataDir, { recursive: true, force: true });
}
