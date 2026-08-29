import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(process.cwd(), "data", "requirement-platform");
const CONFIG_FILE = path.join(DATA_DIR, "dify-connection.local.json");

type StoredDifyConfiguration = {
  schemaVersion: 1;
  baseUrl: string;
  datasetId: string;
  encryptedApiKey: string;
  createdAt: string;
  updatedAt: string;
};

export type DifyKnowledgeConfiguration = {
  baseUrl: string;
  datasetId: string;
  apiKey: string;
  source: "managed" | "environment";
};

export type DifyKnowledgeSettings = Omit<DifyKnowledgeConfiguration, "apiKey"> & {
  hasApiKey: boolean;
  apiKeyHint?: string;
  canSave: boolean;
  encryptionMessage?: string;
};

export type SaveDifyKnowledgeConfigurationInput = {
  baseUrl: string;
  datasetId: string;
  apiKey: string;
};

class DifyConfigurationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function timestamp() {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
  }).format(new Date()).replaceAll("/", "-");
}

function encryptionSecret() {
  return process.env.DIFY_CONFIG_ENCRYPTION_KEY?.trim() || process.env.AUTH_SESSION_SECRET?.trim();
}

function key() {
  const secret = encryptionSecret();
  if (!secret) throw new DifyConfigurationError("未配置 DIFY_CONFIG_ENCRYPTION_KEY，管理员无法通过页面保存 Dify 密钥。请先在服务器环境变量中设置该加密密钥。", 503);
  return createHash("sha256").update(secret).digest();
}

function normalizeBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new DifyConfigurationError("Dify 服务地址格式不正确。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new DifyConfigurationError("Dify 服务地址只支持 HTTP 或 HTTPS。");
  url.pathname = url.pathname.replace(/\/$/, "");
  if (!url.pathname.endsWith("/v1")) url.pathname = `${url.pathname}/v1`.replace(/\/\/+/, "/");
  return url.toString().replace(/\/$/, "");
}

function validate(input: SaveDifyKnowledgeConfigurationInput) {
  const datasetId = input.datasetId.trim();
  const apiKey = input.apiKey.trim();
  if (!datasetId || datasetId.length > 240) throw new DifyConfigurationError("知识库 ID 不能为空且不能超过 240 个字符。");
  if (!apiKey || apiKey.length > 4000) throw new DifyConfigurationError("Dify API Key 不能为空且不能超过 4000 个字符。");
  return { baseUrl: normalizeBaseUrl(input.baseUrl), datasetId, apiKey };
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function decrypt(value: string) {
  try {
    const payload = Buffer.from(value, "base64");
    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof DifyConfigurationError) throw error;
    throw new DifyConfigurationError("无法解密已保存的 Dify 密钥。请确认 DIFY_CONFIG_ENCRYPTION_KEY 未被更换。", 500);
  }
}

function readStoredConfig() {
  try {
    const value = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<StoredDifyConfiguration>;
    if (value.schemaVersion !== 1 || !value.baseUrl || !value.datasetId || !value.encryptedApiKey) throw new DifyConfigurationError("Dify 配置文件格式无效，请重新保存配置。", 500);
    return value as StoredDifyConfiguration;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    if (error instanceof DifyConfigurationError) throw error;
    throw new DifyConfigurationError("无法读取 Dify 配置文件，请检查服务用户的数据目录权限。", 500);
  }
}

function apiKeyHint(apiKey: string) {
  return apiKey.length <= 6 ? "已保存" : `${apiKey.slice(0, 3)}•••${apiKey.slice(-3)}`;
}

export function getDifyKnowledgeConfiguration(): DifyKnowledgeConfiguration | undefined {
  const stored = readStoredConfig();
  if (stored) {
    return { baseUrl: stored.baseUrl, datasetId: stored.datasetId, apiKey: decrypt(stored.encryptedApiKey), source: "managed" };
  }
  const baseUrl = process.env.DIFY_API_BASE_URL?.trim();
  const datasetId = process.env.DIFY_DATASET_ID?.trim();
  const apiKey = process.env.DIFY_API_KEY?.trim();
  if (!baseUrl || !datasetId || !apiKey) return undefined;
  return { baseUrl: normalizeBaseUrl(baseUrl), datasetId, apiKey, source: "environment" };
}

export function getDifyKnowledgeSettings(): DifyKnowledgeSettings {
  const configured = getDifyKnowledgeConfiguration();
  const canSave = Boolean(encryptionSecret());
  if (!configured) return {
    baseUrl: "", datasetId: "", source: "environment", hasApiKey: false, canSave,
    encryptionMessage: canSave ? undefined : "服务器尚未配置 DIFY_CONFIG_ENCRYPTION_KEY，暂不能在页面保存密钥。",
  };
  return {
    baseUrl: configured.baseUrl,
    datasetId: configured.datasetId,
    source: configured.source,
    hasApiKey: true,
    apiKeyHint: apiKeyHint(configured.apiKey),
    canSave,
    encryptionMessage: canSave ? undefined : "当前使用部署环境变量配置；设置 DIFY_CONFIG_ENCRYPTION_KEY 后可改为由管理员在页面维护。",
  };
}

export function saveDifyKnowledgeConfiguration(input: SaveDifyKnowledgeConfigurationInput) {
  const value = validate(input);
  const existing = readStoredConfig();
  const now = timestamp();
  const stored: StoredDifyConfiguration = {
    schemaVersion: 1,
    baseUrl: value.baseUrl,
    datasetId: value.datasetId,
    encryptedApiKey: encrypt(value.apiKey),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  try {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const temporary = `${CONFIG_FILE}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, CONFIG_FILE);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    throw new DifyConfigurationError(`无法保存 Dify 配置，请检查服务用户对数据目录的写入权限（${reason}）。`, 500);
  }
  return getDifyKnowledgeSettings();
}
