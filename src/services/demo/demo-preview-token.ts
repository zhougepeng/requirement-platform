import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const safeSegment = /^[A-Za-z0-9._-]+$/;

export type DemoPreviewTokenClaims = { path: string[]; expiresAt: number };

function signingSecret() {
  const configured = process.env.DEMO_PREVIEW_TOKEN_SECRET || process.env.AUTH_SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== "production") return "requirement-platform-local-demo-preview-token-secret";
  throw new Error("生产环境需要配置至少 32 位的 DEMO_PREVIEW_TOKEN_SECRET 或 AUTH_SESSION_SECRET。");
}

function sign(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function isSafeDemoPath(segments: string[]) {
  return segments.length >= 5 && segments.every((segment) => safeSegment.test(segment));
}

function isSafeDemoPrefix(segments: string[]) {
  return segments.length === 4 && segments.every((segment) => safeSegment.test(segment)) && segments[3]?.toLowerCase() === "demo";
}

export function createDemoPreviewToken(path: string[]) {
  if (!isSafeDemoPrefix(path)) throw new Error("Demo 预览路径无效。");
  const payload = Buffer.from(JSON.stringify({ path, expiresAt: Date.now() + PREVIEW_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyDemoPreviewToken(value?: string): DemoPreviewTokenClaims | undefined {
  if (!value) return undefined;
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length) return undefined;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DemoPreviewTokenClaims;
    return Array.isArray(parsed.path) && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now() && isSafeDemoPrefix(parsed.path)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}
