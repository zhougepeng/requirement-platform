import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { copyFile, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { Prisma } from "@prisma/client";
import { initialVersions, projects } from "@/lib/seed";
import type { DemoArtifact, Project, RequirementComment, RequirementDetail, RequirementSummary, RequirementVersion } from "@/lib/types";
import type { PublishRequirementInput } from "@/services/requirement/local-store";
import { prisma } from "@/services/requirement/prisma";

const ROOT = process.cwd();
const ARTIFACT_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.join(path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR), "artifacts")
  : path.join(ROOT, "data", "requirement-platform", "artifacts");
const PUBLISHED_DEMO_DIR = process.env.REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR)
  : path.join(ROOT, "public", "demos", "published");
const SEED_DEMO = path.join(ROOT, "public", "demos", "erp-image-to-purchase.html");
const LOCAL_USER_ID = "local-dev-user";
const MAX_ARTIFACT_BYTES = 15 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 30 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 150;

let seedPromise: Promise<void> | undefined;

function digest(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(value).replace(",", "");
}

function safeSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(value)) throw new Error(`${label} 只能包含字母、数字、下划线和短横线。`);
}

function userFor(actor?: { id: string; name: string }) {
  if (actor) return { id: actor.id, feishuUserId: actor.id, name: actor.name, avatar: null };
  const name = process.env.LOCAL_USER_NAME?.trim() || "本地开发身份";
  return { id: LOCAL_USER_ID, feishuUserId: LOCAL_USER_ID, name, avatar: null };
}

function toArtifact(value: { id: string; originalName: string; entryFile: string; checksum: string; createdAt: Date }): DemoArtifact {
  return { id: value.id, originalFileName: value.originalName, entryFile: value.entryFile, checksum: value.checksum, createdAt: formatDateTime(value.createdAt) };
}

function toVersion(value: { id: string; requirementId: string; versionNo: number; createdAt: Date; changeSummary: string; prdMarkdown: string; demoEntryUrl: string; demoArtifactId: string; publisher: { name: string } }): RequirementVersion {
  return {
    id: value.id, requirementCode: value.requirementId, number: value.versionNo,
    publishedAt: formatDateTime(value.createdAt), publisher: value.publisher.name,
    changeSummary: value.changeSummary, prd: value.prdMarkdown,
    demoEntryUrl: value.demoEntryUrl, artifactId: value.demoArtifactId,
  };
}

function toComment(value: { id: string; requirementId: string; versionId: string; content: string; createdAt: Date; user: { name: string } }): RequirementComment {
  const names = ["blue", "green", "violet"] as const;
  const tone = names[createHash("sha1").update(value.user.name).digest()[0] % names.length];
  return {
    id: value.id, requirementCode: value.requirementId, versionId: value.versionId,
    author: value.user.name, initials: value.user.name.slice(0, 1) || "用", tone,
    createdAt: formatDateTime(value.createdAt).slice(5), content: value.content,
  };
}

async function copySeedArtifact() {
  const artifactRoot = path.join(ARTIFACT_DIR, "artifact_erp_image_to_purchase");
  try {
    await stat(path.join(artifactRoot, "index.html"));
  } catch {
    await mkdir(artifactRoot, { recursive: true });
    await copyFile(SEED_DEMO, path.join(artifactRoot, "index.html"));
  }
}

async function ensureSeed() {
  seedPromise ??= (async () => {
    await copySeedArtifact();
    const user = userFor();
    const seedBytes = await readFile(SEED_DEMO);
    await prisma.$transaction(async (tx) => {
      await tx.user.upsert({ where: { id: user.id }, update: { name: user.name }, create: user });
      await tx.demoArtifact.upsert({
        where: { id: "artifact_erp_image_to_purchase" },
        update: {},
        create: {
          id: "artifact_erp_image_to_purchase", storageKey: "local/artifact_erp_image_to_purchase",
          originalName: "erp-image-to-purchase.html", entryFile: "index.html", checksum: digest(seedBytes),
          contentLength: seedBytes.byteLength, localDirectory: "artifact_erp_image_to_purchase",
        },
      });
      const seedProject = projects[0];
      await tx.project.upsert({
        where: { code: seedProject.id }, update: {},
        create: { id: seedProject.id, code: seedProject.id, name: seedProject.name, description: seedProject.description },
      });
      await tx.requirement.upsert({
        where: { code: "ERP-001" }, update: {},
        create: { id: "ERP-001", projectId: seedProject.id, code: "ERP-001", title: "图片转采购单" },
      });
      for (const version of initialVersions) {
        await tx.requirementVersion.upsert({
          where: { id: version.id }, update: {},
          create: {
            id: version.id, requirementId: version.requirementCode, versionNo: version.number,
            demoArtifactId: version.artifactId, demoPath: version.demoEntryUrl,
            demoEntryUrl: version.demoEntryUrl, changeSummary: version.changeSummary,
            prdMarkdown: version.prd, prdChecksum: digest(Buffer.from(version.prd)),
            demoChecksum: "seed-local-artifact", publisherId: user.id,
          },
        });
      }
      await tx.requirement.update({ where: { id: "ERP-001" }, data: { currentVersionId: "v3" } });
    });
  })();
  return seedPromise;
}

