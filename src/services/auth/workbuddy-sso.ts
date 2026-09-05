import "server-only";

import { createHmac, randomBytes } from "node:crypto";

const TOKEN_TTL_MS = 60 * 1000;

type WorkbuddyIdentity = {
  openId: string;
  name: string;
};

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
