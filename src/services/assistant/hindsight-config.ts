import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(process.cwd(), "data", "requirement-platform");
const CONFIG_FILE = path.join(DATA_DIR, "hindsight-connection.local.json");

type StoredHindsightConfiguration = {
  schemaVersion: 1;
  baseUrl: string;
  bankId: string;
  encryptedToken: string;
  createdAt: string;
  updatedAt: string;
};

export type HindsightConfiguration = {
  baseUrl: string;
  bankId: string;
  token: string;
  source: "managed" | "environment";
};

export type HindsightSettings = Omit<HindsightConfiguration, "token"> & {
  hasToken: boolean;
  tokenHint?: string;
  canSave: boolean;
  encryptionMessage?: string;
};

export type SaveHindsightConfigurationInput = { baseUrl: string; bankId: string; token: string };

export class HindsightConfigurationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function encryptionSecret() {
  return process.env.HINDSIGHT_CONFIG_ENCRYPTION_KEY?.trim() || process.env.AUTH_SESSION_SECRET?.trim();
}

function key() {
  const secret = encryptionSecret();
  if (!secret) throw new HindsightConfigurationError("未配置 HINDSIGHT_CONFIG_ENCRYPTION_KEY，管理员无法通过页面保存记忆系统凭证。请先在服务器环境变量中设置该加密密钥。", 503);
  return createHash("sha256").update(secret).digest();
}

function normalizeBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new HindsightConfigurationError("Hindsight 服务地址格式不正确。"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HindsightConfigurationError("Hindsight 服务地址只支持 HTTP 或 HTTPS。");
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname) url.pathname = "/";
  return url.toString().replace(/\/$/, "");
}

function validate(input: SaveHindsightConfigurationInput) {
  const bankId = input.bankId.trim();
  const token = input.token.trim();
  if (!bankId || bankId.length > 240) throw new HindsightConfigurationError("Bank ID 不能为空且不能超过 240 个字符。");
  if (!token || token.length > 4000) throw new HindsightConfigurationError("Hindsight 凭证不能为空且不能超过 4000 个字符。");
  return { baseUrl: normalizeBaseUrl(input.baseUrl), bankId, token };
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
    const decipher = createDecipheriv("aes-256-gcm", key(), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof HindsightConfigurationError) throw error;
    throw new HindsightConfigurationError("无法解密已保存的 Hindsight 凭证。请确认 HINDSIGHT_CONFIG_ENCRYPTION_KEY 未被更换。", 500);
  }
}

function readStoredConfig() {
  try {
    const value = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<StoredHindsightConfiguration>;
    if (value.schemaVersion !== 1 || !value.baseUrl || !value.bankId || !value.encryptedToken) throw new HindsightConfigurationError("Hindsight 配置文件格式无效，请重新保存配置。", 500);
    return value as StoredHindsightConfiguration;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    if (error instanceof HindsightConfigurationError) throw error;
    throw new HindsightConfigurationError("无法读取 Hindsight 配置文件，请检查服务用户的数据目录权限。", 500);
  }
}

function tokenHint(token: string) { return token.length <= 6 ? "已保存" : `${token.slice(0, 3)}•••${token.slice(-3)}`; }
function timestamp() { return new Date().toISOString(); }

export function getHindsightConfiguration(): HindsightConfiguration | undefined {
  const stored = readStoredConfig();
  if (stored) return { baseUrl: stored.baseUrl, bankId: stored.bankId, token: decrypt(stored.encryptedToken), source: "managed" };
  const baseUrl = process.env.HINDSIGHT_API_BASE_URL?.trim();
  const bankId = process.env.HINDSIGHT_BANK_ID?.trim();
  const token = process.env.HINDSIGHT_TOKEN?.trim();
  if (!baseUrl || !bankId || !token) return undefined;
  return { baseUrl: normalizeBaseUrl(baseUrl), bankId, token, source: "environment" };
}

export function isHindsightConfigured() { return Boolean(getHindsightConfiguration()); }

export function getHindsightSettings(): HindsightSettings {
  const configured = getHindsightConfiguration();
  const canSave = Boolean(encryptionSecret());
  if (!configured) return { baseUrl: "", bankId: "", source: "environment", hasToken: false, canSave, encryptionMessage: canSave ? undefined : "服务器尚未配置 HINDSIGHT_CONFIG_ENCRYPTION_KEY，暂不能在页面保存凭证。" };
  return { baseUrl: configured.baseUrl, bankId: configured.bankId, source: configured.source, hasToken: true, tokenHint: tokenHint(configured.token), canSave, encryptionMessage: canSave ? undefined : "当前使用部署环境变量配置；设置 HINDSIGHT_CONFIG_ENCRYPTION_KEY 后可改为由管理员在页面维护。" };
}

export function saveHindsightConfiguration(input: SaveHindsightConfigurationInput) {
  const value = validate(input);
  const existing = readStoredConfig();
  const stored: StoredHindsightConfiguration = { schemaVersion: 1, baseUrl: value.baseUrl, bankId: value.bankId, encryptedToken: encrypt(value.token), createdAt: existing?.createdAt ?? timestamp(), updatedAt: timestamp() };
  try {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const temporary = `${CONFIG_FILE}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, CONFIG_FILE);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    throw new HindsightConfigurationError(`无法保存 Hindsight 配置，请检查服务用户对数据目录的写入权限（${reason}）。`, 500);
  }
  return getHindsightSettings();
}