async function publishArtifactFiles(artifactDirectory: string, entryFile: string, projectCode: string, requirementCode: string, versionNo: number) {
  safeSegment(projectCode, "项目编码");
  safeSegment(requirementCode, "需求编码");
  const sourceRoot = path.join(ARTIFACT_DIR, artifactDirectory);
  const destination = path.join(PUBLISHED_DEMO_DIR, projectCode, requirementCode, `v${versionNo}`);
  await stat(path.join(sourceRoot, entryFile));
  try {
    await stat(destination);
    throw new Error("该版本的 Demo 发布目录已存在，不能覆盖历史版本。");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ENOENT")) {
      if (error instanceof Error && error.message.includes("不能覆盖")) throw error;
    }
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(sourceRoot, destination, { recursive: true, errorOnExist: true });
  return `/demos/published/${projectCode}/${requirementCode}/v${versionNo}/${entryFile}`;
}

export async function listProjects(): Promise<Project[]> {
  await ensureSeed();
  const result = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { requirements: { include: { currentVersion: { select: { versionNo: true } } }, orderBy: { code: "asc" } } },
  });
  return result.map((project) => ({
    id: project.code, name: project.name, description: project.description, updatedAt: formatDate(project.updatedAt),
    requirements: project.requirements.map((requirement) => ({ code: requirement.code, title: requirement.title, latestVersion: requirement.currentVersion?.versionNo ?? 0 })),
  }));
}

export async function getProject(projectId: string): Promise<Project> {
  const projects = await listProjects();
  const project = projects.find((item) => item.id === projectId);
  if (!project) throw new Error("项目不存在。");
  return project;
}

export async function getRequirementDetail(requirementCode: string): Promise<RequirementDetail> {
  await ensureSeed();
  const result = await prisma.requirement.findUnique({
    where: { code: requirementCode }, include: {
      project: true, currentVersion: { include: { publisher: true } },
    },
  });
  if (!result || !result.currentVersion) throw new Error("需求不存在或尚未发布版本。");
  return {
    project: { id: result.project.code, name: result.project.name, description: result.project.description, updatedAt: formatDate(result.project.updatedAt), requirements: [] },
    requirement: { id: result.id, projectId: result.project.code, code: result.code, title: result.title, currentVersionId: result.currentVersionId ?? "", createdAt: formatDateTime(result.createdAt), updatedAt: formatDateTime(result.updatedAt) },
    currentVersion: toVersion(result.currentVersion),
  };
}

export async function listProjectRequirements(projectId: string): Promise<RequirementSummary[]> {
  return (await getProject(projectId)).requirements;
}

export async function listVersions(requirementCode: string): Promise<RequirementVersion[]> {
  await ensureSeed();
  const versions = await prisma.requirementVersion.findMany({
    where: { requirementId: requirementCode }, orderBy: { versionNo: "desc" }, include: { publisher: true },
  });
  return versions.map(toVersion);
}

export async function getVersion(requirementCode: string, versionNo: number): Promise<RequirementVersion> {
  await ensureSeed();
  const version = await prisma.requirementVersion.findUnique({
    where: { requirementId_versionNo: { requirementId: requirementCode, versionNo } }, include: { publisher: true },
  });
  if (!version) throw new Error("版本不存在。");
  return toVersion(version);
}

export async function listComments(requirementCode: string, versionId?: string): Promise<RequirementComment[]> {
  await ensureSeed();
  const comments = await prisma.comment.findMany({
    where: { requirementId: requirementCode, ...(versionId ? { versionId } : {}) },
    orderBy: { createdAt: "asc" }, include: { user: true },
  });
  return comments.map(toComment);
}

export async function searchRequirements(query: string) {
  const value = query.trim();
  if (!value) return [];
  await ensureSeed();
  const results = await prisma.requirement.findMany({
    where: { OR: [
      { code: { contains: value, mode: "insensitive" } },
      { title: { contains: value, mode: "insensitive" } },
      { versions: { some: { prdMarkdown: { contains: value, mode: "insensitive" } } } },
    ] },
    include: { project: { select: { code: true } }, currentVersion: { select: { versionNo: true } } }, take: 50,
  });
  return results.map((item) => ({ projectCode: item.project.code, requirementCode: item.code, title: item.title, currentVersion: item.currentVersion?.versionNo ?? 0 }));
}

