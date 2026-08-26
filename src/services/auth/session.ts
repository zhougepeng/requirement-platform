import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "requirement_platform_session";
export const OAUTH_STATE_COOKIE = "requirement_platform_oauth_state";

export type UserSession = { openId: string; name: string; avatarUrl?: string; tenantKey?: string; expiresAt: number };
export type OAuthLoginState = { state: string; returnTo: string; expiresAt: number };

function secret() {
  const value = process.env.AUTH_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("飞书登录需要至少 32 位的 AUTH_SESSION_SECRET。");
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createState() {
  return randomBytes(32).toString("base64url");
}

export function safeReturnTo(value?: string | null) {
  const candidate = String(value || "").trim();
  return candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\") && !/[\u0000-\u001f]/.test(candidate) ? candidate : "/";
}

export function createOAuthLoginState(returnTo?: string | null) {
  const payload: OAuthLoginState = {
    state: createState(),
    returnTo: safeReturnTo(returnTo),
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: payload.state, cookieValue: `${value}.${sign(value)}` };
}

export function decodeOAuthLoginState(value?: string): OAuthLoginState | undefined {
  if (!value) return undefined;
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length) return undefined;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthLoginState;
    if (!state.state || state.expiresAt <= Date.now()) return undefined;
    return { ...state, returnTo: safeReturnTo(state.returnTo) };
  } catch {
    return undefined;
  }
}

export function encodeSession(input: Omit<UserSession, "expiresAt">) {
  const payload: UserSession = { ...input, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${value}.${sign(value)}`;
}

export function decodeSession(value?: string): UserSession | undefined {
  if (!value) return undefined;
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length) return undefined;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UserSession;
    return session.openId && session.name && session.expiresAt > Date.now() ? session : undefined;
  } catch {
    return undefined;
  }
}
