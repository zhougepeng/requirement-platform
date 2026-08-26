import "server-only";

type FeishuEnvelope<T> = { code?: number; msg?: string; data?: T };
type FeishuToken = { app_access_token?: string };
type TenantToken = { tenant_access_token?: string };
type LoginToken = { access_token?: string };
type FeishuUser = { open_id?: string; name?: string; avatar_url?: string; tenant_key?: string };

const API = "https://open.feishu.cn/open-apis";

function configuration() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
  if (!appId || !appSecret || !baseUrl) throw new Error("飞书登录尚未配置。请设置 FEISHU_APP_ID、FEISHU_APP_SECRET 和 APP_BASE_URL。");
  return { appId, appSecret, baseUrl };
}

async function fetchEnvelope<T>(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const payload = await response.json() as FeishuEnvelope<T>;
  if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(`飞书登录请求失败：${payload.code ?? response.status}`);
  return payload.data;
}

export function getFeishuLoginUrl(state: string) {
  const { appId, baseUrl } = configuration();
  const url = new URL(`${API}/authen/v1/index`);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("redirect_uri", `${baseUrl}/auth/callback`);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(code: string) {
  const { appId, appSecret } = configuration();
  const appToken = await fetchEnvelope<FeishuToken>(`${API}/auth/v3/app_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!appToken.app_access_token) throw new Error("飞书未返回应用访问凭证。");
  const loginToken = await fetchEnvelope<LoginToken>(`${API}/authen/v1/access_token`, {
    method: "POST", headers: { Authorization: `Bearer ${appToken.app_access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  if (!loginToken.access_token) throw new Error("飞书未返回用户访问凭证。");
  const user = await fetchEnvelope<FeishuUser>(`${API}/authen/v1/user_info`, { headers: { Authorization: `Bearer ${loginToken.access_token}` } });
  if (!user.open_id || !user.name) throw new Error("飞书未返回可用用户信息。");
  const allowedTenants = (process.env.FEISHU_ALLOWED_TENANT_KEYS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (allowedTenants.length && (!user.tenant_key || !allowedTenants.includes(user.tenant_key))) throw new Error("当前飞书租户未获准访问需求平台。");
  return { openId: user.open_id, name: user.name, avatarUrl: user.avatar_url, tenantKey: user.tenant_key };
}

export async function getTenantAccessToken() {
  const { appId, appSecret } = configuration();
  const token = await fetchEnvelope<TenantToken>(`${API}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!token.tenant_access_token) throw new Error("飞书未返回通讯录访问凭证。请确认应用已开通通讯录权限。");
  return token.tenant_access_token;
}
