import "server-only";

import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_API = "https://api.github.com/repos/zhougepeng/requirement-platform/releases/latest";
const INSTALLER_NAME = "requirement-platform-linux-x64.run";
const UPDATER_PATH = "/usr/local/sbin/requirement-platform-updater";

type GithubRelease = {
  tag_name?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
};

export type InstallerUpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  installerName: string;
  updateAvailable: boolean;
  canInstall: boolean;
  blockedReason?: string;
};

function installRoot() {
  return process.env.REQUIREMENT_PLATFORM_INSTALL_DIR?.trim() || "/opt/requirement-platform";
}

function currentVersion() {
  const versionFile = join(installRoot(), "current", "VERSION");
  try {
    return existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() || "未知版本" : "开发环境";
  } catch {
    return "未知版本";
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

async function latestRelease() {
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
  if (!version || !asset?.browser_download_url) throw new Error("最新 GitHub Release 未包含 Linux 安装包。");
  return { version };
}

function updaterAvailable() {
  if (process.platform !== "linux") return false;
  try {
    const stats = statSync(UPDATER_PATH);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export async function checkInstallerUpdate(): Promise<InstallerUpdateStatus> {
  const [current, release] = await Promise.all([Promise.resolve(currentVersion()), latestRelease()]);
  const updateAvailable = hasNewerVersion(current, release.version);
  const blockedReason = process.platform !== "linux"
    ? "自动安装包更新仅支持已安装的 Linux 服务器。"
    : !updaterAvailable()
      ? "当前安装包尚未包含自动更新助手；请先手动安装一次最新安装包，之后即可在页面内自动更新。"
      : undefined;
  return {
    currentVersion: current,
    latestVersion: release.version,
    installerName: INSTALLER_NAME,
    updateAvailable,
    canInstall: updateAvailable && !blockedReason,
    blockedReason,
  };
}

export async function startInstallerUpdate() {
  const status = await checkInstallerUpdate();
  if (!status.updateAvailable) return { ...status, started: false };
  if (!status.canInstall) throw new Error(status.blockedReason || "当前无法自动安装更新。");
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
  return { ...status, started: true };
}
