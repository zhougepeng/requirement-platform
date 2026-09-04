import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { createInitialStore } from "@/lib/seed";
import type { DemoArtifact, HtmlCommentAnchor, PrdCommentAnchor, Product, ProductSpec, ProductSpecChange, ProductSpecPendingExtraction, Project, Requirement, RequirementAssetFile, RequirementAssetManifest, RequirementComment, RequirementDetail, RequirementDetailSummary, RequirementDiscussion, RequirementDocument, RequirementGap, RequirementStore, RequirementTestCase, RequirementTestStatus, RequirementTimelineEvent, RequirementVersion, RequirementVersionSummary } from "@/lib/types";

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
const ASSET_OBJECT_DIR = path.join(DATA_DIR, "asset-objects");
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_SNAPSHOT_FILES = 500;

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

export type PublishRequirementSnapshotInput = {
  requirementCode: string;
  archive: File;
  changeSummary: string;
  versionName?: string;
  setCurrent?: boolean;
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

export type RequirementReleaseStatus = "offline" | "scheduled" | "online";
export type UpdateRequirementReleaseStatusInput = {
  status: RequirementReleaseStatus;
  scheduleVersion?: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
  releaseVersion?: string;
  releaseDate?: string;
};

export type RequirementTimelineView = "month" | "version";
export type RequirementTimelineGroup = {
  key: string;
  label: string;
  items: RequirementTimelineEvent[];
};
export type RequirementTimelinePage = {
  view: RequirementTimelineView;
  groups: RequirementTimelineGroup[];
  nextCursor?: string;
};

export function releaseStatusOf(requirement: Pick<import("@/lib/types").Requirement, "status">): RequirementReleaseStatus {
  // Requirements created before release status was introduced are already
  // published records. Keep them visible to the current-knowledge assistant;
  // newly created requirements explicitly set status to offline below.
  return requirement.status === "offline" || requirement.status === "scheduled" ? requirement.status : "online";
}

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

function safeAssetPath(value: string) {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) throw new Error("需求资产包含非法路径。");
  return normalized;
}

function snapshotEntryPath(entry: { entryName: string; rawEntryName?: Buffer }) {
  const rawName = entry.rawEntryName;
  if (!rawName?.length) return entry.entryName;
  const utf8Name = rawName.toString("utf8");
  if (!utf8Name.includes("\uFFFD")) return utf8Name;
  try {
    // Windows 压缩工具常用 GBK/GB18030 写入中文文件名；UTF-8 解码失败时再回退，避免影响正常 UTF-8 包。
    return new TextDecoder("gb18030", { fatal: true }).decode(rawName);
  } catch {
    return entry.entryName;
  }
}

