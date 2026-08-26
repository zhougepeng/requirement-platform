import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { createInitialStore } from "@/lib/seed";
import type { DemoArtifact, Project, RequirementComment, RequirementDetail, RequirementStore, RequirementVersion } from "@/lib/types";

const ROOT = process.cwd();
const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(ROOT, "data", "requirement-platform");
const STORE_FILE = path.join(DATA_DIR, "store.local.json");
const ARTIFACT_DIR = path.join(DATA_DIR, "artifacts");
const PUBLISHED_DEMO_DIR = process.env.REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR)
  : path.join(DATA_DIR, "published-demos");
const MAX_ARTIFACT_BYTES = 15 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 30 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 150;

let mutationQueue = Promise.resolve();

export type PublishRequirementInput = {
  projectCode: string;
  requirementCode?: string;
  title: string;
  prdMarkdown: string;
  artifactId: string;
  changeSummary: string;
  actor?: { id: string; name: string };
};

export type CreateProjectInput = {
  code: string;
  name: string;
  description: string;
  owner?: string;
};

export type UpdateProjectInput = {
  name: string;
  description: string;
  owner?: string;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function now() {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date()).replaceAll("/", "-");
}

function safeSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(value)) {
    throw new Error(`${label} 只能包含字母、数字、下划线和短横线。`);
  }
}

