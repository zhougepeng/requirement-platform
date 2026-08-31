import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(process.cwd(), "data", "requirement-platform");
const TOKEN_FILE = path.join(DATA_DIR, "personal-access-tokens.local.json");
const TOKEN_PREFIX = "rpt_";

type StoredPersonalAccessToken = {
  id: string;
  openId: string;
  label: string;
  tokenHash: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

type TokenStore = { schemaVersion: 1; tokens: StoredPersonalAccessToken[] };

export type PersonalAccessTokenSummary = Omit<StoredPersonalAccessToken, "tokenHash" | "openId">;

let mutationQueue = Promise.resolve();

function now() {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
  }).format(new Date()).replaceAll("/", "-");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function summary(token: StoredPersonalAccessToken): PersonalAccessTokenSummary {
  return {
    id: token.id,
    label: token.label,
    tokenPrefix: token.tokenPrefix,
    createdAt: token.createdAt,
    ...(token.lastUsedAt ? { lastUsedAt: token.lastUsedAt } : {}),
    ...(token.revokedAt ? { revokedAt: token.revokedAt } : {}),
  };
}

async function readStore(): Promise<TokenStore> {
  try {
    const parsed = JSON.parse(await readFile(TOKEN_FILE, "utf8")) as Partial<TokenStore>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tokens)) throw new Error("invalid");
    return {
      schemaVersion: 1,
      tokens: parsed.tokens.filter((item): item is StoredPersonalAccessToken => Boolean(
        item?.id && item.openId && item.label && item.tokenHash && item.tokenPrefix && item.createdAt,
      )),
    };
  } catch {
    return { schemaVersion: 1, tokens: [] };
  }
}

async function writeStore(store: TokenStore) {
  await mkdir(DATA_DIR, { recursive: true });
  const temporary = `${TOKEN_FILE}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await rename(temporary, TOKEN_FILE);
}

async function mutate<T>(operation: (store: TokenStore) => T | Promise<T>) {
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

/**
 * P0 保持每位员工仅有一个有效令牌。重新生成会立即撤销旧令牌，避免旧电脑继续代表该员工写入数据。
 */
export async function createPersonalAccessToken(openId: string, label = "个人访问令牌") {
  const secret = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const timestamp = now();
  return mutate((store) => {
    for (const token of store.tokens) {
      if (token.openId === openId && !token.revokedAt) token.revokedAt = timestamp;
    }
    const token: StoredPersonalAccessToken = {
      id: `pat_${randomUUID().replaceAll("-", "")}`,
      openId,
      label: label.trim().slice(0, 80) || "个人访问令牌",
      tokenHash: hashToken(secret),
      tokenPrefix: secret.slice(0, 12),
      createdAt: timestamp,
    };
    store.tokens.push(token);
    return { token: secret, accessToken: summary(token) };
  });
}

export async function listPersonalAccessTokens(openId: string) {
  const store = await readStore();
  return store.tokens
    .filter((token) => token.openId === openId)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(summary);
}

export async function revokePersonalAccessTokens(openId: string) {
  return mutate((store) => {
    const timestamp = now();
    let revoked = 0;
    for (const token of store.tokens) {
      if (token.openId === openId && !token.revokedAt) {
        token.revokedAt = timestamp;
        revoked += 1;
      }
    }
    return { revoked };
  });
}

export async function resolvePersonalAccessToken(token: string) {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 500) return undefined;
  const suppliedHash = Buffer.from(hashToken(token));
  return mutate((store) => {
    const matched = store.tokens.find((candidate) => {
      if (candidate.revokedAt) return false;
      const expectedHash = Buffer.from(candidate.tokenHash);
      return expectedHash.length === suppliedHash.length && timingSafeEqual(expectedHash, suppliedHash);
    });
    if (!matched) return undefined;
    matched.lastUsedAt = now();
    return { openId: matched.openId, tokenId: matched.id };
  });
}
