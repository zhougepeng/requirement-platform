import "server-only";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_API = "https://api.github.com/repos/zhougepeng/requirement-platform/releases/latest";
const INSTALLER_NAME = "requirement-platform-linux-x64.run";
const UPDATER_PATH = "/usr/local/sbin/requirement-platform-updater";
// A job stuck in "running" (crashed process, rebooted server) must not block
// future updates forever. After this long, report it as failed so the page can
// offer the update again.
const STALE_JOB_MS = 60 * 60 * 1000;

type GithubRelease = {
  tag_name?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
};

type UpdateMode = "installer" | "docker";

export type InstallerUpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  installerName: string;
  installerUrl: string;
  deployment: UpdateMode;
  target: string;
  environment: "linux" | "local";
  updateAvailable: boolean;
  canInstall: boolean;
  blockedReason?: string;
  job?: InstallerUpdateJob;
};

export type InstallerUpdateJob = {
  id: string;
  state: "running" | "success" | "failed";
  startedAt: string;
  finishedAt?: string;
  message?: string;
  installedVersion?: string;
};

function installRoot() {
  return process.env.REQUIREMENT_PLATFORM_INSTALL_DIR?.trim() || "/opt/requirement-platform";
}

function updateMode(): UpdateMode {
  return process.env.REQUIREMENT_PLATFORM_UPDATE_MODE?.trim().toLowerCase() === "docker" ? "docker" : "installer";
}

function dockerImage() {
  return process.env.REQUIREMENT_PLATFORM_DOCKER_IMAGE?.trim() || "ghcr.io/zhougepeng/requirement-platform";
}

function dockerVersionFile() {
  return process.env.REQUIREMENT_PLATFORM_DOCKER_VERSION_FILE?.trim() || join(process.cwd(), "VERSION");
}

function dockerDataDir() {
  return process.env.REQUIREMENT_PLATFORM_DATA_DIR?.trim() || join(process.cwd(), "data");
}

function dockerRequestFile() {
  return process.env.REQUIREMENT_PLATFORM_DOCKER_UPDATE_REQUEST_FILE?.trim() || join(dockerDataDir(), "update-request");
}

function dockerUpdateEnabled() {
  return process.env.REQUIREMENT_PLATFORM_DOCKER_UPDATE_ENABLED?.trim().toLowerCase() === "true";
}

function currentVersion() {
  if (updateMode() === "docker") {
    const configuredVersion = process.env.APP_VERSION?.trim();
    if (configuredVersion) return configuredVersion;
    try {
      const versionPath = dockerVersionFile();
      return existsSync(/* turbopackIgnore: true */ versionPath) ? readFileSync(/* turbopackIgnore: true */ versionPath, "utf8").trim() || "未知版本" : "未知版本";
    } catch {
      return "未知版本";
    }
  }
  const versionFile = join(installRoot(), "current", "VERSION");
  try {
    return existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() || "未知版本" : "开发环境";
  } catch {
    return "未知版本";
  }
}

function updateStatusFile() {
  return process.env.REQUIREMENT_PLATFORM_UPDATE_STATUS_FILE?.trim()
    || (updateMode() === "docker" ? join(dockerDataDir(), "update-status.json") : join(installRoot(), "update-status.json"));
}

function writeFileAtomically(filePath: string, contents: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = filePath + "." + process.pid + "." + randomUUID() + ".tmp";
  writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o644 });
  renameSync(temporaryPath, filePath);
}

function writeUpdateJob(job: InstallerUpdateJob) {
  writeFileAtomically(updateStatusFile(), JSON.stringify(job) + "\n");
}

function writeDockerUpdateRequest(version: string) {
  writeFileAtomically(dockerRequestFile(), version + "\n");
}

function readUpdateJob(): InstallerUpdateJob | undefined {
  try {
    const parsed = JSON.parse(readFileSync(updateStatusFile(), "utf8")) as Partial<InstallerUpdateJob>;
    if (!parsed.id || !parsed.startedAt || !parsed.state || !["running", "success", "failed"].includes(parsed.state)) return undefined;
    const job: InstallerUpdateJob = {
      id: String(parsed.id),
      state: parsed.state as InstallerUpdateJob["state"],
      startedAt: String(parsed.startedAt),
      ...(parsed.finishedAt ? { finishedAt: String(parsed.finishedAt) } : {}),
      ...(parsed.message ? { message: String(parsed.message) } : {}),
      ...(parsed.installedVersion ? { installedVersion: String(parsed.installedVersion) } : {}),
    };
    if (job.state === "running") {
      const startedAt = Date.parse(job.startedAt);
      if (!Number.isFinite(startedAt) || Date.now() - startedAt > STALE_JOB_MS) {
        return {
          ...job,
          state: "failed",
          finishedAt: new Date().toISOString(),
          message: "上一次更新任务没有正常结束，已自动解除占用，可以重新发起更新。",
        };
      }
    }
    return job;
  } catch {
    return undefined;
  }
}

