import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CurrentRequirementKnowledgeSource } from "@/services/requirement/repository";
import { listCurrentRequirementKnowledgeSources } from "@/services/requirement/repository";
import { DifyKnowledgeClient, DifyKnowledgeError, isDifyKnowledgeConfigured, type DifyKnowledgeMetadata } from "@/services/assistant/dify-knowledge-client";

export type KnowledgeContentType = "requirement_summary" | "prd" | "test_case";
export type KnowledgeSyncEntry = {
  key: string;
  projectId: string;
  requirementCode: string;
  contentType: KnowledgeContentType;
  documentId?: string;
  checksum: string;
  updatedAt: string;
  failedAt?: string;
  lastError?: string;
};

type SyncStore = { schemaVersion: 1; entries: KnowledgeSyncEntry[] };
type SyncDocument = { key: string; contentType: KnowledgeContentType; name: string; text: string; metadata: DifyKnowledgeMetadata };

const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(process.cwd(), "data", "requirement-platform");
const STORE_FILE = path.join(DATA_DIR, "dify-knowledge-sync.local.json");
let mutationQueue = Promise.resolve();
let backgroundSync = Promise.resolve();

function now() {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date()).replaceAll("/", "-");
}

function checksum(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function readStore(): Promise<SyncStore> {
  try {
    const parsed = JSON.parse(await readFile(STORE_FILE, "utf8")) as Partial<SyncStore>;
    return { schemaVersion: 1, entries: Array.isArray(parsed.entries) ? parsed.entries.filter((entry): entry is KnowledgeSyncEntry => Boolean(entry?.key && entry.contentType)) : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { schemaVersion: 1, entries: [] };
    throw error;
  }
}

async function writeStore(store: SyncStore) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${STORE_FILE}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, STORE_FILE);
}

async function mutate<T>(operation: (store: SyncStore) => Promise<T> | T): Promise<T> {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const store = await readStore();
    const result = await operation(store);
    await writeStore(store);
    return result;
  } finally {
    release();
  }
}

function metadata(source: CurrentRequirementKnowledgeSource, contentType: KnowledgeContentType): DifyKnowledgeMetadata {
  return {
    project_id: source.projectId,
    project_name: source.projectName,
    requirement_id: source.requirementCode,
    requirement_name: source.requirementName,
    status: source.status,
    schedule_version: source.scheduleVersion ?? "",
    scheduled_gray_date: source.scheduledGrayDate ?? "",
    scheduled_full_date: source.scheduledFullDate ?? "",
    release_version: source.releaseVersion ?? "",
    release_date: source.releaseDate ?? "",
    content_type: contentType,
    source_updated_at: source.sourceUpdatedAt,
  };
}

function baseHeader(source: CurrentRequirementKnowledgeSource, contentType: KnowledgeContentType) {
  return [
    `项目：${source.projectName}（${source.projectId}）`,
    `需求：${source.requirementName}（${source.requirementCode}）`,
    `状态：${source.status === "online" ? "已上线" : source.status === "scheduled" ? "已排期" : "未上线"}`,
    `排期版本：${source.scheduleVersion ?? "未填写"}`,
    `预计灰度时间：${source.scheduledGrayDate ?? "未填写"}`,
    `预计全量时间：${source.scheduledFullDate ?? "未填写"}`,
    `上线版本：${source.releaseVersion ?? "未填写"}`,
    `上线时间：${source.releaseDate ?? "未填写"}`,
    `当前有效版本：V${source.versionNo}`,
    `内容类型：${contentType}`,
    `来源更新时间：${source.sourceUpdatedAt}`,
  ].join("\n");
}

