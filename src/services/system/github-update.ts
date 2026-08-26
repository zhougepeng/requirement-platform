import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXPECTED_REMOTES = new Set([
  "https://github.com/zhougepeng/requirement-platform.git",
  "git@github.com:zhougepeng/requirement-platform.git",
]);

export type GithubUpdateStatus = {
  branch: string;
  currentCommit: string;
  remoteCommit: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  updateAvailable: boolean;
  canPull: boolean;
  blockedReason?: string;
};

function repositoryRoot() {
  return process.env.REQUIREMENT_PLATFORM_REPO_DIR?.trim() || process.cwd();
}

async function git(args: string[]) {
  const result = await execFileAsync("git", ["-C", repositoryRoot(), ...args], {
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

async function ensureRepository() {
  try {
    if (await git(["rev-parse", "--is-inside-work-tree"]) !== "true") throw new Error("not a repository");
  } catch {
    throw new Error("当前部署目录不是 Git 仓库，无法从 GitHub 更新。");
  }
  const [branch, remote] = await Promise.all([git(["branch", "--show-current"]), git(["remote", "get-url", "origin"])]);
  if (branch !== "main") throw new Error("当前不在 main 分支，已拒绝自动更新。");
  if (!EXPECTED_REMOTES.has(remote)) throw new Error("远端仓库不是已配置的需求库 GitHub 地址，已拒绝自动更新。");
  return branch;
}

function parseCounts(value: string) {
  const [ahead = "0", behind = "0"] = value.trim().split(/\s+/);
  return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 };
}

export async function checkGithubUpdate(fetchRemote = true): Promise<GithubUpdateStatus> {
  const branch = await ensureRepository();
  if (fetchRemote) {
    try {
      await git(["fetch", "--quiet", "origin", branch]);
    } catch {
      throw new Error("无法连接 GitHub 检查更新，请确认服务器网络与 Git 凭据。");
    }
  }
  try {
    const [currentCommit, remoteCommit, count, changes] = await Promise.all([
      git(["rev-parse", "--short", "HEAD"]),
      git(["rev-parse", "--short", `origin/${branch}`]),
      git(["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`]),
      git(["status", "--porcelain"]),
    ]);
    const { ahead, behind } = parseCounts(count);
    const dirty = Boolean(changes);
    const updateAvailable = behind > 0;
    const blockedReason = dirty
      ? "当前服务器有未提交修改，不能安全拉取更新。"
      : ahead > 0
        ? "当前服务器存在未推送提交，不能自动合并远端更新。"
        : undefined;
    return { branch, currentCommit, remoteCommit, ahead, behind, dirty, updateAvailable, canPull: updateAvailable && !blockedReason, blockedReason };
  } catch {
    throw new Error("无法读取 GitHub 更新状态，请确认 origin/main 已正确配置。");
  }
}

export async function pullGithubUpdate() {
  const before = await checkGithubUpdate(true);
  if (!before.updateAvailable) return { ...before, updated: false, restartRequired: false };
  if (before.dirty || before.ahead > 0) throw new Error(before.blockedReason || "当前代码不能安全更新。");
  try {
    await git(["pull", "--ff-only", "origin", before.branch]);
  } catch {
    throw new Error("GitHub 更新无法快速合并，未修改当前代码。请先在服务器处理分支差异。");
  }
  const after = await checkGithubUpdate(false);
  return { ...after, updated: true, restartRequired: true };
}