function versionParts(value: string) {
  return value.replace(/^v/i, "").split(/[._-]/).map((item) => Number(item) || 0);
}

function hasNewerVersion(current: string, latest: string) {
  if (!/^v\d/.test(current) || !/^v\d/.test(latest)) return current !== latest;
  const left = versionParts(current);
  const right = versionParts(latest);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if ((right[index] || 0) !== (left[index] || 0)) return (right[index] || 0) > (left[index] || 0);
  }
  return false;
}

function isReleaseVersion(value: string) {
  return /^v[0-9][0-9A-Za-z._-]{0,63}$/.test(value);
}

async function latestRelease(mode: UpdateMode) {
  let response: Response;
  try {
    response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "requirement-platform-updater" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new Error("无法连接 GitHub Release，请确认服务器可以访问 github.com。");
  }
  if (!response.ok) throw new Error(`无法读取 GitHub Release（HTTP ${response.status}）。`);
  const release = (await response.json()) as GithubRelease;
  const version = release.tag_name?.trim();
  const asset = release.assets?.find((item) => item.name === INSTALLER_NAME);
  if (!version) throw new Error("最新 GitHub Release 缺少版本号。");
  if (!isReleaseVersion(version)) throw new Error("最新 GitHub Release 的版本号格式不受支持。");
  if (mode === "installer" && !asset?.browser_download_url) throw new Error("最新 GitHub Release 未包含 Linux 安装包。");
  return { version, installerUrl: asset?.browser_download_url || "" };
}

function updaterAvailable(mode: UpdateMode) {
  if (process.platform !== "linux") return false;
  if (mode === "docker") {
    if (!dockerUpdateEnabled()) return false;
    try {
      accessSync(dirname(dockerRequestFile()), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const stats = statSync(UPDATER_PATH);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export async function checkInstallerUpdate(): Promise<InstallerUpdateStatus> {
  const deployment = updateMode();
  const [current, release] = await Promise.all([Promise.resolve(currentVersion()), latestRelease(deployment)]);
  const job = readUpdateJob();
  const updateAvailable = hasNewerVersion(current, release.version);
  const localEnvironment = process.platform !== "linux";
  const blockedReason = localEnvironment
    ? "当前是本地开发环境，不能自动安装 Linux 服务包；可下载后在 Linux 服务器手动安装。"
    : job?.state === "running"
      ? "已有更新任务正在后台执行，请等待服务恢复后重新检查。"
      : !updaterAvailable(deployment)
      ? deployment === "docker"
        ? "当前 Docker 部署尚未接入主机更新桥接；请先配置共享数据目录和 Docker 更新助手。"
        : "当前安装包尚未包含自动更新助手；请先手动安装一次最新安装包，之后即可在页面内自动更新。"
      : undefined;
  return {
    currentVersion: current,
    latestVersion: release.version,
    installerName: INSTALLER_NAME,
    installerUrl: release.installerUrl,
    deployment,
    target: deployment === "docker" ? dockerImage() : INSTALLER_NAME,
    environment: localEnvironment ? "local" : "linux",
    updateAvailable,
    canInstall: updateAvailable && !blockedReason && job?.state !== "running",
    blockedReason,
    ...(job ? { job } : {}),
  };
}

export async function startInstallerUpdate() {
  const status = await checkInstallerUpdate();
  if (!status.updateAvailable) return { ...status, started: false };
  if (!status.canInstall) throw new Error(status.blockedReason || "当前无法自动安装更新。");
  if (status.deployment === "docker") {
    const job: InstallerUpdateJob = {
      id: Date.now().toString() + "-" + randomUUID(),
      state: "running",
      startedAt: new Date().toISOString(),
      message: "更新请求已提交，等待服务器拉取 Docker 镜像。",
    };
    try {
      writeUpdateJob(job);
      writeDockerUpdateRequest(status.latestVersion);
    } catch {
      throw new Error("无法提交 Docker 更新请求，请检查共享数据目录的写入权限。");
    }
    return { ...status, job, started: true };
  }
  try {
    await execFileAsync("sudo", ["-n", UPDATER_PATH, "--start"], { timeout: 15_000, maxBuffer: 64 * 1024 });
  } catch (error) {
    const details = error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr.trim().replace(/\s+/g, " ").slice(0, 240)
      : "";
    if (/no new privileges|effective uid|setuid|not permitted/i.test(details)) {
      throw new Error("更新助手已安装，但当前 systemd 服务禁止提权。请重新安装最新安装包以更新服务配置，然后再从页面重试。");
    }
    if (/a password is required|not allowed|permission denied/i.test(details)) {
      throw new Error("更新助手已安装，但服务账号没有免密执行权限。请检查 /etc/sudoers.d/requirement-platform-updater 后再重试。");
    }
    throw new Error(details ? `无法启动更新助手：${details}` : "无法启动更新助手。请确认服务账号具备受控更新权限。");
  }
  return { ...status, job: readUpdateJob() ?? status.job, started: true };
}