function mimeType(filePath: string) {
  const extension = path.posix.extname(filePath).toLowerCase();
  return ({ ".md": "text/markdown", ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2" }[extension] ?? "application/octet-stream");
}

async function storeAssetObject(buffer: Buffer) {
  const hash = digest(buffer);
  const target = path.join(ASSET_OBJECT_DIR, hash);
  try { await stat(target); } catch {
    await mkdir(ASSET_OBJECT_DIR, { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, buffer);
    try { await rename(temporary, target); } catch { /* identical object won another concurrent write */ }
  }
  return hash;
}

async function snapshotFromEntries(entries: Array<{ path: string; data: Buffer }>) {
  if (!entries.length || entries.length > MAX_SNAPSHOT_FILES) throw new Error("需求资产文件数量不合法。");
  let totalSize = 0;
  const seen = new Set<string>();
  const files: RequirementAssetFile[] = [];
  for (const entry of entries) {
    const assetPath = safeAssetPath(entry.path);
    if (seen.has(assetPath)) throw new Error(`需求资产存在重复路径：${assetPath}`);
    seen.add(assetPath);
    totalSize += entry.data.length;
    if (totalSize > MAX_SNAPSHOT_BYTES) throw new Error("需求资产解压后不能超过 50MB。");
    files.push({ path: assetPath, size: entry.data.length, hash: await storeAssetObject(entry.data), mimeType: mimeType(assetPath) });
  }
  return { files: files.toSorted((left, right) => left.path.localeCompare(right.path)), totalFiles: files.length, totalSize, createdAt: now() } satisfies RequirementAssetManifest;
}

async function materializeSnapshotDemo(manifest: RequirementAssetManifest, projectCode: string, requirementCode: string, versionNo: number) {
  const demoFiles = manifest.files.filter((file) => file.path.startsWith("demo/"));
  const demoEntry = demoFiles.find((file) => file.path.toLowerCase() === "demo/index.html") ?? demoFiles.find((file) => /\.html?$/i.test(file.path));
  if (!demoEntry) throw new Error("需求资产必须包含 demo/ 下的 HTML 文件。");
  safeSegment(projectCode, "项目编码"); safeSegment(requirementCode, "需求编码");
  const destination = path.join(PUBLISHED_DEMO_DIR, projectCode, requirementCode, `v${versionNo}`);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  for (const file of manifest.files) {
    const relative = file.path;
    const target = path.join(temporary, relative);
    if (!target.startsWith(`${temporary}${path.sep}`)) throw new Error("需求资产包含非法 Demo 路径。");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(ASSET_OBJECT_DIR, file.hash)));
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(temporary, destination);
  return `/demo-assets/${projectCode}/${requirementCode}/v${versionNo}/${demoEntry.path}`;
}

async function parseSnapshotArchive(file: File) {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("需求资产必须上传 ZIP 文件。");
  if (file.size <= 0 || file.size > MAX_SNAPSHOT_BYTES) throw new Error("需求资产 ZIP 必须大于 0 且不超过 50MB。");
  const archive = new AdmZip(Buffer.from(await file.arrayBuffer()));
  const entries = archive
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({ path: safeAssetPath(snapshotEntryPath(entry)), data: entry.getData() }));
  const prdEntries = entries.filter((entry) => /(?:^|\/)prd\.(?:md|markdown)$/i.test(entry.path) || /^prd\/.+\.(?:md|markdown)$/i.test(entry.path) || /^PRD\.md$/i.test(entry.path));
  if (!prdEntries.length) throw new Error("需求资产 ZIP 必须包含 PRD.md 或 prd/ 下的 Markdown 文件。");
  if (!entries.some((entry) => entry.path.startsWith("demo/") && /\.html?$/i.test(entry.path))) throw new Error("需求资产 ZIP 必须包含 demo/ 下的 HTML 文件。");
  return entries;
}

function documentsForSnapshot(entries: Array<{ path: string; data: Buffer }>, projectCode: string, requirementCode: string, versionNo: number): RequirementDocument[] {
  const nestedPrds = entries.filter((entry) => /^prd\/.+\.(?:md|markdown)$/i.test(entry.path)).toSorted((a, b) => a.path.localeCompare(b.path));
  // 根目录 PRD.md 是给旧版发布端的兼容副本；已有 prd/ 多文件时不再把它展示成重复目录项。
  const prds = nestedPrds.length ? nestedPrds : entries.filter((entry) => /^PRD\.md$/i.test(entry.path));
  const demos = entries.filter((entry) => entry.path.startsWith("demo/") && /\.html?$/i.test(entry.path)).toSorted((a, b) => a.path.localeCompare(b.path));
  const base = `/demo-assets/${projectCode}/${requirementCode}/v${versionNo}/`;
  return [
    ...prds.map((entry, index) => ({ id: `prd_${index}_${entry.path}`, name: path.posix.basename(entry.path), path: entry.path, kind: "prd" as const, mimeType: mimeType(entry.path), order: index, content: entry.data.toString("utf8"), url: `${base}${entry.path}` })),
    ...demos.map((entry, index) => ({ id: `demo_${index}_${entry.path}`, name: path.posix.basename(entry.path), path: entry.path, kind: "demo" as const, mimeType: mimeType(entry.path), order: index, url: `${base}${entry.path}` })),
  ];
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
  for (const requirement of store.requirements) {
    if (requirement.status !== "online" && requirement.status !== "scheduled" && requirement.status !== "offline") {
      // Before release status existed, every stored requirement represented a
      // published PRD. Preserve that meaning during schema migration.
      requirement.status = "online";
      migrated = true;
    }
  }
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
  if (!Array.isArray(store.gaps)) {
    store.gaps = [];
    migrated = true;
  }
  if (!Array.isArray(store.discussions)) {
    store.discussions = [];
    migrated = true;
  }
  if (!Array.isArray(store.testCases)) {
    store.testCases = [];
    migrated = true;
  }
  if (!Array.isArray(store.timelineEvents)) {
    store.timelineEvents = [];
    migrated = true;
  }
  if (!Array.isArray(store.products)) { store.products = []; migrated = true; }
  if (!Array.isArray(store.projectProducts)) { store.projectProducts = []; migrated = true; }
  if (!Array.isArray(store.productSpecs)) { store.productSpecs = []; migrated = true; }
  if (!Array.isArray(store.productSpecPendingExtractions)) { store.productSpecPendingExtractions = []; migrated = true; }
  for (const requirement of store.requirements) {
    const project = store.projects.find((item) => item.id === requirement.projectId);
    if (!project) continue;
    const status = releaseStatusOf(requirement);
    if (status === "offline" || store.timelineEvents.some((event) => event.requirementCode === requirement.code && event.status === status)) continue;
    const event = timelineEventFor(requirement, project, "backfill");
    if (!event) continue;
    store.timelineEvents.push(event);
    migrated = true;
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

function archived(value: { archivedAt?: string }) {
  return Boolean(value.archivedAt);
}

function projectWithRequirementSummaries(store: RequirementStore, project: Project, includeArchived: boolean) {
  const requirements = project.requirements.flatMap((summary) => {
    const requirement = store.requirements.find((item) => item.code === summary.code);
    if (!requirement || (!includeArchived && archived(requirement))) return [];
    const currentVersion = store.versions.find((item) => item.id === requirement.currentVersionId);
    return [{
      ...summary,
      createdAt: requirement.createdAt ?? summary.createdAt,
      updatedAt: requirement.updatedAt ?? summary.updatedAt,
      owner: requirement.owner ?? summary.owner ?? currentVersion?.publisher,
      ownerId: requirement.ownerId ?? summary.ownerId,
      status: releaseStatusOf(requirement),
      releaseVersion: requirement.releaseVersion,
      releaseDate: requirement.releaseDate,
      archivedAt: requirement.archivedAt,
      archivedBy: requirement.archivedBy,
    }];
  });
  return { ...project, requirements };
}

export async function listProjects(includeArchived = false) {
  const store = await ensureStore();
  return clone(store.projects
    .filter((project) => includeArchived || !archived(project))
    .map((project) => projectWithRequirementSummaries(store, project, includeArchived)));
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

export async function archiveProject(projectId: string, actor?: { id: string; name: string }) {
  return mutate((store) => {
    const project = store.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("项目不存在。");
    if (archived(project)) return clone(project);
    project.archivedAt = now();
    project.archivedBy = actor?.name || "本地开发身份";
    project.updatedAt = project.archivedAt;
    return clone(project);
  });
}

export async function restoreProject(projectId: string) {
  return mutate((store) => {
    const project = store.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("项目不存在。");
    if (!archived(project)) return clone(project);
    project.archivedAt = undefined;
    project.archivedBy = undefined;
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

export type CreateProductInput = { name: string; description?: string };

export async function listProducts(query = "") {
  const store = await ensureStore();
  const normalized = query.trim().toLowerCase();
  return clone((store.products ?? []).filter((product) => !normalized || `${product.name} ${product.description ?? ""}`.toLowerCase().includes(normalized)).toSorted((a, b) => a.name.localeCompare(b.name)));
}

export async function getProduct(productId: string) {
  const store = await ensureStore();
  const product = (store.products ?? []).find((item) => item.id === productId);
  if (!product) throw new Error("产品不存在。");
  return clone(product);
}

export async function createProduct(input: CreateProductInput) {
  const name = input.name.trim();
  const description = (input.description ?? "").trim();
  if (!name || name.length > 120) throw new Error("产品名称不能为空且不能超过 120 字。");
  if (description.length > 500) throw new Error("产品说明不能超过 500 字。");
  return mutate((store) => {
    if ((store.products ?? []).some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new Error("产品名称已存在。");
    const timestamp = now();
    const product: Product = { id: `product_${randomUUID().replaceAll("-", "")}`, name, description, createdAt: timestamp, updatedAt: timestamp };
    store.products ??= []; store.projectProducts ??= []; store.productSpecs ??= [];
    store.products.push(product);
    return clone(product);
  });
}

export async function listProjectProducts(projectId: string) {
  const store = await ensureStore();
  if (!store.projects.some((item) => item.id === projectId)) throw new Error("项目不存在。");
  const ids = new Set((store.projectProducts ?? []).filter((item) => item.projectId === projectId).map((item) => item.productId));
  return clone((store.products ?? []).filter((item) => ids.has(item.id)).toSorted((a, b) => a.name.localeCompare(b.name)));
}

export async function linkProjectProduct(projectId: string, productId: string) {
  return mutate((store) => {
    if (!store.projects.some((item) => item.id === projectId)) throw new Error("项目不存在。");
    if (!(store.products ?? []).some((item) => item.id === productId)) throw new Error("产品不存在。");
    store.projectProducts ??= [];
    if (!store.projectProducts.some((item) => item.projectId === projectId && item.productId === productId)) store.projectProducts.push({ projectId, productId, createdAt: now() });
    return clone(store.projectProducts.find((item) => item.projectId === projectId && item.productId === productId)!);
  });
}

export async function setRequirementProduct(requirementCode: string, productId: string) {
  return mutate((store) => {
    const requirement = store.requirements.find((item) => item.code === requirementCode);
    if (!requirement) throw new Error("需求不存在。");
    if (!(store.products ?? []).some((item) => item.id === productId)) throw new Error("产品不存在。");
    requirement.productId = productId;
    requirement.updatedAt = now();
    return clone(requirement);
  });
}

function emptyProductSpec(productId: string): ProductSpec {
  return { id: `spec_${productId}`, productId, version: 0, rules: { terminology: [], businessConstraints: [], copywriting: [] }, prd: { structure: [], writingRules: [] }, tokens: {}, components: [], demo: { layoutPrinciples: [], componentReuseRules: [], interactionRequirements: [], constraints: [] }, updatedAt: now() };
}

export async function getProductSpec(productId: string) {
  await getProduct(productId);
  const store = await ensureStore();
  return clone((store.productSpecs ?? []).find((item) => item.productId === productId) ?? emptyProductSpec(productId));
}

export async function getProductGenerationContext(productId: string) {
  const spec = await getProductSpec(productId);
  return clone({ productId, rules: spec.rules, prd: spec.prd, tokens: spec.tokens, components: spec.components, demo: spec.demo });
}

function unique(values: string[]) { return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 80); }

async function analyseProductSpec(requirementCode: string, productId: string): Promise<ProductSpec> {
  const store = await ensureStore();
  const requirement = store.requirements.find((item) => item.code === requirementCode);
  if (!requirement) throw new Error("需求不存在。");
  const version = store.versions.find((item) => item.id === requirement.currentVersionId);
  if (!version) throw new Error("需求版本不存在。");
  const prd = version.prd || "";
  const headings = unique(Array.from(prd.matchAll(/^#{1,4}\s+(.+)$/gm), (match) => match[1]));
  const terminology = unique(Array.from(prd.matchAll(/[“「『]([^”」』]{2,24})[”」』]/g), (match) => match[1]));
  const constraints = unique(prd.split(/\n+/).filter((line) => /(必须|不得|不能|仅允许|需要支持|约束)/.test(line)).map((line) => line.replace(/^[-*]\s*/, "").trim()));
  const colors = unique(Array.from(prd.matchAll(/#[0-9a-fA-F]{3,8}\b/g), (match) => match[0]));
  const demoSummary = version.demoEntryUrl ? await analyseDemo(version.demoEntryUrl) : { summary: "", demoIds: [], supportsAutomation: false };
  const componentNames = unique(["Button", "Input", "Select", "Dialog", "Table", "Tabs", "Card"].filter((name) => new RegExp(name, "i").test(demoSummary.summary) || new RegExp(name, "i").test(prd)));
  const components = componentNames.map((name) => ({ name, usage: `复用 ${name} 组件完成相同交互场景。`, states: ["default", "hover", "disabled"], interaction: [], sourceRequirementCodes: [requirementCode] }));
  return { id: `spec_${productId}`, productId, version: 0, rules: { terminology, businessConstraints: constraints, copywriting: [] }, prd: { structure: headings, writingRules: ["先说明目标与范围，再描述流程、规则和验收标准。"] }, tokens: colors.length ? { color: { sourceColors: colors } } : {}, components, demo: { layoutPrinciples: ["保持与现有产品布局一致。"], componentReuseRules: ["优先复用已有组件，不重复创建近似组件。"], interactionRequirements: [], constraints: ["生成 Demo 必须覆盖正常、异常和空状态。"] }, updatedAt: now() };
}

function compareProductSpec(existing: ProductSpec, incoming: ProductSpec): ProductSpecChange[] {
  const changes: ProductSpecChange[] = [];
  const compareList = (path: string, oldValues: string[], newValues: string[]) => {
    for (const value of newValues) if (!oldValues.includes(value)) changes.push({ category: oldValues.length ? "supplemented" : "added", path, summary: value, existing: oldValues, incoming: newValues });
  };
  compareList("rules.terminology", existing.rules.terminology, incoming.rules.terminology);
  compareList("rules.businessConstraints", existing.rules.businessConstraints, incoming.rules.businessConstraints);
  compareList("prd.structure", existing.prd.structure, incoming.prd.structure);
  compareList("demo.constraints", existing.demo.constraints, incoming.demo.constraints);
  if (existing.tokens.color && incoming.tokens.color && JSON.stringify(existing.tokens.color) !== JSON.stringify(incoming.tokens.color)) changes.push({ category: "conflict", path: "tokens.color", summary: "检测到颜色 Token 与现有规范不同。", existing: existing.tokens.color, incoming: incoming.tokens.color });
  for (const component of incoming.components) if (!existing.components.some((item) => item.name === component.name)) changes.push({ category: "added", path: `components.${component.name}`, summary: `新增可复用组件：${component.name}`, incoming: component });
  return changes;
}

export async function extractProductSpec(requirementCode: string, productId: string, analysedDraftSpec?: ProductSpec) {
  const store = await ensureStore();
  const requirement = store.requirements.find((item) => item.code === requirementCode);
  if (!requirement) throw new Error("需求不存在。");
  await getProduct(productId);
  const existing = (store.productSpecs ?? []).find((item) => item.productId === productId) ?? emptyProductSpec(productId);
  const draftSpec = analysedDraftSpec ?? await analyseProductSpec(requirementCode, productId);
  const changes = compareProductSpec(existing, draftSpec);
  return clone({ product: (store.products ?? []).find((item) => item.id === productId), requirement, changes, draftSpec, summary: { total: changes.length, added: changes.filter((item) => item.category === "added").length, supplemented: changes.filter((item) => item.category === "supplemented").length, conflicts: changes.filter((item) => item.category === "conflict").length } });
}

export async function getProductSpecExtractionContext(requirementCode: string, productId: string) {
  const store = await ensureStore();
  const requirement = store.requirements.find((item) => item.code === requirementCode);
  const version = requirement ? store.versions.find((item) => item.id === requirement.currentVersionId) : undefined;
  if (!requirement || !version) throw new Error("需求或当前版本不存在。");
  await getProduct(productId);
  const demoSummary = version.demoEntryUrl ? await analyseDemo(version.demoEntryUrl) : { summary: "当前版本没有 Demo。", demoIds: [], supportsAutomation: false };
  const demoHtml = version.demoEntryUrl ? await readDemoSource(version.demoEntryUrl) : "";
  const testCases = (store.testCases ?? [])
    .filter((item) => item.requirementCode === requirementCode && item.versionNo === version.number)
    .slice(0, 40)
    .map((item) => ({ title: item.title, module: item.module, type: item.type, steps: item.steps, expectedResults: item.expectedResults }));
  return clone({
    requirement: { code: requirement.code, title: requirement.title, status: requirement.status },
    version: { number: version.number, changeSummary: version.changeSummary },
    prd: version.prd.slice(0, 60_000),
    demoHtml,
    demoSummary,
    testCases,
    programSpec: await analyseProductSpec(requirementCode, productId),
  });
}

export async function savePendingProductSpecExtraction(input: Omit<ProductSpecPendingExtraction, "id" | "createdAt" | "status">) {
  return mutate((store) => {
    const pending: ProductSpecPendingExtraction = { ...input, id: `product_spec_pending_${randomUUID().replaceAll("-", "")}`, createdAt: now(), status: "pending_review" };
    store.productSpecPendingExtractions ??= [];
    store.productSpecPendingExtractions = store.productSpecPendingExtractions.filter((item) => !(item.requirementCode === input.requirementCode && item.productId === input.productId));
    store.productSpecPendingExtractions.push(pending);
    return clone(pending);
  });
}

export async function mergeProductSpec(productId: string, draftSpec: ProductSpec, actor?: { id: string; name: string }) {
  return mutate((store) => {
    if (!(store.products ?? []).some((item) => item.id === productId)) throw new Error("产品不存在。");
    const timestamp = now();
    const current = (store.productSpecs ?? []).find((item) => item.productId === productId);
    const mergeStrings = (left: string[] = [], right: string[] = []) => Array.from(new Set([...left, ...right]));
    const mergeComponents = (left: ProductSpec["components"] = [], right: ProductSpec["components"] = []) => {
      const byName = new Map(left.map((item) => [item.name, item]));
      for (const item of right) byName.set(item.name, { ...byName.get(item.name), ...item, states: mergeStrings(byName.get(item.name)?.states, item.states), interaction: mergeStrings(byName.get(item.name)?.interaction, item.interaction), sourceRequirementCodes: mergeStrings(byName.get(item.name)?.sourceRequirementCodes, item.sourceRequirementCodes) });
      return Array.from(byName.values());
    };
    const base = current ?? emptyProductSpec(productId);
    const saved: ProductSpec = {
      ...base,
      ...draftSpec,
      id: current?.id ?? `spec_${productId}`,
      productId,
      version: (current?.version ?? 0) + 1,
      rules: {
        terminology: mergeStrings(base.rules.terminology, draftSpec.rules.terminology),
        businessConstraints: mergeStrings(base.rules.businessConstraints, draftSpec.rules.businessConstraints),
        copywriting: mergeStrings(base.rules.copywriting, draftSpec.rules.copywriting),
      },
      prd: {
        ...base.prd,
        ...draftSpec.prd,
        structure: mergeStrings(base.prd.structure, draftSpec.prd.structure),
        writingRules: mergeStrings(base.prd.writingRules, draftSpec.prd.writingRules),
      },
      tokens: { ...base.tokens, ...draftSpec.tokens },
      components: mergeComponents(base.components, draftSpec.components),
      demo: {
        ...base.demo,
        ...draftSpec.demo,
        layoutPrinciples: mergeStrings(base.demo.layoutPrinciples, draftSpec.demo.layoutPrinciples),
        componentReuseRules: mergeStrings(base.demo.componentReuseRules, draftSpec.demo.componentReuseRules),
        interactionRequirements: mergeStrings(base.demo.interactionRequirements, draftSpec.demo.interactionRequirements),
        constraints: mergeStrings(base.demo.constraints, draftSpec.demo.constraints),
      },
      updatedAt: timestamp,
      updatedBy: actor?.name,
    };
    store.productSpecs ??= [];
    if (current) Object.assign(current, saved); else store.productSpecs.push(saved);
    return clone(saved);
  });
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

function versionSummary(version: RequirementVersion): RequirementVersionSummary {
  const metadata = {
    ...version,
    prd: "" as const,
    documents: version.documents?.map((document) => {
      const copy = { ...document };
      delete copy.content;
      return copy;
    }),
  };
  delete metadata.assetManifest;
  return metadata as RequirementVersionSummary;
}

/** Returns only the fields required to render the detail shell and Demo first. */
export async function getRequirementDetailSummary(requirementCode: string): Promise<RequirementDetailSummary> {
  const store = await ensureStore();
  const requirement = store.requirements.find((item) => item.code === requirementCode);
  if (!requirement) throw new Error("需求不存在。");
  const project = store.projects.find((item) => item.id === requirement.projectId);
  const currentVersion = store.versions.find((item) => item.id === requirement.currentVersionId);
  if (!project || !currentVersion) throw new Error("需求数据不完整。");
  return clone({ project, requirement, currentVersion: versionSummary(currentVersion) });
}

export async function listProjectRequirements(projectId: string, includeArchived = false) {
  const store = await ensureStore();
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("项目不存在。");
  if (archived(project) && !includeArchived) return [];
  return clone(projectWithRequirementSummaries(store, project, includeArchived).requirements);
}

export async function archiveRequirement(requirementCode: string, actor?: { id: string; name: string }) {
  return mutate((store) => {
    const requirement = store.requirements.find((item) => item.code === requirementCode);
    if (!requirement) throw new Error("需求不存在。");
    if (archived(requirement)) return clone(requirement);
    const project = store.projects.find((item) => item.id === requirement.projectId);
    if (!project) throw new Error("需求所属项目不存在。");
    requirement.archivedAt = now();
    requirement.archivedBy = actor?.name || "本地开发身份";
    requirement.updatedAt = requirement.archivedAt;
    const summary = project.requirements.find((item) => item.code === requirementCode);
    if (summary) {
      summary.archivedAt = requirement.archivedAt;
      summary.archivedBy = requirement.archivedBy;
      summary.updatedAt = requirement.updatedAt;
    }
    project.updatedAt = requirement.updatedAt;
    return clone(requirement);
  });
}

export async function restoreRequirement(requirementCode: string) {
  return mutate((store) => {
    const requirement = store.requirements.find((item) => item.code === requirementCode);
    if (!requirement) throw new Error("需求不存在。");
    if (!archived(requirement)) return clone(requirement);
    const project = store.projects.find((item) => item.id === requirement.projectId);
    if (!project) throw new Error("需求所属项目不存在。");
    requirement.archivedAt = undefined;
    requirement.archivedBy = undefined;
    requirement.updatedAt = now();
    const summary = project.requirements.find((item) => item.code === requirementCode);
    if (summary) {
      summary.archivedAt = undefined;
      summary.archivedBy = undefined;
      summary.updatedAt = requirement.updatedAt;
    }
    project.updatedAt = requirement.updatedAt;
    return clone(requirement);
  });
}

function validReleaseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function timelineEventFor(requirement: Requirement, project: Project, source: RequirementTimelineEvent["source"]): RequirementTimelineEvent | null {
  const status = releaseStatusOf(requirement);
  if (status === "online") {
    if (!requirement.releaseVersion || !validReleaseDate(requirement.releaseDate ?? "")) return null;
    return {
      id: randomUUID(), requirementCode: requirement.code, projectId: project.id,
      requirementName: requirement.title, projectName: project.name, status,
      eventDate: requirement.releaseDate!, version: requirement.releaseVersion,
      releaseDate: requirement.releaseDate, recordedAt: now(), source,
    };
  }
  if (status === "scheduled") {
    if (!requirement.scheduleVersion || !validReleaseDate(requirement.scheduledFullDate ?? "") || !validReleaseDate(requirement.scheduledGrayDate ?? "")) return null;
    return {
      id: randomUUID(), requirementCode: requirement.code, projectId: project.id,
      requirementName: requirement.title, projectName: project.name, status,
      eventDate: requirement.scheduledFullDate!, version: requirement.scheduleVersion,
      scheduledGrayDate: requirement.scheduledGrayDate, scheduledFullDate: requirement.scheduledFullDate,
      recordedAt: now(), source,
    };
  }
  return null;
}

function upsertCurrentTimelineEvent(store: RequirementStore, requirement: Requirement, project: Project, previousStatus: RequirementReleaseStatus) {
  const next = timelineEventFor(requirement, project, "status_update");
  if (!next) return;
  const events = store.timelineEvents ?? (store.timelineEvents = []);
  const currentStatus = next.status;
  const existing = previousStatus === currentStatus
    ? events.filter((event) => event.requirementCode === requirement.code && event.status === currentStatus)
      .toSorted((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0]
    : undefined;
  if (existing) {
    Object.assign(existing, { ...next, id: existing.id, source: existing.source });
  } else {
    events.push(next);
  }
}

export async function updateRequirementReleaseStatus(requirementCode: string, input: UpdateRequirementReleaseStatusInput) {
  const status = input.status;
  if (status !== "offline" && status !== "scheduled" && status !== "online") throw new Error("需求状态无效。");
  const scheduleVersion = input.scheduleVersion?.trim() ?? "";
  const scheduledGrayDate = input.scheduledGrayDate?.trim() ?? "";
  const scheduledFullDate = input.scheduledFullDate?.trim() ?? "";
  const releaseVersion = input.releaseVersion?.trim() ?? "";
  const releaseDate = input.releaseDate?.trim() ?? "";
  if (status === "online") {
    if (!releaseVersion || releaseVersion.length > 80) throw new Error("上线版本不能为空且不能超过 80 个字符。");
    if (!validReleaseDate(releaseDate)) throw new Error("上线时间必须是有效日期。");
  }
  if (status === "scheduled") {
    if (!scheduleVersion || scheduleVersion.length > 80) throw new Error("排期版本不能为空且不能超过 80 个字符。");
    if (!validReleaseDate(scheduledGrayDate)) throw new Error("预计灰度时间必须是有效日期。");
    if (!validReleaseDate(scheduledFullDate)) throw new Error("预计全量时间必须是有效日期。");
  }
  return mutate((store) => {
    const requirement = store.requirements.find((item) => item.code === requirementCode);
    if (!requirement) throw new Error("需求不存在。");
    const project = store.projects.find((item) => item.id === requirement.projectId);
    if (!project) throw new Error("需求所属项目不存在。");
    if (archived(project) || archived(requirement)) throw new Error("已作废项目或需求不能修改上线状态。");
    const previousStatus = releaseStatusOf(requirement);
    requirement.status = status;
    if (status === "online") {
      requirement.releaseVersion = releaseVersion;
      requirement.releaseDate = releaseDate;
    }
    if (status === "scheduled") {
      requirement.scheduleVersion = scheduleVersion;
      requirement.scheduledGrayDate = scheduledGrayDate;
      requirement.scheduledFullDate = scheduledFullDate;
    }
    requirement.updatedAt = now();
    const summary = project.requirements.find((item) => item.code === requirementCode);
    if (summary) {
      summary.status = status;
      summary.scheduleVersion = requirement.scheduleVersion;
      summary.scheduledGrayDate = requirement.scheduledGrayDate;
      summary.scheduledFullDate = requirement.scheduledFullDate;
      summary.releaseVersion = requirement.releaseVersion;
      summary.releaseDate = requirement.releaseDate;
      summary.updatedAt = requirement.updatedAt;
    }
    project.updatedAt = requirement.updatedAt;
    upsertCurrentTimelineEvent(store, requirement, project, previousStatus);
    return clone(requirement);
  });
}

function timelineItemOrder(left: RequirementTimelineEvent, right: RequirementTimelineEvent) {
  return right.eventDate.localeCompare(left.eventDate)
    || (left.status === "online" ? -1 : 1) - (right.status === "online" ? -1 : 1)
    || right.recordedAt.localeCompare(left.recordedAt);
}

export async function listRequirementTimeline(view: RequirementTimelineView, cursor?: string): Promise<RequirementTimelinePage> {
  const store = await ensureStore();
  const events = (store.timelineEvents ?? [])
    .filter((event) => {
      const requirement = store.requirements.find((item) => item.code === event.requirementCode);
      const project = store.projects.find((item) => item.id === event.projectId);
      return Boolean(requirement && project && !archived(requirement) && !archived(project));
    })
    .toSorted(timelineItemOrder);
  const grouped = new Map<string, RequirementTimelineGroup>();
  for (const event of events) {
    const key = view === "month" ? event.eventDate.slice(0, 7) : event.version;
    const label = view === "month" ? `${Number(event.eventDate.slice(5, 7))}月` : event.version;
    const group = grouped.get(key) ?? { key, label, items: [] };
    group.items.push(event);
    grouped.set(key, group);
  }
  const groups = Array.from(grouped.values()).map((group) => ({ ...group, items: group.items.toSorted(timelineItemOrder) }));
  const orderedGroups = view === "month"
    ? groups.toSorted((left, right) => right.key.localeCompare(left.key))
    : groups.toSorted((left, right) => timelineItemOrder(left.items[0], right.items[0]));
  const startAt = cursor ? Math.max(0, orderedGroups.findIndex((group) => group.key === cursor) + 1) : 0;
  const pageSize = 3;
  const page = orderedGroups.slice(startAt, startAt + pageSize);
  return clone({ view, groups: page, nextCursor: startAt + pageSize < orderedGroups.length ? page.at(-1)?.key : undefined });
}

export async function listVersions(requirementCode: string) {
  const store = await ensureStore();
  return clone(store.versions.filter((item) => item.requirementCode === requirementCode).toSorted((a, b) => b.number - a.number));
}

export async function listVersionSummaries(requirementCode: string): Promise<RequirementVersionSummary[]> {
  const store = await ensureStore();
  return clone(store.versions
    .filter((item) => item.requirementCode === requirementCode)
    .toSorted((a, b) => b.number - a.number)
    .map(versionSummary));
}

export async function getVersion(requirementCode: string, versionNo: number) {
  const store = await ensureStore();
  const version = store.versions.find((item) => item.requirementCode === requirementCode && item.number === versionNo);
  if (!version) throw new Error("版本不存在。");
  return clone(version);
}

export async function listPrdComments(requirementCode: string, versionId: string, documentId: string) {
  const store = await ensureStore();
  return clone(store.comments
    .filter((item) => item.requirementCode === requirementCode && item.versionId === versionId && item.kind === "prd" && item.commentSchema === "prd_thread_v2" && item.documentId === documentId)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)));
}

export async function listHtmlComments(requirementCode: string, versionId: string, documentId: string) {
  const store = await ensureStore();
  return clone(store.comments
    .filter((item) => item.requirementCode === requirementCode && item.versionId === versionId && item.kind === "html" && item.commentSchema === "html_thread_v1" && item.documentId === documentId)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)));
}

export async function searchRequirements(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const store = await ensureStore();
  return clone(store.requirements.flatMap((requirement) => {
    const project = store.projects.find((item) => item.id === requirement.projectId);
    if (archived(requirement) || !project || archived(project)) return [];
    const currentVersion = store.versions.find((item) => item.id === requirement.currentVersionId);
    const documentText = currentVersion?.documents?.filter((document) => document.kind === "prd").map((document) => document.content ?? "").join(" ") ?? currentVersion?.prd ?? "";
    const haystack = `${requirement.code} ${requirement.title} ${documentText}`.toLowerCase();
    return haystack.includes(normalized) ? [{
      projectCode: project?.id,
      requirementCode: requirement.code,
      title: requirement.title,
      currentVersion: currentVersion?.number,
    }] : [];
  }));
}

/**
 * Latest effective product knowledge only. This is deliberately separate from
 * the legacy local retrieval helpers below: Dify is the assistant's only
 * product-knowledge retriever, while this function is the platform fact source
 * used for synchronization and post-retrieval permission checks.
 */
export type CurrentRequirementKnowledgeSource = {
  projectId: string;
  projectName: string;
  requirementCode: string;
  requirementName: string;
  versionNo: number;
  status: RequirementReleaseStatus;
  scheduleVersion?: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
  releaseVersion?: string;
  releaseDate?: string;
  sourceUpdatedAt: string;
  changeSummary: string;
  prdDocuments: Array<{ name: string; path: string; content: string }>;
  demoEntryUrl?: string;
  testCases: RequirementTestCase[];
};

export async function listCurrentRequirementKnowledgeSources() {
  const store = await ensureStore();
  const sources = store.requirements.flatMap((requirement) => {
    const project = store.projects.find((item) => item.id === requirement.projectId);
    const version = store.versions.find((item) => item.id === requirement.currentVersionId);
    if (!project || !version || archived(project) || archived(requirement)) return [];
    return [{
      projectId: project.id,
      projectName: project.name,
      requirementCode: requirement.code,
      requirementName: requirement.title,
      versionNo: version.number,
      status: releaseStatusOf(requirement),
      scheduleVersion: requirement.scheduleVersion,
      scheduledGrayDate: requirement.scheduledGrayDate,
      scheduledFullDate: requirement.scheduledFullDate,
      releaseVersion: requirement.releaseVersion,
      releaseDate: requirement.releaseDate,
      sourceUpdatedAt: requirement.updatedAt || version.publishedAt,
      changeSummary: version.changeSummary,
      prdDocuments: prdDocumentsForVersion(version).map((document) => ({ name: document.name, path: document.path, content: document.content ?? "" })),
      demoEntryUrl: version.demoEntryUrl,
      testCases: (store.testCases ?? []).filter((item) => item.requirementCode === requirement.code && item.versionNo === version.number),
    } satisfies CurrentRequirementKnowledgeSource];
  });
  return clone(sources);
}

function prdDocumentsForVersion(version: RequirementVersion) {
  const documents = version.documents?.filter((document) => document.kind === "prd" && document.content?.trim());
  return documents?.length ? documents : [{ id: `${version.id}:prd`, name: "PRD.md", path: "PRD.md", kind: "prd" as const, mimeType: "text/markdown", order: 0, content: version.prd }];
}

export type RequirementKnowledgeMatch = {
  id: string;
  requirementCode: string;
  title: string;
  versionNo: number;
  projectId: string;
  projectName: string;
  section: string;
  documentName?: string;
  documentPath?: string;
  excerpt: string;
  demoEntryUrl: string;
  isHistorical: boolean;
  releaseStatus: RequirementReleaseStatus;
  scheduleVersion?: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
  releaseVersion?: string;
  releaseDate?: string;
  testCases: Array<{ id: string; title: string; status: RequirementTestStatus; priority: RequirementTestCase["priority"]; module: string }>;
  matchedTerms: string[];
  /** Program-generated keyword score; only used for retrieval fallback, never shown as a business fact. */
  lexicalScore: number;
};

export type RequirementKnowledgeScope = "current-requirement" | "current-project" | "all-published";
export type ScopedRequirementKnowledgeInput = {
  query: string;
  scope: RequirementKnowledgeScope;
  requirementCode?: string;
  projectId?: string;
  versionNo?: number;
  includeHistory?: boolean;
  /** Include low-keyword sections so a configured semantic retriever can rank them. */
  includeSemanticCandidates?: boolean;
  limit?: number;
};
export type RequirementReleaseFact = {
  projectId: string;
  projectName: string;
  requirementCode: string;
  requirementName: string;
  versionNo: number;
  status: RequirementReleaseStatus;
  scheduleVersion?: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
  releaseVersion?: string;
  releaseDate?: string;
};
export type ScopedRequirementKnowledgeResult = {
  matches: RequirementKnowledgeMatch[];
  projectContext?: string;
  relatedRequirements: Array<{ code: string; title: string }>;
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

function prdSections(prd: string) {
  const lines = prd.replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ title: string; text: string }> = [];
  const hasSectionBody = (text: string) => text.split("\n").some((line) => line.trim() && !/^#{1,6}\s+/.test(line));
  let title = "PRD 正文";
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text && hasSectionBody(text)) sections.push({ title, text });
    buffer = [];
  };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      title = heading[2].trim();
      buffer.push(line);
    } else {
      buffer.push(line);
    }
  }
  flush();
  if (!sections.length && prd.trim() && hasSectionBody(prd.trim())) sections.push({ title: "PRD 正文", text: prd.trim() });
  return sections.flatMap((section) => {
    if (section.text.length <= 1400) return [section];
    const chunks: Array<{ title: string; text: string }> = [];
    for (let start = 0; start < section.text.length; start += 1200) {
      chunks.push({ title: section.title, text: section.text.slice(start, start + 1400) });
    }
    return chunks;
  });
}

function queryTerms(value: string) {
  const rawTerms = value.match(/[\u4e00-\u9fff]{2,}|[a-z0-9_-]+/gi) ?? [value];
  return Array.from(new Set(rawTerms.flatMap((term) => {
    if (!/[\u4e00-\u9fff]/.test(term) || term.length < 3) return [term.toLowerCase()];
    return Array.from({ length: term.length - 1 }, (_, index) => term.slice(index, index + 2).toLowerCase());
  })));
}

/** Small-team retrieval starts with current published PRD text and can expose semantic candidates on demand. */
function isHistoryQuestion(question: string) {
  return /历史|以前|之前|旧版|老版本|v\s*\d+|版本.*区别|什么时候.*(?:加|改)|最近.*(?:修改|变更)/i.test(question);
}

function projectContext(store: RequirementStore, project: Project) {
  const requirements = store.requirements
    .filter((item) => item.projectId === project.id && !archived(item))
    .map((item) => {
      const version = store.versions.find((candidate) => candidate.id === item.currentVersionId);
      const sections = version ? prdDocumentsForVersion(version).flatMap((document) => prdSections(document.content ?? "").slice(0, 4).map((section) => section.title)).join("、") : "";
      const release = releaseStatusOf(item) === "online"
        ? `已上线${item.releaseVersion ? ` · ${item.releaseVersion}` : ""}${item.releaseDate ? ` · ${item.releaseDate}` : ""}`
        : releaseStatusOf(item) === "scheduled"
          ? `已排期${item.scheduleVersion ? ` · ${item.scheduleVersion}` : ""}${item.scheduledFullDate ? ` · 预计全量 ${item.scheduledFullDate}` : ""}`
          : "未上线（规划中）";
      return `- ${item.code}《${item.title}》· ${release}${sections ? `：${sections}` : ""}`;
    });
  return [
    `项目名称：${project.name}`,
    `项目简介：${project.description || "当前项目未填写简介。"}`,
    "重要已发布需求：",
    requirements.length ? requirements.join("\n") : "（当前项目暂无已发布需求）",
    "说明：这份项目上下文仅用于理解问题和检索路由，具体业务规则必须以引用的 PRD 片段为准。",
  ].join("\n");
}

/** State facts are intentionally separate from PRD retrieval so status questions work even when a PRD has no matching section. */
export async function listScopedRequirementReleaseFacts(input: Omit<ScopedRequirementKnowledgeInput, "query" | "includeHistory" | "limit">): Promise<RequirementReleaseFact[]> {
  const store = await ensureStore();
  const scopedRequirement = input.requirementCode ? store.requirements.find((item) => item.code === input.requirementCode) : undefined;
  const scopedProjectId = input.scope === "current-requirement"
    ? scopedRequirement?.projectId
    : input.scope === "current-project" ? input.projectId : undefined;
  if (input.scope === "current-requirement" && !scopedRequirement) throw new Error("当前需求不存在。");
  if (input.scope === "current-project" && !scopedProjectId) throw new Error("当前项目不存在。");
  return clone(store.requirements.flatMap((requirement) => {
    const project = store.projects.find((item) => item.id === requirement.projectId);
    if (!project || archived(project) || archived(requirement)) return [];
    if (input.scope === "current-requirement" && requirement.code !== input.requirementCode) return [];
    if (input.scope === "current-project" && requirement.projectId !== scopedProjectId) return [];
    const version = store.versions.find((item) => item.id === requirement.currentVersionId);
    if (!version) return [];
    return [{
      projectId: project.id,
      projectName: project.name,
      requirementCode: requirement.code,
      requirementName: requirement.title,
      versionNo: version.number,
      status: releaseStatusOf(requirement),
      scheduleVersion: requirement.scheduleVersion,
      scheduledGrayDate: requirement.scheduledGrayDate,
      scheduledFullDate: requirement.scheduledFullDate,
      releaseVersion: requirement.releaseVersion,
      releaseDate: requirement.releaseDate,
    }];
  }).toSorted((left, right) => (right.releaseDate ?? "").localeCompare(left.releaseDate ?? "") || left.requirementCode.localeCompare(right.requirementCode)));
}

/**
 * Small-team RAG baseline: the program filters scope and archived data before any model call.
 * Every stored version is a published snapshot; history is only included for explicit version questions.
 */
export async function findScopedRequirementKnowledge(input: ScopedRequirementKnowledgeInput): Promise<ScopedRequirementKnowledgeResult> {
  const query = input.query.trim();
  if (!query) return { matches: [], relatedRequirements: [] };
  const terms = queryTerms(query);
  const broadQuestion = /需求库|有哪些|全部|概述|介绍|列表|项目|流程|异常|最近/.test(query);
  const includeHistory = input.includeHistory ?? isHistoryQuestion(query);
  const store = await ensureStore();
  const scopedRequirement = input.requirementCode ? store.requirements.find((item) => item.code === input.requirementCode) : undefined;
  const scopedProjectId = input.scope === "current-requirement"
    ? scopedRequirement?.projectId
    : input.scope === "current-project" ? input.projectId : undefined;
  if (input.scope === "current-requirement" && !scopedRequirement) throw new Error("当前需求不存在。");
  if (input.scope === "current-project" && !scopedProjectId) throw new Error("当前项目不存在。");

  const ranked = store.requirements.flatMap((requirement) => {
    const project = store.projects.find((item) => item.id === requirement.projectId);
    if (!project || archived(project) || archived(requirement)) return [];
    if (input.scope === "current-requirement" && requirement.code !== input.requirementCode) return [];
    if (input.scope === "current-project" && requirement.projectId !== scopedProjectId) return [];
    const versions = input.scope === "current-requirement" && input.versionNo
      ? store.versions.filter((version) => version.requirementCode === requirement.code && version.number === input.versionNo)
      : includeHistory
        ? store.versions.filter((version) => version.requirementCode === requirement.code)
        : store.versions.filter((version) => version.id === requirement.currentVersionId);
    return versions.flatMap((version) => prdDocumentsForVersion(version).flatMap((document) => prdSections(document.content ?? "").flatMap((section, sectionIndex) => {
      const fields = [requirement.code, requirement.title, project.name, version.changeSummary, section.title, section.text].map((value) => value.toLowerCase());
      const hits = terms.filter((term) => fields.some((field) => field.includes(term)));
      const exactCode = query.toLowerCase().includes(requirement.code.toLowerCase());
      const titleHits = terms.filter((term) => requirement.title.toLowerCase().includes(term)).length;
      const score = (exactCode ? 100 : 0) + titleHits * 10 + terms.filter((term) => section.title.toLowerCase().includes(term)).length * 7
        + terms.filter((term) => section.text.toLowerCase().includes(term)).length * 3 + (version.id === requirement.currentVersionId ? 2 : 0);
      if (!input.includeSemanticCandidates && !hits.length && !broadQuestion) return [];
      if (!input.includeSemanticCandidates && !broadQuestion && score < 3) return [];
      return [{
        id: `${requirement.code}:v${version.number}:s${sectionIndex}`,
        requirementCode: requirement.code,
        title: requirement.title,
        versionNo: version.number,
        projectId: project.id,
        projectName: project.name,
        section: section.title,
        documentName: document.name,
        documentPath: document.path,
        excerpt: relevantExcerpt(section.text, query, 1000),
        demoEntryUrl: version.demoEntryUrl,
        isHistorical: version.id !== requirement.currentVersionId,
        releaseStatus: releaseStatusOf(requirement),
        scheduleVersion: requirement.scheduleVersion,
        scheduledGrayDate: requirement.scheduledGrayDate,
        scheduledFullDate: requirement.scheduledFullDate,
        releaseVersion: requirement.releaseVersion,
        releaseDate: requirement.releaseDate,
        testCases: (store.testCases ?? []).filter((item) => item.requirementCode === requirement.code && item.versionNo === version.number).slice(0, 12).map((item) => ({ id: item.id, title: item.title, status: item.status, priority: item.priority, module: item.module })),
        matchedTerms: hits.slice(0, 8),
        lexicalScore: score,
      }];
    })));
  }).toSorted((left, right) => right.lexicalScore - left.lexicalScore || left.requirementCode.localeCompare(right.requirementCode));
  const limit = Math.max(1, Math.min(input.limit ?? 6, input.includeSemanticCandidates ? 24 : 8));
  const matches = ranked.slice(0, limit) as RequirementKnowledgeMatch[];
  const relatedRequirements = Array.from(new Map(matches
    .filter((match) => match.requirementCode !== input.requirementCode)
    .map((match) => [match.requirementCode, { code: match.requirementCode, title: match.title }])).values()).slice(0, 5);
  const contextProject = scopedProjectId ? store.projects.find((project) => project.id === scopedProjectId) : undefined;
  return clone({ matches, relatedRequirements, projectContext: contextProject ? projectContext(store, contextProject) : undefined });
}

/** Backward-compatible global current-version search used by MCP and legacy callers. */
export async function findRequirementKnowledge(query: string, limit = 4): Promise<RequirementKnowledgeMatch[]> {
  return (await findScopedRequirementKnowledge({ query, scope: "all-published", limit })).matches;
}

function prdCommentAnchor(value: PrdCommentAnchor) {
  const quote = value.quote.trim();
  const prefix = value.prefix.trim();
  const suffix = value.suffix.trim();
  if (!value.documentId || !value.documentPath || !quote || quote.length > 1200) throw new Error("PRD 评论必须关联一段有效原文。");
  if (!Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start < 0 || value.end < value.start || !Number.isInteger(value.blockIndex) || value.blockIndex < 0) throw new Error("PRD 评论定位信息无效。");
  if (prefix.length > 160 || suffix.length > 160) throw new Error("PRD 评论上下文过长。");
  return { ...value, quote, prefix, suffix };
}

function htmlCommentAnchor(value: HtmlCommentAnchor) {
  const quote = value.quote.trim();
  const selector = value.selector.trim();
  if (!value.documentId || !value.documentPath || !selector || !quote || quote.length > 500) throw new Error("HTML 评论必须关联一个有效页面区域。");
  if (![value.x, value.y, value.width, value.height].every((item) => Number.isFinite(item)) || value.width <= 0 || value.height <= 0) throw new Error("HTML 评论定位信息无效。");
  return { ...value, quote, selector, x: Math.max(0, value.x), y: Math.max(0, value.y), width: value.width, height: value.height };
}

function isPrdDocument(version: RequirementVersion, documentId: string) {
  return documentId === `${version.id}:legacy-prd` || Boolean(version.documents?.some((document) => document.id === documentId && document.kind === "prd"));
}

function isDemoDocument(version: RequirementVersion, documentId: string) {
  return documentId === `${version.id}:legacy-demo` || Boolean(version.documents?.some((document) => document.id === documentId && document.kind === "demo"));
}

function commentTone(actorId: string) {
  return (["blue", "green", "violet"] as const)[Math.abs([...actorId].reduce((total, letter) => total + letter.charCodeAt(0), 0)) % 3];
}

function sameActor(comment: RequirementComment, actor?: { id: string; name: string }) {
  const actorId = actor?.id || "local-dev-user";
  return comment.authorId ? comment.authorId === actorId : comment.author === (actor?.name || "本地开发身份");
}

export async function addPrdComment(requirementCode: string, versionId: string, content: string, anchor: PrdCommentAnchor, actor?: { id: string; name: string }) {
  const value = content.trim();
  if (!value || value.length > 2000) throw new Error("评论内容不能为空且不能超过 2000 字。");
  return mutate((store) => {
    const version = store.versions.find((item) => item.id === versionId && item.requirementCode === requirementCode);
    if (!version) throw new Error("评论必须关联已有需求版本。");
    if (!isPrdDocument(version, anchor.documentId)) throw new Error("PRD 文档不存在或不属于当前版本。");
    const validatedAnchor = prdCommentAnchor(anchor);
    const actorId = actor?.id || "local-dev-user";
    const comment: RequirementComment = {
      id: randomUUID(),
      requirementCode,
      versionId,
      kind: "prd",
      commentSchema: "prd_thread_v2",
      documentId: validatedAnchor.documentId,
      documentPath: validatedAnchor.documentPath,
      anchor: validatedAnchor,
      authorId: actorId,
      author: actor?.name || "本地开发身份",
      initials: (actor?.name || "本").slice(0, 1),
      tone: commentTone(actorId),
      createdAt: now(),
      content: value,
    };
    store.comments.push(comment);
    return clone(comment);
  });
}

export async function addHtmlComment(requirementCode: string, versionId: string, content: string, anchor: HtmlCommentAnchor, actor?: { id: string; name: string }) {
  const value = content.trim();
  if (!value || value.length > 2000) throw new Error("评论内容不能为空且不能超过 2000 字。");
  return mutate((store) => {
    const version = store.versions.find((item) => item.id === versionId && item.requirementCode === requirementCode);
    if (!version) throw new Error("评论必须关联已有需求版本。");
    if (!isDemoDocument(version, anchor.documentId)) throw new Error("HTML 文档不存在或不属于当前版本。");
    const validatedAnchor = htmlCommentAnchor(anchor);
    const actorId = actor?.id || "local-dev-user";
    const comment: RequirementComment = {
      id: randomUUID(), requirementCode, versionId, kind: "html", commentSchema: "html_thread_v1", documentId: validatedAnchor.documentId, documentPath: validatedAnchor.documentPath, anchor: validatedAnchor,
      authorId: actorId, author: actor?.name || "本地开发身份", initials: (actor?.name || "本").slice(0, 1), tone: commentTone(actorId), createdAt: now(), content: value,
    };
    store.comments.push(comment);
    return clone(comment);
  });
}

export async function replyPrdComment(requirementCode: string, versionId: string, documentId: string, parentId: string, content: string, actor?: { id: string; name: string }) {
  const value = content.trim();
  if (!value || value.length > 2000) throw new Error("回复内容不能为空且不能超过 2000 字。");
  return mutate((store) => {
    const parent = store.comments.find((item) => item.id === parentId && !item.parentId);
    if (!parent || parent.kind !== "prd" || parent.commentSchema !== "prd_thread_v2" || parent.requirementCode !== requirementCode || parent.versionId !== versionId || parent.documentId !== documentId) throw new Error("回复目标不存在或不属于当前 PRD。");
    const actorId = actor?.id || "local-dev-user";
    const reply: RequirementComment = {
      id: randomUUID(), requirementCode, versionId, kind: "prd", commentSchema: "prd_thread_v2", documentId, documentPath: parent.documentPath,
      parentId, authorId: actorId, author: actor?.name || "本地开发身份", initials: (actor?.name || "本").slice(0, 1), tone: commentTone(actorId), createdAt: now(), content: value,
    };
    store.comments.push(reply);
    return clone(reply);
  });
}

export async function replyHtmlComment(requirementCode: string, versionId: string, documentId: string, parentId: string, content: string, actor?: { id: string; name: string }) {
  const value = content.trim();
  if (!value || value.length > 2000) throw new Error("回复内容不能为空且不能超过 2000 字。");
  return mutate((store) => {
    const parent = store.comments.find((item) => item.id === parentId && !item.parentId);
    if (!parent || parent.kind !== "html" || parent.commentSchema !== "html_thread_v1" || parent.requirementCode !== requirementCode || parent.versionId !== versionId || parent.documentId !== documentId) throw new Error("回复目标不存在或不属于当前 HTML。");
    const actorId = actor?.id || "local-dev-user";
    const reply: RequirementComment = {
      id: randomUUID(), requirementCode, versionId, kind: "html", commentSchema: "html_thread_v1", documentId, documentPath: parent.documentPath,
      parentId, authorId: actorId, author: actor?.name || "本地开发身份", initials: (actor?.name || "本").slice(0, 1), tone: commentTone(actorId), createdAt: now(), content: value,
    };
    store.comments.push(reply);
    return clone(reply);
  });
}

export async function updatePrdComment(commentId: string, content: string, actor?: { id: string; name: string }) {
  const value = content.trim();
  if (!value || value.length > 2000) throw new Error("评论内容不能为空且不能超过 2000 字。");
  return mutate((store) => {
    const comment = store.comments.find((item) => item.id === commentId && ((item.kind === "prd" && item.commentSchema === "prd_thread_v2") || (item.kind === "html" && item.commentSchema === "html_thread_v1")));
    if (!comment) throw new Error("评论不存在。");
    if (comment.deletedAt) throw new Error("已删除的评论不能修改。");
    if (!sameActor(comment, actor)) throw new Error("只能修改自己的评论。");
    comment.content = value;
    comment.updatedAt = now();
    return clone(comment);
  });
}

export async function deletePrdComment(commentId: string, actor?: { id: string; name: string }) {
  return mutate((store) => {
    const comment = store.comments.find((item) => item.id === commentId && ((item.kind === "prd" && item.commentSchema === "prd_thread_v2") || (item.kind === "html" && item.commentSchema === "html_thread_v1")));
    if (!comment) throw new Error("评论不存在。");
    if (comment.deletedAt) return clone(comment);
    if (!sameActor(comment, actor)) throw new Error("只能删除自己的评论。");
    comment.deletedAt = now();
    comment.deletedBy = actor?.id || "local-dev-user";
    comment.content = "";
    return clone(comment);
  });
}

export type ProcessRequirementDiscussionInput = {
  resolution: "resolved" | "rejected" | "related_requirement";
  note: string;
  relatedRequirementCode?: string;
};

function discussionOwner(discussion: RequirementDiscussion, actor?: { id: string; name: string }) {
  const actorId = actor?.id || "local-dev-user";
  return discussion.authorId ? discussion.authorId === actorId : discussion.author === (actor?.name || "本地开发身份");
}

function discussionHandler(requirement: Requirement, actor?: { id: string; name: string }, canManage = false) {
  if (canManage) return true;
  const actorId = actor?.id || "local-dev-user";
  return Boolean((requirement.ownerId && requirement.ownerId === actorId) || (requirement.owner && requirement.owner === (actor?.name || "本地开发身份")));
}

export async function listRequirementDiscussions(requirementCode: string) {
  const store = await ensureStore();
  if (!store.requirements.some((item) => item.code === requirementCode)) throw new Error("需求不存在。");
  return clone((store.discussions ?? []).filter((item) => item.requirementCode === requirementCode).toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)));
}

export async function addRequirementDiscussion(requirementCode: string, content: string, actor?: { id: string; name: string }) {
  const value = content.trim();
  if (!value || value.length > 2000) throw new Error("讨论内容不能为空且不能超过 2000 字。");
  return mutate((store) => {
    if (!store.requirements.some((item) => item.code === requirementCode)) throw new Error("需求不存在。");
    const actorId = actor?.id || "local-dev-user";
    const discussion: RequirementDiscussion = { id: randomUUID(), requirementCode, authorId: actorId, author: actor?.name || "本地开发身份", initials: (actor?.name || "本").slice(0, 1), tone: commentTone(actorId), content: value, createdAt: now(), status: "open" };
    store.discussions ??= [];
    store.discussions.push(discussion);
    return clone(discussion);
  });
}

export async function replyRequirementDiscussion(requirementCode: string, parentId: string, content: string, actor?: { id: string; name: string }) {
  const value = content.trim();
  if (!value || value.length > 2000) throw new Error("回复内容不能为空且不能超过 2000 字。");
  return mutate((store) => {
    const parent = (store.discussions ?? []).find((item) => item.id === parentId && !item.parentId && item.requirementCode === requirementCode);
    if (!parent) throw new Error("讨论不存在或不属于当前需求。");
    const actorId = actor?.id || "local-dev-user";
    const reply: RequirementDiscussion = { id: randomUUID(), requirementCode, parentId, authorId: actorId, author: actor?.name || "本地开发身份", initials: (actor?.name || "本").slice(0, 1), tone: commentTone(actorId), content: value, createdAt: now() };
    store.discussions ??= [];
    store.discussions.push(reply);
    return clone(reply);
  });
}

export async function updateRequirementDiscussion(discussionId: string, content: string, actor?: { id: string; name: string }) {
  const value = content.trim();
  if (!value || value.length > 2000) throw new Error("讨论内容不能为空且不能超过 2000 字。");
  return mutate((store) => {
    const discussion = (store.discussions ?? []).find((item) => item.id === discussionId);
    if (!discussion) throw new Error("讨论不存在。");
    if (discussion.deletedAt) throw new Error("已删除的讨论不能修改。");
    if (!discussionOwner(discussion, actor)) throw new Error("只能修改自己的讨论或回复。");
    discussion.content = value;
    discussion.updatedAt = now();
    return clone(discussion);
  });
}

export async function deleteRequirementDiscussion(discussionId: string, actor?: { id: string; name: string }) {
  return mutate((store) => {
    const discussion = (store.discussions ?? []).find((item) => item.id === discussionId);
    if (!discussion) throw new Error("讨论不存在。");
    if (discussion.deletedAt) return clone(discussion);
    if (!discussionOwner(discussion, actor)) throw new Error("只能删除自己的讨论或回复。");
    discussion.deletedAt = now();
    discussion.content = "";
    return clone(discussion);
  });
}

export async function processRequirementDiscussion(requirementCode: string, discussionId: string, input: ProcessRequirementDiscussionInput, actor?: { id: string; name: string }, canManage = false) {
  const note = input.note.trim();
  if (!note || note.length > 2000) throw new Error("处理说明不能为空且不能超过 2000 字。");
  if (input.resolution === "related_requirement" && !input.relatedRequirementCode?.trim()) throw new Error("转为其他需求时必须填写关联需求编号。");
  return mutate((store) => {
    const requirement = store.requirements.find((item) => item.code === requirementCode);
    const discussion = (store.discussions ?? []).find((item) => item.id === discussionId && !item.parentId && item.requirementCode === requirementCode);
    if (!requirement || !discussion) throw new Error("讨论不存在或不属于当前需求。");
    if (!discussionHandler(requirement, actor, canManage)) throw new Error("只有需求负责人、发布人或管理员可以处理讨论。");
    discussion.status = "closed";
    discussion.resolution = input.resolution;
    discussion.resolutionNote = note;
    discussion.relatedRequirementCode = input.resolution === "related_requirement" ? input.relatedRequirementCode?.trim() : undefined;
    discussion.handledAt = now();
    discussion.handledBy = actor?.name || "本地开发身份";
    return clone(discussion);
  });
}

export async function listRequirementGaps(requirementCode: string) {
  const store = await ensureStore();
  return clone((store.gaps ?? []).filter((gap) => gap.requirementCode === requirementCode && gap.status === "open").toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)));
}

export async function addRequirementGap(requirementCode: string, question: string, actor?: { id: string; name: string }): Promise<RequirementGap> {
  const value = question.trim();
  if (!value || value.length > 2000) throw new Error("待补充问题不能为空且不能超过 2000 字。");
  return mutate((store) => {
    const requirement = store.requirements.find((item) => item.code === requirementCode);
    if (!requirement || archived(requirement)) throw new Error("需求不存在或已作废。");
    const existing = (store.gaps ?? []).find((gap) => gap.requirementCode === requirementCode && gap.status === "open" && gap.question === value);
    if (existing) return clone(existing);
    const gap: RequirementGap = { id: `gap_${randomUUID().replaceAll("-", "")}`, requirementCode, question: value, source: "assistant", status: "open", createdAt: now(), createdBy: actor?.name || "本地开发身份" };
    (store.gaps ??= []).push(gap);
    return clone(gap);
  });
}

export async function listVersionTestCases(requirementCode: string, versionNo: number) {
  const store = await ensureStore();
  return clone((store.testCases ?? []).filter((item) => item.requirementCode === requirementCode && item.versionNo === versionNo).toSorted((left, right) => left.id.localeCompare(right.id)));
}

/** Lightweight, version-scoped lookup used by the requirement assistant for test questions. */
export async function findRelevantTestCases(requirementCode: string, versionNo: number, query: string) {
  const cases = await listVersionTestCases(requirementCode, versionNo);
  const terms = queryTerms(query);
  if (!terms.length) return cases.slice(0, 5);
  return cases
    .map((item) => {
      const haystack = [item.id, item.title, item.module, item.prdSource, ...item.preconditions, ...item.steps.map((step) => step.action), ...item.expectedResults].join(" ").toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .toSorted((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
    .slice(0, 5)
    .map(({ item }) => item);
}

export async function replaceVersionTestCases(requirementCode: string, versionNo: number, cases: Omit<RequirementTestCase, "id" | "requirementCode" | "versionNo" | "createdAt" | "updatedAt">[]) {
  return mutate((store) => {
    const version = store.versions.find((item) => item.requirementCode === requirementCode && item.number === versionNo);
    if (!version) throw new Error("需求版本不存在。");
    const timestamp = now();
    store.testCases = (store.testCases ?? []).filter((item) => item.requirementCode !== requirementCode || item.versionNo !== versionNo);
    const saved = cases.slice(0, 80).map((item, index) => ({ ...item, id: `TC-${String(index + 1).padStart(3, "0")}`, requirementCode, versionNo, createdAt: timestamp, updatedAt: timestamp }));
    store.testCases.push(...saved);
    return clone(saved);
  });
}

export async function updateVersionTestCaseStatus(requirementCode: string, versionNo: number, testCaseId: string, status: RequirementTestStatus) {
  return mutate((store) => {
    const item = (store.testCases ?? []).find((candidate) => candidate.requirementCode === requirementCode && candidate.versionNo === versionNo && candidate.id === testCaseId);
    if (!item) throw new Error("测试用例不存在。");
    item.status = status;
    item.updatedAt = now();
    return clone(item);
  });
}

type DemoAnalysis = { summary: string; demoIds: string[]; supportsAutomation: boolean };

const TEST_CASE_PRD_CONTEXT_LIMIT = 18_000;

function compactTestCasePrd(prd: string) {
  if (prd.length <= TEST_CASE_PRD_CONTEXT_LIMIT) return prd;
  let remaining = TEST_CASE_PRD_CONTEXT_LIMIT;
  const sections: string[] = [];
  for (const section of prdSections(prd)) {
    if (remaining <= 0) break;
    const value = `${section.title}\n${section.text}`.slice(0, Math.min(1_800, remaining));
    sections.push(value);
    remaining -= value.length;
  }
  return `${sections.join("\n\n")}\n\n（PRD 较长，已按章节提取测试所需上下文。）`;
}

function decodeDemoText(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

async function analyseDemo(entryUrl: string): Promise<DemoAnalysis> {
  const relative = /^\/demo-assets\/(.+)$/.exec(entryUrl)?.[1];
  if (!relative) return { summary: "当前版本没有可读取的 Demo 页面。", demoIds: [], supportsAutomation: false };
  const segments = relative.split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\/]/.test(segment))) {
    return { summary: "当前版本的 Demo 路径不合法，无法分析。", demoIds: [], supportsAutomation: false };
  }
  const filePath = path.resolve(PUBLISHED_DEMO_DIR, ...segments);
  if (!filePath.startsWith(`${PUBLISHED_DEMO_DIR}${path.sep}`)) return { summary: "当前版本的 Demo 路径不合法，无法分析。", demoIds: [], supportsAutomation: false };
  try {
    const html = await readFile(filePath, "utf8");
    const demoIds = Array.from(new Set(Array.from(html.matchAll(/\bdata-demo-id\s*=\s*["']([^"']+)["']/gi), (match) => match[1].trim()).filter(Boolean))).slice(0, 80);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
    const text = decodeDemoText(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 1800);
    const supportsAutomation = /addEventListener\s*\(\s*["']message["']|onmessage\s*=/.test(html) && /postMessage\s*\(/.test(html);
    return { summary: `页面标题：${decodeDemoText(title).trim() || "未设置"}\n页面可见文本：${text || "未提取到"}`, demoIds, supportsAutomation };
  } catch {
    return { summary: "Demo 文件暂时无法读取。", demoIds: [], supportsAutomation: false };
  }
}

async function readDemoSource(entryUrl: string) {
  const relative = /^\/demo-assets\/(.+)$/.exec(entryUrl)?.[1];
  if (!relative) return "";
  const segments = relative.split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\/]/.test(segment))) return "";
  const filePath = path.resolve(PUBLISHED_DEMO_DIR, ...segments);
  if (!filePath.startsWith(`${PUBLISHED_DEMO_DIR}${path.sep}`)) return "";
  try { return (await readFile(filePath, "utf8")).slice(0, 60_000); } catch { return ""; }
}

export async function getTestCaseGenerationContext(requirementCode: string, versionNo: number) {
  const store = await ensureStore();
  const requirement = store.requirements.find((item) => item.code === requirementCode);
  const version = store.versions.find((item) => item.requirementCode === requirementCode && item.number === versionNo);
  const project = requirement ? store.projects.find((item) => item.id === requirement.projectId) : undefined;
  if (!requirement || !version || !project || archived(requirement) || archived(project)) throw new Error("需求或版本不存在，或已作废。");
  const demo = await analyseDemo(version.demoEntryUrl);
  const historicalTestCases = (store.testCases ?? [])
    .filter((item) => item.requirementCode === requirementCode && item.versionNo !== versionNo)
    .toSorted((left, right) => right.versionNo - left.versionNo || left.id.localeCompare(right.id))
    .slice(0, 15)
    .map((item) => ({ versionNo: item.versionNo, id: item.id, title: item.title, module: item.module, priority: item.priority, type: item.type, prdSource: item.prdSource }));
  return clone({ projectName: project.name, requirementCode, requirementTitle: requirement.title, versionNo, prd: compactTestCasePrd(version.prd), changeSummary: version.changeSummary, demoEntryUrl: version.demoEntryUrl, demoSummary: demo.summary, demoIds: demo.demoIds, demoSupportsAutomation: demo.supportsAutomation, historicalTestCases });
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
    if (archived(project)) throw new Error("已作废项目不能发布需求，请先恢复项目。");
    if (!artifact) throw new Error("Demo 工件不存在。");

    const requirementCode = requestedRequirementCode || nextRequirementCode(project.id, store);
    let requirement = store.requirements.find((item) => item.code === requirementCode);
    if (requirement?.archivedAt) throw new Error("已作废需求不能发布新版本，请先恢复需求。");
    if (!requirement) {
      requirement = { id: requirementCode, projectId: project.id, code: requirementCode, title, currentVersionId: "", createdAt: now(), updatedAt: now(), owner: input.actor?.name || "张三（本地开发身份）", ownerId: input.actor?.id, status: "offline" };
      store.requirements.push(requirement);
      project.requirements.push({ code: requirementCode, title, latestVersion: 0, createdAt: requirement.createdAt, updatedAt: requirement.updatedAt, owner: requirement.owner, ownerId: requirement.ownerId, status: "offline" });
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
      documents: [
        { id: `${requirementCode}:v${number}:prd`, name: "PRD.md", path: "PRD.md", kind: "prd", mimeType: "text/markdown", order: 0, content: prdMarkdown },
        { id: `${requirementCode}:v${number}:demo`, name: artifact.entryFile, path: artifact.entryFile, kind: "demo", mimeType: mimeType(artifact.entryFile), order: 0, url: demoEntryUrl },
      ],
    };
    store.versions.push(version);
    requirement.title = title;
    requirement.currentVersionId = version.id;
    // 每次发布新版本都由当前操作者接手维护，负责人和版本更新人保持一致。
    if (input.actor) {
      requirement.owner = input.actor.name;
      requirement.ownerId = input.actor.id;
    }
    requirement.updatedAt = version.publishedAt;
    const summary = project.requirements.find((item) => item.code === requirementCode);
    if (summary) {
      summary.title = title;
      summary.latestVersion = number;
      summary.createdAt = requirement.createdAt;
      summary.updatedAt = requirement.updatedAt;
      summary.owner = requirement.owner ?? version.publisher;
      summary.ownerId = requirement.ownerId;
    }
    project.updatedAt = version.publishedAt.slice(0, 10);
    return clone({ requirement, version, url: `/r/${requirementCode}` });
  });
}

async function legacyManifest(store: RequirementStore, version: RequirementVersion) {
  if (version.assetManifest) return version.assetManifest;
  const artifact = store.artifacts.find((item) => item.id === version.artifactId);
  if (!artifact) throw new Error("历史版本缺少可恢复的 Demo 工件。");
  const root = path.join(ARTIFACT_DIR, artifact.id);
  const entries: Array<{ path: string; data: Buffer }> = [{ path: "PRD.md", data: Buffer.from(version.prd, "utf8") }];
  async function visit(folder: string, relative = "") : Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const source = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(source, nextRelative);
      else if (entry.isFile()) entries.push({ path: `demo/${safeAssetPath(nextRelative)}`, data: await readFile(source) });
    }
  }
  await visit(root);
  return snapshotFromEntries(entries);
}

export async function publishRequirementSnapshot(input: PublishRequirementSnapshotInput) {
  const requirementCode = input.requirementCode.trim();
  const changeSummary = input.changeSummary.trim();
  safeSegment(requirementCode, "需求编码");
  if (!changeSummary || changeSummary.length > 1000) throw new Error("版本说明不能为空且不能超过 1000 字。");
  const entries = await parseSnapshotArchive(input.archive);
  const manifest = await snapshotFromEntries(entries);
  const primaryPrd = entries.find((entry) => entry.path === "PRD.md") ?? entries.filter((entry) => /^prd\/.+\.(?:md|markdown)$/i.test(entry.path)).toSorted((left, right) => left.path.localeCompare(right.path))[0];
  const prd = primaryPrd?.data.toString("utf8").trim();
  if (!prd) throw new Error("PRD.md 或 prd/ 下的首个 Markdown 不能为空。");
  return mutate(async (store) => {
    const requirement = store.requirements.find((item) => item.code === requirementCode);
    if (!requirement) throw new Error("需求不存在。");
    const project = store.projects.find((item) => item.id === requirement.projectId);
    if (!project) throw new Error("需求所属项目不存在。");
    if (archived(project) || archived(requirement)) throw new Error("已作废项目或需求不能发布新版本，请先恢复后再操作。");
    const number = store.versions.filter((item) => item.requirementCode === requirementCode).reduce((max, item) => Math.max(max, item.number), 0) + 1;
    const demoEntryUrl = await materializeSnapshotDemo(manifest, project.id, requirementCode, number);
    const version: RequirementVersion = { id: randomUUID(), requirementCode, number, publishedAt: now(), publisher: input.actor?.name || "本地开发身份", changeSummary, prd, demoEntryUrl, artifactId: `snapshot_${randomUUID().replaceAll("-", "")}`, versionName: input.versionName?.trim().slice(0, 80) || undefined, assetManifest: manifest, documents: documentsForSnapshot(entries, project.id, requirementCode, number) };
    store.versions.push(version);
    if (input.setCurrent !== false) {
      requirement.currentVersionId = version.id;
      requirement.updatedAt = version.publishedAt;
      requirement.title = requirement.title;
      if (input.actor) {
        requirement.owner = input.actor.name;
        requirement.ownerId = input.actor.id;
      }
      const summary = project.requirements.find((item) => item.code === requirementCode);
      if (summary) { summary.latestVersion = number; summary.updatedAt = version.publishedAt; summary.owner = requirement.owner ?? version.publisher; summary.ownerId = requirement.ownerId; }
      project.updatedAt = version.publishedAt.slice(0, 10);
    }
    return clone({ requirement, version, url: `/r/${requirementCode}` });
  });
}

export async function downloadRequirementVersion(requirementCode: string, versionNo: number) {
  const store = await ensureStore();
  const version = store.versions.find((item) => item.requirementCode === requirementCode && item.number === versionNo);
  if (!version) throw new Error("版本不存在。");
  const manifest = await legacyManifest(store, version);
  const archive = new AdmZip();
  for (const file of manifest.files) archive.addFile(file.path, await readFile(path.join(ASSET_OBJECT_DIR, file.hash)));
  archive.addFile("requirement.json", Buffer.from(JSON.stringify({ requirementCode, version: `v${version.number}`, createdAt: version.publishedAt, files: manifest.files }, null, 2), "utf8"));
  return { name: `${requirementCode}-v${version.number}.zip`, body: archive.toBuffer(), manifest };
}

export async function downloadRequirementDocument(
  requirementCode: string,
  versionNo: number,
  kind: "prd" | "demo",
  documentPath?: string,
) {
  safeSegment(requirementCode, "需求编码");
  if (!Number.isInteger(versionNo) || versionNo < 1) throw new Error("版本号不合法。");
  const store = await ensureStore();
  const version = store.versions.find((item) => item.requirementCode === requirementCode && item.number === versionNo);
  if (!version) throw new Error("版本不存在。");

  const requestedPath = documentPath ? safeAssetPath(documentPath) : undefined;
  const documents = version.documents?.filter((document) => document.kind === kind) ?? [];
  const requestedDocument = requestedPath ? documents.find((document) => safeAssetPath(document.path) === requestedPath) : undefined;
  if (requestedPath && !requestedDocument && version.assetManifest) throw new Error("文档不存在或类型不匹配。");

  if (version.assetManifest) {
    const manifestCandidates = version.assetManifest.files.filter((file) => kind === "prd" ? /^PRD\.md$/i.test(file.path) || /^prd\/.*\.(?:md|markdown)$/i.test(file.path) : file.path.startsWith("demo/") && /\.html?$/i.test(file.path));
    const selectedPath = requestedDocument?.path ?? requestedPath ?? documents[0]?.path ?? (kind === "prd" ? manifestCandidates[0]?.path : manifestCandidates.find((file) => file.path.toLowerCase() === "demo/index.html")?.path ?? manifestCandidates[0]?.path);
    if (!selectedPath) throw new Error(`${kind === "prd" ? "PRD" : "Demo"} 文件不存在。`);
    const file = version.assetManifest.files.find((entry) => entry.path === safeAssetPath(selectedPath) && (kind === "prd" ? /^PRD\.md$/i.test(entry.path) || /^prd\/.*\.(?:md|markdown)$/i.test(entry.path) : entry.path.startsWith("demo/") && /\.html?$/i.test(entry.path)));
    if (!file) throw new Error("文档不存在或类型不匹配。");
    return { name: path.posix.basename(file.path), body: await readFile(path.join(ASSET_OBJECT_DIR, file.hash)), mimeType: file.mimeType || mimeType(file.path) };
  }

  if (kind === "prd") {
    const name = path.posix.basename(requestedDocument?.path ?? requestedPath ?? "PRD.md");
    if (!/\.(?:md|markdown)$/i.test(name)) throw new Error("PRD 文件类型不合法。");
    return { name, body: Buffer.from(version.prd, "utf8"), mimeType: mimeType(name) };
  }

  const artifact = store.artifacts.find((item) => item.id === version.artifactId);
  if (!artifact) throw new Error("历史版本缺少可下载的 Demo 工件。");
  const rawEntryPath = requestedDocument?.path ?? requestedPath ?? artifact.entryFile;
  const entryPath = safeAssetPath(rawEntryPath.startsWith("demo/") ? rawEntryPath.slice("demo/".length) : rawEntryPath);
  if (entryPath.includes("/") || !/\.html?$/i.test(entryPath)) throw new Error("Demo 文件类型不合法。");
  const filePath = path.resolve(ARTIFACT_DIR, artifact.id, entryPath);
  const artifactRoot = path.resolve(ARTIFACT_DIR, artifact.id);
  if (!filePath.startsWith(`${artifactRoot}${path.sep}`)) throw new Error("Demo 文件路径不合法。");
  return { name: path.posix.basename(entryPath), body: await readFile(filePath), mimeType: mimeType(entryPath) };
}

export async function restoreRequirementVersion(requirementCode: string, sourceVersionNo: number, actor?: { id: string; name: string }) {
  return mutate(async (store) => {
    const requirement = store.requirements.find((item) => item.code === requirementCode);
    const source = store.versions.find((item) => item.requirementCode === requirementCode && item.number === sourceVersionNo);
    if (!requirement || !source) throw new Error("需求或历史版本不存在。");
    const project = store.projects.find((item) => item.id === requirement.projectId);
    if (!project) throw new Error("需求所属项目不存在。");
    if (archived(project) || archived(requirement)) throw new Error("已作废项目或需求不能恢复版本，请先恢复后再操作。");
    const manifest = await legacyManifest(store, source);
    const number = store.versions.filter((item) => item.requirementCode === requirementCode).reduce((max, item) => Math.max(max, item.number), 0) + 1;
    const demoEntryUrl = await materializeSnapshotDemo(manifest, project.id, requirementCode, number);
    const restoredEntries = await Promise.all(manifest.files.map(async (file) => ({ path: file.path, data: await readFile(path.join(ASSET_OBJECT_DIR, file.hash)) })));
    const version: RequirementVersion = { id: randomUUID(), requirementCode, number, publishedAt: now(), publisher: actor?.name || "本地开发身份", changeSummary: `从 V${sourceVersionNo} 恢复`, prd: source.prd, demoEntryUrl, artifactId: `restore_${source.id}`, sourceVersionNo, assetManifest: manifest, documents: documentsForSnapshot(restoredEntries, project.id, requirementCode, number) };
    store.versions.push(version);
    requirement.currentVersionId = version.id;
    requirement.updatedAt = version.publishedAt;
    if (actor) {
      requirement.owner = actor.name;
      requirement.ownerId = actor.id;
    }
    const summary = project.requirements.find((item) => item.code === requirementCode);
    if (summary) { summary.latestVersion = number; summary.updatedAt = version.publishedAt; summary.owner = requirement.owner ?? version.publisher; summary.ownerId = requirement.ownerId; }
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
