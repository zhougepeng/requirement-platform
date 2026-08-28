import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(process.cwd(), "data", "requirement-platform");
const MODEL_FILE = path.join(DATA_DIR, "models.local.json");

type StoredModel = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type ModelStore = { schemaVersion: 1; models: StoredModel[] };

class ModelStorageError extends Error {
  statusCode = 500;
}

class ModelConnectionError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type ModelSummary = Omit<StoredModel, "apiKey"> & { hasApiKey: boolean };
export type CreateModelInput = { name: string; baseUrl: string; model: string; apiKey: string; isDefault?: boolean };
export type UpdateModelInput = { id: string; name?: string; baseUrl?: string; model?: string; apiKey?: string; isDefault?: boolean };

let mutationQueue = Promise.resolve();

function now() {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
  }).format(new Date()).replaceAll("/", "-");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("模型服务地址只支持 HTTP 或 HTTPS。");
  return url.toString().replace(/\/$/, "");
}

function validate(input: CreateModelInput) {
  const name = input.name.trim();
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();
  if (!name || name.length > 80) throw new Error("模型名称不能为空且不能超过 80 个字符。");
  if (!model || model.length > 160) throw new Error("模型 ID 不能为空且不能超过 160 个字符。");
  if (!apiKey || apiKey.length > 2000) throw new Error("API Key 不能为空且不能超过 2000 个字符。");
  return { name, model, apiKey, baseUrl: normalizeBaseUrl(input.baseUrl) };
}

async function readStore(): Promise<ModelStore> {
  try {
    const parsed = JSON.parse(await readFile(MODEL_FILE, "utf8")) as Partial<ModelStore>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.models)) {
      throw new ModelStorageError(`模型配置文件格式无效：${MODEL_FILE}`);
    }
    return { schemaVersion: 1, models: parsed.models.filter((item): item is StoredModel => Boolean(item?.id && item.name && item.baseUrl && item.model && item.apiKey)) };
  } catch (error) {
    if (error instanceof ModelStorageError) throw error;
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { schemaVersion: 1, models: [] };
    const reason = error instanceof Error ? error.message : "未知错误";
    throw new ModelStorageError(`无法读取模型配置文件，请检查数据目录权限：${MODEL_FILE}（${reason}）`);
  }
}

async function writeStore(store: ModelStore) {
  try {
    await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    const temporary = `${MODEL_FILE}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, MODEL_FILE);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    throw new ModelStorageError(`无法保存模型配置，请检查服务用户对数据目录的写入权限：${DATA_DIR}（${reason}）`);
  }
}

async function mutate<T>(operation: (store: ModelStore) => T | Promise<T>): Promise<T> {
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

function summary(model: StoredModel): ModelSummary {
  return {
    id: model.id,
    name: model.name,
    baseUrl: model.baseUrl,
    model: model.model,
    isDefault: model.isDefault,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    hasApiKey: true,
  };
}

export async function listModels() {
  const store = await readStore();
  return clone(store.models.map(summary).toSorted((left, right) => Number(right.isDefault) - Number(left.isDefault) || right.updatedAt.localeCompare(left.updatedAt)));
}

export async function createModel(input: CreateModelInput) {
  const value = validate(input);
  return mutate((store) => {
    const timestamp = now();
    const isDefault = input.isDefault || !store.models.length;
    if (isDefault) store.models.forEach((item) => { item.isDefault = false; });
    const model: StoredModel = { id: `model_${randomUUID().replaceAll("-", "")}`, ...value, isDefault, createdAt: timestamp, updatedAt: timestamp };
    store.models.push(model);
    return clone(summary(model));
  });
}

export async function updateModel(input: UpdateModelInput) {
  return mutate((store) => {
    const target = store.models.find((item) => item.id === input.id);
    if (!target) throw new Error("模型配置不存在。");
    const candidate: CreateModelInput = {
      name: input.name ?? target.name,
      baseUrl: input.baseUrl ?? target.baseUrl,
      model: input.model ?? target.model,
      apiKey: input.apiKey?.trim() ? input.apiKey : target.apiKey,
    };
    const value = validate(candidate);
    Object.assign(target, value, { updatedAt: now() });
    if (input.isDefault) {
      store.models.forEach((item) => { item.isDefault = item.id === target.id; });
    }
    return clone(summary(target));
  });
}

export async function deleteModel(id: string) {
  return mutate((store) => {
    const index = store.models.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("模型配置不存在。");
    const [removed] = store.models.splice(index, 1);
    if (removed.isDefault && store.models[0]) store.models[0].isDefault = true;
  });
}

export async function resolveAssistantModel() {
  const store = await readStore();
  const configured = store.models.find((item) => item.isDefault) ?? store.models[0];
  if (configured) return { baseUrl: configured.baseUrl, apiKey: configured.apiKey, model: configured.model };
  const baseUrl = process.env.AI_API_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  if (!baseUrl || !apiKey || !model) throw new Error("AI 助手尚未配置。请从左侧栏底部的模型管理中新增并设为默认模型。");
  return { baseUrl, apiKey, model };
}

/** A short, read-only model probe used before expensive assistant/test-case requests. */
export async function testAssistantModelConnection() {
  const { baseUrl, apiKey, model } = await resolveAssistantModel();
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: "仅回复 OK" }] }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new ModelConnectionError("模型连接检测超过 10 秒未返回。", 504);
    const reason = error instanceof Error ? error.message : "网络连接失败";
    throw new ModelConnectionError(`无法连接模型服务：${reason.slice(0, 180)}`, 502);
  }
  if (!response.ok) throw new ModelConnectionError(`模型连接检测失败（HTTP ${response.status}）。`, 502);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  if (!payload.choices?.[0]?.message?.content?.trim()) throw new ModelConnectionError("模型服务已响应，但未返回可用内容。", 502);
  return { model, host: new URL(baseUrl).host, elapsedMs: Date.now() - startedAt };
}