export async function addComment(requirementCode: string, versionId: string, content: string, actor?: { id: string; name: string }) {
  const value = content.trim();
  if (!value || value.length > 2000) throw new Error("评论内容不能为空且不能超过 2000 字。");
  await ensureSeed();
  const version = await prisma.requirementVersion.findFirst({ where: { id: versionId, requirementId: requirementCode } });
  if (!version) throw new Error("评论必须关联已有需求版本。");
  const user = userFor(actor);
  const savedUser = await prisma.user.upsert({ where: { feishuUserId: user.feishuUserId }, update: { name: user.name }, create: user });
  const comment = await prisma.comment.create({ data: { requirementId: requirementCode, versionId, userId: savedUser.id, content: value }, include: { user: true } });
  return toComment(comment);
}

export async function uploadArtifact(file: File) {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Demo 工件必须是 ZIP 文件。");
  if (file.size === 0 || file.size > MAX_ARTIFACT_BYTES) throw new Error("Demo ZIP 必须大于 0 且不超过 15MB。");
  const buffer = Buffer.from(await file.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  if (!entries.length || entries.length > MAX_ARTIFACT_FILES) throw new Error("Demo ZIP 文件数量不合法。");
  let unpackedBytes = 0;
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry.entryName).replace(/^\/+/, "");
    if (!normalized || normalized.startsWith("..") || path.posix.isAbsolute(normalized)) throw new Error("Demo ZIP 包含非法路径。");
    unpackedBytes += entry.header.size;
  }
  if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error("Demo ZIP 解压后不能超过 30MB。");
  if (!entries.some((entry) => path.posix.normalize(entry.entryName) === "index.html")) throw new Error("Demo ZIP 根目录必须包含 index.html。");

  await ensureSeed();
  const id = `artifact_${randomUUID().replaceAll("-", "")}`;
  const root = path.join(ARTIFACT_DIR, id);
  for (const zipEntry of entries) {
    const normalized = path.posix.normalize(zipEntry.entryName).replace(/^\/+/, "");
    const destination = path.join(root, normalized);
    if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Demo ZIP 包含非法路径。");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, zipEntry.getData());
  }
  const artifact = await prisma.demoArtifact.create({
    data: { id, storageKey: `local/${id}`, originalName: file.name, entryFile: "index.html", checksum: digest(buffer), contentLength: file.size, localDirectory: id },
  });
  return toArtifact(artifact);
}

export async function publishRequirement(input: PublishRequirementInput) {
  const projectCode = input.projectCode.trim();
  const requirementCode = input.requirementCode.trim();
  const title = input.title.trim();
  const prdMarkdown = input.prdMarkdown.trim();
  const changeSummary = input.changeSummary.trim();
  safeSegment(projectCode, "项目编码");
  safeSegment(requirementCode, "需求编码");
  if (!title || title.length > 200 || !prdMarkdown || prdMarkdown.length > 100_000 || !changeSummary || changeSummary.length > 1000) throw new Error("发布内容不完整或超过长度限制。");
  await ensureSeed();
  const user = userFor(input.actor);
  const savedUser = await prisma.user.upsert({ where: { feishuUserId: user.feishuUserId }, update: { name: user.name }, create: user });

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { code: projectCode } });
    const artifact = await tx.demoArtifact.findUnique({ where: { id: input.artifactId } });
    if (!project) throw new Error("项目不存在。");
    if (!artifact?.localDirectory) throw new Error("Demo 工件不存在或未在本地准备完成。");
    let requirement = await tx.requirement.findUnique({ where: { code: requirementCode } });
    if (!requirement) requirement = await tx.requirement.create({ data: { id: requirementCode, projectId: project.id, code: requirementCode, title } });
    if (requirement.projectId !== project.id) throw new Error("需求编码已属于另一个项目。");
    const lastVersion = await tx.requirementVersion.aggregate({ where: { requirementId: requirement.id }, _max: { versionNo: true } });
    const versionNo = (lastVersion._max.versionNo ?? 0) + 1;
    const demoEntryUrl = await publishArtifactFiles(artifact.localDirectory, artifact.entryFile, projectCode, requirementCode, versionNo);
    const version = await tx.requirementVersion.create({
      data: {
        requirementId: requirement.id, versionNo, demoArtifactId: artifact.id, demoPath: demoEntryUrl, demoEntryUrl,
        changeSummary, prdMarkdown, prdChecksum: digest(Buffer.from(prdMarkdown)), demoChecksum: artifact.checksum, publisherId: savedUser.id,
      }, include: { publisher: true },
    });
    const updated = await tx.requirement.update({ where: { id: requirement.id }, data: { title, currentVersionId: version.id } });
    await tx.project.update({ where: { id: project.id }, data: { updatedAt: new Date() } });
    return { requirement: { id: updated.id, projectId: project.code, code: updated.code, title: updated.title, currentVersionId: version.id, createdAt: formatDateTime(updated.createdAt), updatedAt: formatDateTime(updated.updatedAt) }, version: toVersion(version), url: `/r/${requirementCode}` };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
