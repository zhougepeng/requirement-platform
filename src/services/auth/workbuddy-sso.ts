import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 60 * 1000;

type WorkbuddyIdentity = {
  openId: string;
  name: string;
};

export type WorkbuddyIntegrationIdentity = WorkbuddyIdentity;

function secret() {
  const value = process.env.WORKBUDDY_SSO_SECRET?.trim();
  if (!value || value.length < 32) {
    throw Object.assign(new Error("工作搭子免登录需要配置至少 32 位的 WORKBUDDY_SSO_SECRET。"), { statusCode: 503 });
  }
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createWorkbuddySsoToken(identity: WorkbuddyIdentity) {
  const payload = {
    aud: "product-workbench",
    jti: randomBytes(18).toString("base64url"),
    openId: identity.openId,
    name: identity.name,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${value}.${sign(value)}`;
}

/**
 * Verifies the short-lived credential sent by WorkBuddy for server-side API
 * calls. It is deliberately separate from the browser SSO token so a token
 * minted for opening the WorkBuddy UI cannot be reused as an API credential.
 */
export function verifyWorkbuddyIntegrationToken(value: string): WorkbuddyIntegrationIdentity | undefined {
  const supplied = String(value || "");
  if (!supplied.startsWith("wbi_")) return undefined;
  const [payload, signature, ...extra] = supplied.slice(4).split(".");
  if (!payload || !signature || extra.length) return undefined;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  try {
    const identity = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      aud?: unknown;
      source?: unknown;
      openId?: unknown;
      name?: unknown;
      expiresAt?: unknown;
    };
    if (
      identity.aud !== "requirement-platform-api" ||
      identity.source !== "product-workbench" ||
      typeof identity.openId !== "string" ||
      typeof identity.name !== "string" ||
      !identity.openId.trim() ||
      !identity.name.trim() ||
      typeof identity.expiresAt !== "number" ||
      identity.expiresAt <= Date.now()
    )
      return undefined;
    return { openId: identity.openId.trim(), name: identity.name.trim() };
  } catch {
    return undefined;
  }
}
