import { NextResponse } from "next/server";
import { exchangeCode, FeishuLoginError, getFeishuUserIdentity, isFeishuTenantDiscoveryEnabled } from "@/services/auth/feishu-auth";
import { registerLoginEmployee } from "@/services/auth/employee-store";
import { decodeOAuthLoginState, encodeSession, OAUTH_STATE_COOKIE, SESSION_COOKIE, shouldUseSecureCookies } from "@/services/auth/session";
import { publicAppUrl } from "@/lib/public-app-url";
import { recordRequirementAudit } from "@/services/requirement/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${OAUTH_STATE_COOKIE}=([^;]+)`))?.[1];
  const savedLogin = decodeOAuthLoginState(savedState);
  const loginPage = (error: string) => {
    const response = NextResponse.redirect(publicAppUrl(`/login?error=${encodeURIComponent(error)}`, request.url));
    response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  };
  if (!state || !savedLogin || state !== savedLogin.state) return loginPage("state");
  if (!code) return loginPage(url.searchParams.get("error") === "access_denied" ? "cancelled" : "failed");
  try {
    if (isFeishuTenantDiscoveryEnabled()) {
      const user = await getFeishuUserIdentity(code);
      const response = NextResponse.redirect(publicAppUrl(`/login?tenantKey=${encodeURIComponent(user.tenantKey ?? "")}`, request.url));
      response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
      return response;
    }
    const user = await exchangeCode(code);
    await registerLoginEmployee(user);
    try {
      await recordRequirementAudit({ action: "login_platform", actor: { id: user.openId, name: user.name }, detail: "飞书登录" });
    } catch {
      // 审计日志写入失败不应阻断已经成功的登录。
    }
    const response = NextResponse.redirect(publicAppUrl(savedLogin.returnTo, request.url));
    response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    response.cookies.set(SESSION_COOKIE, encodeSession(user), { httpOnly: true, sameSite: "lax", secure: shouldUseSecureCookies(), path: "/", maxAge: 8 * 60 * 60 });
    return response;
  } catch (error) {
    return loginPage(error instanceof FeishuLoginError && error.kind === "unauthorized_tenant" ? "tenant" : error instanceof FeishuLoginError && error.kind === "configuration" ? "configuration" : "failed");
  }
}
