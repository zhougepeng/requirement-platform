import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DemandPoolDraft, DemandPoolSource, DemandPoolSourceTable, DemandPoolSyncSummary, Project } from "@/lib/types";
import { getTenantAccessToken } from "@/services/auth/feishu-auth";
import { listProjects } from "@/services/requirement/repository";
import {
  hashDemandPoolSourceContent,
  recognizeDemandPool,
  upsertDemandPoolItemFromSource,
  hasUnchangedDemandPoolSourceRecord,
} from "@/services/demand-pool/demand-pool-service";

const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(process.cwd(), "data", "requirement-platform");
const STORE_FILE = path.join(DATA_DIR, "demand-pool-sources.local.json");
const FEISHU_API = "https://open.feishu.cn/open-apis";
type SourceStore = { schemaVersion: 1; sources: DemandPoolSource[] };
type FeishuEnvelope<T> = { code?: number; msg?: string; data?: T };
type FeishuTable = { table_id?: string; name?: string };
type FeishuRecord = { record_id?: string; fields?: Record<string, unknown>; last_modified_time?: string | number };
type FeishuPage<T> = { items?: T[]; has_more?: boolean; page_token?: string };

let mutationQueue = Promise.resolve();
function clone<T>(value: T): T { return structuredClone(value); }

async function readStore(): Promise<SourceStore> {
  try {
    const parsed = JSON.parse(await readFile(STORE_FILE, "utf8")) as Partial<SourceStore>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sources)) throw new Error("飞书来源数据文件格式无效。");
    return { schemaVersion: 1, sources: parsed.sources.filter((source): source is DemandPoolSource => Boolean(source?.id && source.baseId && source.tableId)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { schemaVersion: 1, sources: [] };
    throw error;
  }
}

async function writeStore(store: SourceStore) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporary = STORE_FILE + "." + randomUUID().replaceAll("-", "") + ".tmp";
  await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, STORE_FILE);
}

async function mutate<T>(operation: (store: SourceStore) => T | Promise<T>): Promise<T> {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const store = await readStore();
    const result = await operation(store);
    await writeStore(store);
    return result;
  } finally { release(); }
}

function text(value: unknown, label: string, max: number, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(label + "不能为空。");
  if (result.length > max) throw new Error(label + "不能超过 " + max + " 字。");
  return result;
}

function parseBaseUrl(value: unknown) {
  const raw = text(value, "飞书 Base 链接", 2_000, true);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("飞书 Base 链接格式不正确。"); }
  if (url.protocol !== "https:" || !/(^|\.)feishu\.cn$|(^|\.)larksuite\.com$/i.test(url.hostname)) throw new Error("只支持 feishu.cn 或 larksuite.com 的安全链接。");
  const match = url.pathname.match(/\/base\/([A-Za-z0-9_-]+)/i);
  if (!match) throw new Error("链接中没有找到飞书多维表格 Base ID。");
  return { url: url.toString(), baseId: match[1] };
}

