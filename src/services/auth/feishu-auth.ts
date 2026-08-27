import "server-only";

type FeishuEnvelope<T> = { code?: number; msg?: string; data?: T } & T;
type FeishuToken = { app_access_token?: string; expire?: number };
type TenantToken = { tenant_access_token?: string };
type LoginToken = { access_token?: string };
type FeishuUser = { open_id?: string; union_id?: string; user_id?: string; name?: string; avatar_url?: string; tenant_key?: string };

const API = "https://open.feishu.cn/open-apis";
const QR_AUTHORIZE = "https://passport.feishu.cn/suite/passport/oauth/authorize";
const APP_TOKEN_REFRESH_MARGIN_MS = 60_000;

let appAccessTokenCache: { token: string; expiresAt: number } | undefined;

export class FeishuLoginError extends Error {
  constructor(public readonly kind: "configuration" | "unauthorized_tenant" | "remote") {
    super(kind);
  }
}

function configuration(options: { requireTenantKey?: boolean } = {}) {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  const configuredRedirect = process.env.FEISHU_REDIRECT_URI?.trim();
  const baseUrl = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  const redirectUri = configuredRedirect || (baseUrl ? `${baseUrl}/auth/callback` : "");
  const allowedTenantKey = process.env.FEISHU_ALLOWED_TENANT_KEY?.trim()
    || (process.env.FEISHU_ALLOWED_TENANT_KEYS ?? "").split(",").map((item) => item.trim()).filter(Boolean)[0];
  if (!appId || !appSecret || !redirectUri || (options.requireTenantKey !== false && !allowedTenantKey))
    throw new FeishuLoginError("configuration");
  try {
    const parsed = new URL(redirectUri);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("protocol");
  } catch {
    throw new FeishuLoginError("configuration");
  }
  return { appId, appSecret, redirectUri, allowedTenantKey };
}

export function isFeishuLoginConfigured() {
  try {
    configuration();
    return true;
  } catch {
    return false;
  }
}

/** 仅用于首次读取企业标识；该模式绝不创建平台登录 Session。 */
export function isFeishuTenantDiscoveryEnabled() {
  return process.env.FEISHU_TENANT_DISCOVERY?.trim().toLowerCase() === "true";
}

async function fetchEnvelope<T>(label: string, url: string, init: RequestInit) {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    console.warn(`[feishu-auth] ${label} request failed after ${Date.now() - startedAt}ms`);
    throw new FeishuLoginError("remote");
  }
  const payload = await response.json().catch(() => ({})) as FeishuEnvelope<T>;
  if (!response.ok || payload.code !== 0) {
    console.warn(`[feishu-auth] ${label} rejected after ${Date.now() - startedAt}ms (HTTP ${response.status}, code ${payload.code ?? "unknown"})`);
    throw new FeishuLoginError("remote");
  }
  console.info(`[feishu-auth] ${label} completed in ${Date.now() - startedAt}ms`);
  return payload;
}

async function getAppAccessToken(appId: string, appSecret: string) {
  const now = Date.now();
  if (appAccessTokenCache && appAccessTokenCache.expiresAt - APP_TOKEN_REFRESH_MARGIN_MS > now) {
    console.info("[feishu-auth] app access token cache hit");
    return appAccessTokenCache.token;
  }
  const appToken = await fetchEnvelope<FeishuToken>("app access token", `${API}/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!appToken.app_access_token) throw new FeishuLoginError("remote");
  const expiresInMs = Math.max(60, appToken.expire ?? 7_200) * 1000;
  appAccessTokenCache = { token: appToken.app_access_token, expiresAt: now + expiresInMs };
  return appAccessTokenCache.token;
}

/**
 * 飞书二维码 SDK 当前仍要求使用旧版授权页；二维码 SDK 的 goto 必须使用该地址。
 * 该地址只包含公开的 App ID、回调地址和一次性 state，不包含 App Secret 或用户 Token。
 */
export function getFeishuQrGotoUrl(state: string) {
  const { appId, redirectUri } = configuration({ requireTenantKey: false });
  const url = new URL(QR_AUTHORIZE);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export function getFeishuLoginUrl(state: string) {
  const { appId, redirectUri } = configuration({ requireTenantKey: false });
  const url = new URL(`${API}/authen/v1/index`);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function getFeishuUserIdentity(code: string) {
  const startedAt = Date.now();
  const { appId, appSecret } = configuration({ requireTenantKey: false });
  const appAccessToken = await getAppAccessToken(appId, appSecret);
  const loginToken = await fetchEnvelope<LoginToken>("login access token", `${API}/authen/v1/access_token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${appAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  if (!loginToken.data?.access_token) throw new FeishuLoginError("remote");
  const user = await fetchEnvelope<FeishuUser>("user info", `${API}/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${loginToken.data.access_token}` },
  });
  if (!user.data?.open_id || !user.data.name || !user.data.tenant_key) throw new FeishuLoginError("remote");
  console.info(`[feishu-auth] user identity completed in ${Date.now() - startedAt}ms`);
  return {
    openId: user.data.open_id,
    unionId: user.data.union_id,
    userId: user.data.user_id,
    name: user.data.name,
    avatarUrl: user.data.avatar_url,
    tenantKey: user.data.tenant_key,
  };
}

export async function exchangeCode(code: string) {
  const { allowedTenantKey } = configuration();
  const user = await getFeishuUserIdentity(code);
  if (user.tenantKey !== allowedTenantKey) throw new FeishuLoginError("unauthorized_tenant");
  return user;
}

export async function getTenantAccessToken() {
  const { appId, appSecret } = configuration({ requireTenantKey: false });
  const token = await fetchEnvelope<TenantToken>("tenant access token", `${API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!token.tenant_access_token) throw new FeishuLoginError("remote");
  return token.tenant_access_token;
}