function documentsFor(source: CurrentRequirementKnowledgeSource): SyncDocument[] {
  const prefix = `${source.projectId}:${source.requirementCode}`;
  const summary: SyncDocument = {
    key: `${prefix}:requirement_summary`,
    contentType: "requirement_summary",
    name: `${source.projectName}｜${source.requirementName}｜需求摘要`,
    text: `${baseHeader(source, "requirement_summary")}\n\n# 需求摘要\n${source.changeSummary || "暂无版本说明。"}`,
    metadata: metadata(source, "requirement_summary"),
  };
  const prd: SyncDocument = {
    key: `${prefix}:prd`,
    contentType: "prd",
    name: `${source.projectName}｜${source.requirementName}｜PRD`,
    text: `${baseHeader(source, "prd")}\n\n${source.prdDocuments.map((document) => `# 文件：${document.name}\n${document.content}`).join("\n\n")}`,
    metadata: metadata(source, "prd"),
  };
  const testCases = source.testCases.length ? [{
    key: `${prefix}:test_case`,
    contentType: "test_case" as const,
    name: `${source.projectName}｜${source.requirementName}｜测试用例`,
    text: `${baseHeader(source, "test_case")}\n\n# 测试用例\n${source.testCases.map((item) => [
      `## ${item.id} ${item.title}`,
      `模块：${item.module}；优先级：${item.priority}；状态：${item.status}`,
      `前置条件：${item.preconditions.join("；") || "无"}`,
      `步骤：${item.steps.map((step) => `${step.step}. ${step.action}`).join("；")}`,
      `预期：${item.expectedResults.join("；")}`,
    ].join("\n")).join("\n\n")}`,
    metadata: metadata(source, "test_case"),
  }] : [];
  return [summary, prd, ...testCases];
}

async function saveFailure(key: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 800) : "未知同步错误";
  await mutate((store) => {
    const item = store.entries.find((entry) => entry.key === key);
    if (item) Object.assign(item, { failedAt: now(), lastError: message });
  });
}

async function syncDocument(store: SyncStore, client: DifyKnowledgeClient, document: SyncDocument) {
  const bodyChecksum = checksum(`${document.name}\n${document.text}\n${JSON.stringify(document.metadata)}`);
  const current = store.entries.find((item) => item.key === document.key);
  try {
    if (current?.checksum === bodyChecksum && !current.lastError) return;
    if (current?.documentId) await client.updateDocument(current.documentId, document);
    const documentId = current?.documentId ?? await client.createDocument(document);
    await client.updateMetadata(documentId, document.metadata);
    const entry: KnowledgeSyncEntry = { key: document.key, projectId: document.metadata.project_id, requirementCode: document.metadata.requirement_id, contentType: document.contentType, documentId, checksum: bodyChecksum, updatedAt: now() };
    const index = store.entries.findIndex((item) => item.key === document.key);
    if (index >= 0) store.entries[index] = entry;
    else store.entries.push(entry);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 800) : "未知同步错误";
    if (current) Object.assign(current, { failedAt: now(), lastError: message });
    else store.entries.push({ key: document.key, projectId: document.metadata.project_id, requirementCode: document.metadata.requirement_id, contentType: document.contentType, checksum: "", updatedAt: now(), failedAt: now(), lastError: message });
    throw error;
  }
}

async function syncSourceInStore(store: SyncStore, source: CurrentRequirementKnowledgeSource) {
  const client = new DifyKnowledgeClient();
  const documents = documentsFor(source);
  const prefix = `${source.projectId}:${source.requirementCode}:`;
  const expected = new Set(documents.map((item) => item.key));
  for (const stale of store.entries.filter((item) => item.key.startsWith(prefix) && !expected.has(item.key))) {
    if (stale.documentId) {
      try { await client.deleteDocument(stale.documentId); } catch { /* a missing remote document is safe to forget */ }
    }
    store.entries.splice(store.entries.indexOf(stale), 1);
  }
  for (const document of documents) await syncDocument(store, client, document);
}

export async function syncRequirementKnowledge(requirementCode: string) {
  if (!isDifyKnowledgeConfigured()) return { skipped: true, reason: "not-configured" as const };
  const source = (await listCurrentRequirementKnowledgeSources()).find((item) => item.requirementCode === requirementCode);
  if (!source) return { skipped: true, reason: "not-found" as const };
  try {
    await mutate(async (store) => { await syncSourceInStore(store, source); });
    return { skipped: false, requirementCode };
  } catch (error) {
    await saveFailure(`${source.projectId}:${source.requirementCode}:prd`, error).catch(() => undefined);
    throw error;
  }
}

export async function syncExistingKnowledge() {
  if (!isDifyKnowledgeConfigured()) throw new DifyKnowledgeError("Dify 知识库尚未配置。请先设置 DIFY_API_BASE_URL、DIFY_API_KEY 和 DIFY_DATASET_ID。", 503);
  const sources = await listCurrentRequirementKnowledgeSources();
  const failed: Array<{ requirementCode: string; error: string }> = [];
  let synced = 0;
  for (const source of sources) {
    try {
      await mutate(async (store) => { await syncSourceInStore(store, source); });
      synced += 1;
    } catch (error) {
      failed.push({ requirementCode: source.requirementCode, error: error instanceof Error ? error.message : "未知同步错误" });
    }
  }
  return { total: sources.length, synced, failed };
}

/** Persisted mapping used to reject Dify hits outside the platform's allowed scope. */
export async function listKnowledgeSyncEntries() {
  return clone((await readStore()).entries);
}

/** Writes never wait for Dify. A later assistant request retries failed work in the background. */
export function scheduleRequirementKnowledgeSync(requirementCode: string) {
  if (!isDifyKnowledgeConfigured()) return;
  backgroundSync = backgroundSync.then(async () => { await syncRequirementKnowledge(requirementCode); }).catch(() => undefined);
}

export function schedulePendingKnowledgeRetry() {
  if (!isDifyKnowledgeConfigured()) return;
  backgroundSync = backgroundSync.then(async () => {
    const entries = await readStore();
    const pendingCodes = [...new Set(entries.entries.filter((entry) => entry.lastError).map((entry) => entry.requirementCode))];
    for (const requirementCode of pendingCodes) await syncRequirementKnowledge(requirementCode);
  }).catch(() => undefined);
}