async function feishuRequest<T>(label: string, pathname: string) {
  let token: string;
  try { token = await getTenantAccessToken(); } catch { throw new Error("飞书服务未配置或租户 Token 获取失败，请检查应用权限和环境变量。"); }
  let response: Response;
  try {
    response = await fetch(FEISHU_API + pathname, { headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch { throw new Error("读取飞书" + label + "失败，请检查服务网络连接。"); }
  const payload = await response.json().catch(() => ({})) as FeishuEnvelope<T>;
  if (!response.ok || payload.code !== 0) throw new Error("读取飞书" + label + "失败" + (payload.msg ? "：" + payload.msg : "") + "。请确认应用已获得多维表格读取权限。");
  return payload.data as T;
}

export async function listFeishuBaseTables(input: { url: string }): Promise<{ baseId: string; tables: DemandPoolSourceTable[] }> {
  const { baseId } = parseBaseUrl(input.url);
  const data = await feishuRequest<{ items?: FeishuTable[] }>("数据表", "/bitable/v1/apps/" + encodeURIComponent(baseId) + "/tables?page_size=100");
  return { baseId, tables: (data?.items ?? []).filter((table) => typeof table.table_id === "string" && typeof table.name === "string").map((table) => ({ tableId: table.table_id!, name: table.name! })) };
}

export async function listDemandPoolSources() {
  const store = await readStore();
  return clone(store.sources.filter((source) => !source.deletedAt).toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
}

function sourceIdentity(baseId: string, tableId: string) {
  return "feishu_base:" + baseId + ":" + tableId;
}

export async function createDemandPoolSource(input: { name?: string; url: string; tableId: string }) {
  const parsed = parseBaseUrl(input.url);
  const tables = await listFeishuBaseTables({ url: parsed.url });
  const table = tables.tables.find((candidate) => candidate.tableId === input.tableId);
  if (!table) throw new Error("选择的数据表不存在，或当前应用无法访问该数据表。");
  const currentTime = new Date().toISOString();
  const source: DemandPoolSource = { id: sourceIdentity(parsed.baseId, table.tableId), name: text(input.name, "来源名称", 120) || table.name, url: parsed.url, baseId: parsed.baseId, tableId: table.tableId, tableName: table.name, enabled: true, createdAt: currentTime, updatedAt: currentTime };
  return mutate((store) => {
    const duplicate = store.sources.find((candidate) => candidate.baseId === source.baseId && candidate.tableId === source.tableId);
    if (duplicate && !duplicate.deletedAt) throw new Error("这个飞书数据表已经关联，不需要重复添加。");
    if (duplicate) {
      duplicate.name = source.name;
      duplicate.url = source.url;
      duplicate.tableName = source.tableName;
      duplicate.enabled = true;
      duplicate.updatedAt = currentTime;
      delete duplicate.deletedAt;
      return clone(duplicate);
    }
    store.sources.push(source);
    return clone(source);
  });
}

export async function deleteDemandPoolSource(id: string) {
  return mutate((store) => {
    const source = store.sources.find((candidate) => candidate.id === id && !candidate.deletedAt);
    if (!source) throw new Error("飞书来源不存在。");
    source.enabled = false;
    source.deletedAt = new Date().toISOString();
    source.updatedAt = source.deletedAt;
  });
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join("、");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.name === "string") return record.name;
    if (typeof record.value === "string") return record.value;
    return JSON.stringify(value);
  }
  return "";
}

function recordContent(fields: Record<string, unknown>) {
  return Object.entries(fields).map(([key, value]) => [key, valueToText(value).trim()] as const).filter(([, value]) => value).map(([key, value]) => key + ": " + value).join("\n").slice(0, 100_000);
}

function fieldValue(fields: Record<string, unknown>, names: string[]) {
  const entry = Object.entries(fields).find(([key, value]) => names.some((name) => key.trim().toLowerCase() === name.toLowerCase()) && valueToText(value).trim());
  return entry ? valueToText(entry[1]).trim() : "";
}

function fallbackDraft(fields: Record<string, unknown>, content: string, projects: Project[], recordId: string): DemandPoolDraft {
  const title = fieldValue(fields, ["需求标题", "需求", "标题", "名称", "title", "name"]) || recordId;
  const detail = fieldValue(fields, ["需求详情", "详情", "描述", "需求描述", "内容", "description"]) || content;
  const categoryValue = fieldValue(fields, ["分类", "需求类型", "类型", "category"]);
  const categories = ["新功能", "功能优化", "问题反馈", "客户诉求", "竞品信息", "其他"] as const;
  const category = categories.find((candidate) => categoryValue.includes(candidate)) ?? "其他";
  const valueValue = fieldValue(fields, ["价值", "优先级", "重要性", "value"]).toLowerCase();
  const value = valueValue.includes("高") || valueValue.includes("high") ? "high" : valueValue.includes("低") || valueValue.includes("low") ? "low" : valueValue.includes("中") || valueValue.includes("medium") ? "medium" : "pending";
  const projectReference = fieldValue(fields, ["所属项目", "项目", "project"]);
  const project = projects.find((candidate) => candidate.id.toLowerCase() === projectReference.toLowerCase() || candidate.name.trim().toLowerCase() === projectReference.toLowerCase());
  return { title: title.slice(0, 160), detail: detail.slice(0, 20_000), category, value, projectId: project?.id, proposer: fieldValue(fields, ["提出人", "需求提出人", "申请人", "创建人", "proposer"]).slice(0, 80) || undefined };
}

async function listRecords(source: DemandPoolSource) {
  const records: FeishuRecord[] = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "500" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await feishuRequest<FeishuPage<FeishuRecord>>("数据记录", "/bitable/v1/apps/" + encodeURIComponent(source.baseId) + "/tables/" + encodeURIComponent(source.tableId) + "/records?" + query.toString());
    records.push(...(data?.items ?? []));
    pageToken = data?.has_more && data.page_token ? data.page_token : "";
  } while (pageToken);
  return records.filter((record) => record.record_id && record.fields);
}

export async function syncDemandPoolSource(id: string): Promise<{ source: DemandPoolSource; summary: DemandPoolSyncSummary }> {
  const source = (await readStore()).sources.find((candidate) => candidate.id === id && !candidate.deletedAt);
  if (!source) throw new Error("飞书来源不存在。");
  if (!source.enabled) throw new Error("这个飞书来源已停用，请先启用后再同步。");
  const records = await listRecords(source);
  const projects = await listProjects();
  const summary: DemandPoolSyncSummary = { created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };
  for (const record of records) {
    const recordId = record.record_id!;
    try {
      const fields = record.fields!;
      const content = recordContent(fields);
      if (!content) { summary.failed += 1; summary.errors!.push(recordId + "：记录没有可读取的字段内容"); continue; }
      const sourceHash = hashDemandPoolSourceContent(content);
      if (await hasUnchangedDemandPoolSourceRecord(source.id, recordId, sourceHash)) { summary.unchanged += 1; continue; }
      let draft: DemandPoolDraft;
      try { draft = await recognizeDemandPool(content); } catch { draft = fallbackDraft(fields, content, projects, recordId); }
      const result = await upsertDemandPoolItemFromSource({ ...draft, rawContent: content, sourceId: source.id, sourceRecordId: recordId, sourceUpdatedAt: record.last_modified_time ? String(record.last_modified_time) : fieldValue(fields, ["更新时间", "修改时间", "updated_at"]), sourceHash });
      summary[result.action] += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors!.push(recordId + "：" + (error instanceof Error ? error.message : "处理失败"));
    }
  }
  summary.errors = summary.errors?.slice(0, 20);
  const status = summary.failed === 0 ? "success" : summary.created + summary.updated + summary.unchanged > 0 ? "partial" : "error";
  const syncedAt = new Date().toISOString();
  const updatedSource = await mutate((store) => {
    const current = store.sources.find((candidate) => candidate.id === id);
    if (!current) throw new Error("飞书来源不存在。");
    current.lastSyncedAt = syncedAt;
    current.lastSyncStatus = status;
    current.lastSyncSummary = summary;
    current.lastSyncError = summary.errors?.[0];
    current.updatedAt = syncedAt;
    return clone(current);
  });
  return { source: updatedSource, summary };
}
