import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DifyKnowledgeClient, isDifyKnowledgeConfigured, type DifyKnowledgeMetadata } from "@/services/assistant/dify-knowledge-client";
import { getMaterial, listAllMaterials, type Material } from "@/services/materials/material-service";

export type MaterialKnowledgeSyncEntry = { materialId: string; documentId?: string; checksum: string; updatedAt: string; lastError?: string };
type SyncStore = { schemaVersion: 1; entries: MaterialKnowledgeSyncEntry[] };
const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR) : path.join(process.cwd(), "data", "requirement-platform");
const STORE_FILE = path.join(DATA_DIR, "material-knowledge-sync.local.json");
let mutationQueue = Promise.resolve();
let backgroundSync = Promise.resolve();

function now() { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date()).replaceAll("/", "-"); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function readStore(): Promise<SyncStore> {
  try {
    const parsed = JSON.parse(await readFile(STORE_FILE, "utf8")) as Partial<SyncStore>;
    return { schemaVersion: 1, entries: Array.isArray(parsed.entries) ? parsed.entries.filter((item): item is MaterialKnowledgeSyncEntry => Boolean(item?.materialId)) : [] };
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

async function mutate<T>(operation: (store: SyncStore) => T | Promise<T>) {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { const store = await readStore(); const result = await operation(store); await writeStore(store); return result; } finally { release(); }
}

function metadata(material: Material): DifyKnowledgeMetadata {
  return {
    scope: material.scope,
    project_id: material.projectId ?? "",
    project_name: "",
    directory_id: material.directoryId ?? "",
    source_id: material.id,
    origin: material.origin,
    file_name: material.fileName ?? material.title,
    content_type: "material",
    source_updated_at: material.updatedAt,
  };
}

function documentText(material: Material) {
  return [
    `资料名称：${material.title}`,
    `资料范围：${material.scope === "project" ? "项目资料" : "公共资料"}`,
    material.projectId ? `项目 ID：${material.projectId}` : "",
    `来源：${material.origin === "system_generated" ? "系统根据已上线需求自动整理" : "人工维护"}`,
    material.sourceRequirementCodes.length ? `来源需求：${material.sourceRequirementCodes.join("、")}` : "",
    `更新时间：${material.updatedAt}`,
    "",
    material.content,
  ].filter(Boolean).join("\n");
}

export async function listMaterialKnowledgeSyncEntries() { return structuredClone((await readStore()).entries); }

export async function syncMaterialKnowledge(materialId: string) {
  if (!isDifyKnowledgeConfigured()) return { skipped: true as const, reason: "not-configured" as const };
  const material = await getMaterial(materialId);
  return mutate(async (store) => {
    const client = new DifyKnowledgeClient();
    const text = documentText(material);
    const checksum = hash(`${material.title}\n${text}\n${JSON.stringify(metadata(material))}`);
    const current = store.entries.find((item) => item.materialId === material.id);
    if (current?.checksum === checksum && !current.lastError) return { skipped: true as const, reason: "unchanged" as const };
    try {
      if (current?.documentId) await client.updateDocument(current.documentId, { name: `资料库｜${material.title}`, text });
      const documentId = current?.documentId ?? await client.createDocument({ name: `资料库｜${material.title}`, text });
      await client.updateMetadata(documentId, metadata(material));
      const entry = { materialId: material.id, documentId, checksum, updatedAt: now() } satisfies MaterialKnowledgeSyncEntry;
      if (current) Object.assign(current, entry);
      else store.entries.push(entry);
      return { skipped: false as const, documentId };
    } catch (error) {
      const entry = current ?? { materialId: material.id, checksum: "", updatedAt: now() };
      Object.assign(entry, { lastError: error instanceof Error ? error.message.slice(0, 800) : "资料同步失败", updatedAt: now() });
      if (!current) store.entries.push(entry);
      throw error;
    }
  });
}

export async function syncAllMaterialKnowledge() {
  const materials = await listAllMaterials();
  const failures: Array<{ materialId: string; error: string }> = [];
  let synced = 0;
  for (const material of materials) {
    try { await syncMaterialKnowledge(material.id); synced += 1; } catch (error) { failures.push({ materialId: material.id, error: error instanceof Error ? error.message : "资料同步失败" }); }
  }
  return { total: materials.length, synced, failures };
}

export async function deleteMaterialKnowledge(materialId: string) {
  if (!isDifyKnowledgeConfigured()) return { skipped: true as const, reason: "not-configured" as const };
  return mutate(async (store) => {
    const index = store.entries.findIndex((item) => item.materialId === materialId);
    if (index < 0) return { skipped: true as const, reason: "not-synced" as const };
    const entry = store.entries[index];
    if (entry.documentId) await new DifyKnowledgeClient().deleteDocument(entry.documentId);
    store.entries.splice(index, 1);
    return { skipped: false as const };
  });
}

export function scheduleMaterialKnowledgeSync(materialId: string) {
  if (!isDifyKnowledgeConfigured()) return;
  backgroundSync = backgroundSync.then(async () => { await syncMaterialKnowledge(materialId); }).catch(() => undefined);
}

export function scheduleMaterialKnowledgeDelete(materialId: string) {
  if (!isDifyKnowledgeConfigured()) return;
  backgroundSync = backgroundSync.then(async () => { await deleteMaterialKnowledge(materialId); }).catch(() => undefined);
}

export function schedulePendingMaterialKnowledgeRetry() {
  if (!isDifyKnowledgeConfigured()) return;
  backgroundSync = backgroundSync.then(async () => {
    for (const entry of (await readStore()).entries.filter((item) => item.lastError)) await syncMaterialKnowledge(entry.materialId);
  }).catch(() => undefined);
}