function digest(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

async function writeStore(store: RequirementStore) {
  await mkdir(DATA_DIR, { recursive: true });
  const temp = `${STORE_FILE}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, STORE_FILE);
}

async function publishArtifactFiles(artifact: DemoArtifact, projectCode: string, requirementCode: string, versionNo: number) {
  safeSegment(projectCode, "项目编码");
  safeSegment(requirementCode, "需求编码");
  const artifactRoot = path.join(ARTIFACT_DIR, artifact.id);
  const destination = path.join(PUBLISHED_DEMO_DIR, projectCode, requirementCode, `v${versionNo}`);
  const source = path.join(artifactRoot, artifact.entryFile);
  await stat(source);
  await mkdir(destination, { recursive: true });
  await cp(artifactRoot, destination, { recursive: true, force: true });
  return `/demo-assets/${projectCode}/${requirementCode}/v${versionNo}/${artifact.entryFile}`;
}

function isLegacyDemoStore(store: RequirementStore) {
  const [project] = store.projects;
  const [requirement] = store.requirements;
  return store.projects.length === 1
    && project?.id === "erp"
    && project.name === "ERP"
    && project.requirements.length === 3
    && store.requirements.length === 1
    && requirement?.code === "ERP-001"
    && requirement.title === "图片转采购单"
    && store.versions.length === 3
    && store.versions.every((version) => version.requirementCode === "ERP-001")
    && store.comments.length === 3
    && store.comments.every((comment) => comment.requirementCode === "ERP-001")
    && store.artifacts.length === 1
    && store.artifacts[0]?.id === "artifact_erp_image_to_purchase";
}

async function ensureStore(): Promise<RequirementStore> {
  let store: RequirementStore;
  try {
    store = JSON.parse(await readFile(STORE_FILE, "utf8")) as RequirementStore;
  } catch {
    store = createInitialStore();
    await writeStore(store);
    return store;
  }
  if (isLegacyDemoStore(store)) {
    const emptyStore = createInitialStore();
    await writeStore(emptyStore);
    return emptyStore;
  }
  let migrated = false;
  for (const version of store.versions) {
    if (!version.demoEntryUrl.startsWith("/demos/published/")) continue;
    const artifact = store.artifacts.find((item) => item.id === version.artifactId);
    if (!artifact) throw new Error("Demo 工件数据不完整。");
    version.demoEntryUrl = await publishArtifactFiles(artifact, "erp", version.requirementCode, version.number);
    migrated = true;
  }
  for (const project of store.projects) {
    const requirements = store.requirements.filter((item) => item.projectId === project.id);
    const orderedRequirements = requirements.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const newest = orderedRequirements[0];
    const earliest = requirements.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!project.createdAt && earliest) {
      project.createdAt = earliest.createdAt.slice(0, 10);
      migrated = true;
    }
    if (!project.owner && newest) {
      project.owner = newest.owner ?? store.versions.find((item) => item.id === newest.currentVersionId)?.publisher;
      migrated = true;
    }
    for (const summary of project.requirements) {
      const requirement = store.requirements.find((item) => item.code === summary.code);
      if (!requirement) continue;
      const currentVersion = store.versions.find((item) => item.id === requirement.currentVersionId);
      const previous = JSON.stringify(summary);
      summary.createdAt ??= requirement.createdAt;
      summary.updatedAt ??= requirement.updatedAt;
      summary.owner ??= requirement.owner ?? currentVersion?.publisher;
      if (JSON.stringify(summary) !== previous) migrated = true;
    }
  }
  if (migrated) await writeStore(store);
  return store;
}

async function mutate<T>(operation: (store: RequirementStore) => Promise<T> | T): Promise<T> {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const store = await ensureStore();
    const result = await operation(store);
    await writeStore(store);
    return result;
  } finally {
    release();
  }
}

export async function listProjects() {
  const store = await ensureStore();
  return clone(store.projects);
}

export async function createProject(input: CreateProjectInput, actor?: { id: string; name: string }) {
  const code = input.code.trim();
  const name = input.name.trim();
  const description = input.description.trim();
  safeSegment(code, "项目编码");
  if (!name || name.length > 120) throw new Error("项目名称不能为空且不能超过 120 字。");
  if (description.length > 500) throw new Error("项目描述不能超过 500 字。");
  return mutate((store) => {
    if (store.projects.some((item) => item.id.toLowerCase() === code.toLowerCase())) throw new Error("项目编码已存在。");
    const timestamp = now();
    const project: Project = {
      id: code,
      name,
      description,
      createdAt: timestamp,
      updatedAt: timestamp,
      owner: input.owner?.trim() || actor?.name || "本地开发身份",
      requirements: [],
    };
    store.projects.push(project);
    return clone(project);
  });
}

export async function updateProject(projectId: string, input: UpdateProjectInput) {
  const name = input.name.trim();
  const description = input.description.trim();
  const owner = input.owner?.trim() || undefined;
  if (!name || name.length > 120) throw new Error("项目名称不能为空且不能超过 120 字。");
  if (description.length > 500) throw new Error("项目描述不能超过 500 字。");
  return mutate((store) => {
    const project = store.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("项目不存在。");
    project.name = name;
    project.description = description;
    project.owner = owner;
    project.updatedAt = now();
    return clone(project);
  });
}

export async function getProject(projectId: string) {
  const store = await ensureStore();
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("项目不存在。");
  return clone(project);
}

export async function getRequirementDetail(requirementCode: string): Promise<RequirementDetail> {
  const store = await ensureStore();
  const requirement = store.requirements.find((item) => item.code === requirementCode);
  if (!requirement) throw new Error("需求不存在。");
  const project = store.projects.find((item) => item.id === requirement.projectId);
  const currentVersion = store.versions.find((item) => item.id === requirement.currentVersionId);
  if (!project || !currentVersion) throw new Error("需求数据不完整。");
  return clone({ project, requirement, currentVersion });
}

export async function listProjectRequirements(projectId: string) {
  const store = await ensureStore();
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("项目不存在。");
  return clone(project.requirements.map((summary) => {
    const requirement = store.requirements.find((item) => item.code === summary.code);
    const currentVersion = requirement ? store.versions.find((item) => item.id === requirement.currentVersionId) : undefined;
    return {
      ...summary,
      createdAt: requirement?.createdAt ?? summary.createdAt,
      updatedAt: requirement?.updatedAt ?? summary.updatedAt,
      owner: requirement?.owner ?? summary.owner ?? currentVersion?.publisher,
    };
  }));
}

export async function listVersions(requirementCode: string) {
  const store = await ensureStore();
  return clone(store.versions.filter((item) => item.requirementCode === requirementCode).toSorted((a, b) => b.number - a.number));
}

export async function getVersion(requirementCode: string, versionNo: number) {
  const store = await ensureStore();
  const version = store.versions.find((item) => item.requirementCode === requirementCode && item.number === versionNo);
  if (!version) throw new Error("版本不存在。");
  return clone(version);
}

export async function listComments(requirementCode: string, versionId?: string) {
  const store = await ensureStore();
  return clone(store.comments.filter((item) => item.requirementCode === requirementCode && (!versionId || item.versionId === versionId)));
}

export async function searchRequirements(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const store = await ensureStore();
  return clone(store.requirements.flatMap((requirement) => {
    const project = store.projects.find((item) => item.id === requirement.projectId);
    const currentVersion = store.versions.find((item) => item.id === requirement.currentVersionId);
    const haystack = `${requirement.code} ${requirement.title} ${currentVersion?.prd ?? ""}`.toLowerCase();
    return haystack.includes(normalized) ? [{
      projectCode: project?.id,
      requirementCode: requirement.code,
      title: requirement.title,
      currentVersion: currentVersion?.number,
    }] : [];
  }));
}

export type RequirementKnowledgeMatch = {
  requirementCode: string;
  title: string;
  versionNo: number;
  projectName: string;
  excerpt: string;
  matchedTerms: string[];
};

function relevantExcerpt(text: string, query: string, limit = 900) {
  const normalized = text.toLowerCase();
  const terms = query.match(/[\u4e00-\u9fff]{2,}|[a-z0-9_-]+/gi) ?? [query];
  const index = terms.map((term) => normalized.indexOf(term.toLowerCase())).find((value) => value >= 0) ?? -1;
  if (index < 0) return text.slice(0, limit);
  const start = Math.max(0, index - 220);
  const end = Math.min(text.length, start + limit);
  return `${start ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function queryTerms(value: string) {
  const rawTerms = value.match(/[\u4e00-\u9fff]{2,}|[a-z0-9_-]+/gi) ?? [value];
  return Array.from(new Set(rawTerms.flatMap((term) => {
    if (!/[\u4e00-\u9fff]/.test(term) || term.length < 3) return [term.toLowerCase()];
    return Array.from({ length: term.length - 1 }, (_, index) => term.slice(index, index + 2).toLowerCase());
  })));
}

/** Small-team baseline retrieval: current published PRD text only, ranked before it reaches a model. */
export async function findRequirementKnowledge(query: string, limit = 4): Promise<RequirementKnowledgeMatch[]> {
  const value = query.trim();
  if (!value) return [];
  const terms = queryTerms(value);
  const broadQuestion = /需求库|有哪些|全部|概述|介绍|列表|项目/.test(value);
  const store = await ensureStore();
  const ranked = store.requirements.flatMap((requirement) => {
    const version = store.versions.find((item) => item.id === requirement.currentVersionId);
    const project = store.projects.find((item) => item.id === requirement.projectId);
    if (!version || !project) return [];
    const code = requirement.code.toLowerCase();
    const title = requirement.title.toLowerCase();
    const projectName = project.name.toLowerCase();
    const summary = version.changeSummary.toLowerCase();
    const prd = version.prd.toLowerCase();
    const hits = terms.filter((term) => [code, title, projectName, summary, prd].some((field) => field.includes(term)));
    const exactCode = value.toLowerCase().includes(code);
    const titleHits = terms.filter((term) => title.includes(term)).length;
    const score = (exactCode ? 100 : 0) + titleHits * 8 + terms.filter((term) => code.includes(term)).length * 6
      + terms.filter((term) => summary.includes(term)).length * 3 + terms.filter((term) => prd.includes(term)).length;
    if (!hits.length && !broadQuestion) return [];
    if (!broadQuestion && score < 2) return [];
    return [{
      requirementCode: requirement.code,
      title: requirement.title,
      versionNo: version.number,
      projectName: project.name,
      excerpt: relevantExcerpt(version.prd, value),
      matchedTerms: hits.slice(0, 8),
      score,
    }];
  }).toSorted((left, right) => right.score - left.score || left.requirementCode.localeCompare(right.requirementCode));
  return clone(ranked.slice(0, Math.max(1, Math.min(limit, 8))).map((match) => ({
    requirementCode: match.requirementCode,
    title: match.title,
    versionNo: match.versionNo,
    projectName: match.projectName,
    excerpt: match.excerpt,
    matchedTerms: match.matchedTerms,
  })));
}

export async function addComment(requirementCode: string, versionId: string, content: string, actor?: { id: string; name: string }) {
  const value = content.trim();
  if (!value || value.length > 2000) throw new Error("评论内容不能为空且不能超过 2000 字。");
  return mutate((store) => {
    const version = store.versions.find((item) => item.id === versionId && item.requirementCode === requirementCode);
    if (!version) throw new Error("评论必须关联已有需求版本。");
    const comment: RequirementComment = {
      id: randomUUID(),
      requirementCode,
      versionId,
      author: actor?.name || "张三（本地开发身份）",
      initials: (actor?.name || "张").slice(0, 1),
      tone: "blue",
      createdAt: now(),
      content: value,
    };
    store.comments.push(comment);
    return clone(comment);
  });
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
  const entry = entries.find((item) => path.posix.normalize(item.entryName) === "index.html");
  if (!entry) throw new Error("Demo ZIP 根目录必须包含 index.html。");

  const artifact: DemoArtifact = {
    id: `artifact_${randomUUID().replaceAll("-", "")}`,
    originalFileName: file.name,
    entryFile: "index.html",
    checksum: digest(buffer),
    createdAt: now(),
  };
  const root = path.join(ARTIFACT_DIR, artifact.id);
  for (const zipEntry of entries) {
    const normalized = path.posix.normalize(zipEntry.entryName).replace(/^\/+/, "");
    const destination = path.join(root, normalized);
    if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Demo ZIP 包含非法路径。");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, zipEntry.getData());
  }
  await mutate((store) => {
    store.artifacts.push(artifact);
  });
  return clone(artifact);
}

export async function publishRequirement(input: PublishRequirementInput) {
  const projectCode = input.projectCode.trim();
  const requestedRequirementCode = input.requirementCode?.trim() || "";
  const title = input.title.trim();
  const prdMarkdown = input.prdMarkdown.trim();
  const changeSummary = input.changeSummary.trim();
  safeSegment(projectCode, "项目编码");
  if (requestedRequirementCode) safeSegment(requestedRequirementCode, "需求编码");
  if (!title || title.length > 200 || !prdMarkdown || prdMarkdown.length > 100_000 || !changeSummary || changeSummary.length > 1000) {
    throw new Error("发布内容不完整或超过长度限制。");
  }

  return mutate(async (store) => {
    const project = store.projects.find((item) => item.id === projectCode);
    const artifact = store.artifacts.find((item) => item.id === input.artifactId);
    if (!project) throw new Error("项目不存在。");
    if (!artifact) throw new Error("Demo 工件不存在。");

    const requirementCode = requestedRequirementCode || nextRequirementCode(project.id, store);
    let requirement = store.requirements.find((item) => item.code === requirementCode);
    if (!requirement) {
      requirement = { id: requirementCode, projectId: project.id, code: requirementCode, title, currentVersionId: "", createdAt: now(), updatedAt: now(), owner: input.actor?.name || "张三（本地开发身份）" };
      store.requirements.push(requirement);
      project.requirements.push({ code: requirementCode, title, latestVersion: 0, createdAt: requirement.createdAt, updatedAt: requirement.updatedAt, owner: requirement.owner });
    }
    if (requirement.projectId !== project.id) throw new Error("需求编码已属于另一个项目。");

    const versions = store.versions.filter((item) => item.requirementCode === requirementCode);
    const number = versions.reduce((max, version) => Math.max(max, version.number), 0) + 1;
    const demoEntryUrl = await publishArtifactFiles(artifact, projectCode, requirementCode, number);
    const version: RequirementVersion = {
      id: randomUUID(),
      requirementCode,
      number,
      publishedAt: now(),
      publisher: input.actor?.name || "张三（本地开发身份）",
      changeSummary,
      prd: prdMarkdown,
      demoEntryUrl,
      artifactId: artifact.id,
    };
    store.versions.push(version);
    requirement.title = title;
    requirement.currentVersionId = version.id;
    requirement.updatedAt = version.publishedAt;
    const summary = project.requirements.find((item) => item.code === requirementCode);
    if (summary) {
      summary.title = title;
      summary.latestVersion = number;
      summary.createdAt = requirement.createdAt;
      summary.updatedAt = requirement.updatedAt;
      summary.owner = requirement.owner ?? version.publisher;
    }
    project.updatedAt = version.publishedAt.slice(0, 10);
    return clone({ requirement, version, url: `/r/${requirementCode}` });
  });
}

function nextRequirementCode(projectCode: string, store: RequirementStore) {
  const prefix = projectCode.toUpperCase();
  const numbers = store.requirements
    .filter((item) => item.projectId === projectCode || item.code.toUpperCase().startsWith(`${prefix}-`))
    .map((item) => Number(item.code.match(/-(\d+)$/)?.[1] ?? 0))
    .filter((number) => Number.isFinite(number));
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `${projectCode}-${String(next).padStart(3, "0")}`;
}
