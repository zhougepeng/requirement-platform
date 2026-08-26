import { NextResponse } from "next/server";
import { exchangeCode, FeishuLoginError } from "@/services/auth/feishu-auth";
import { registerLoginEmployee } from "@/services/auth/employee-store";
import { decodeOAuthLoginState, encodeSession, OAUTH_STATE_COOKIE, SESSION_COOKIE } from "@/services/auth/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${OAUTH_STATE_COOKIE}=([^;]+)`))?.[1];
  const savedLogin = decodeOAuthLoginState(savedState);
  const loginPage = (error: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
    response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  };
  if (!state || !savedLogin || state !== savedLogin.state) return loginPage("state");
  if (!code) return loginPage(url.searchParams.get("error") === "access_denied" ? "cancelled" : "failed");
  try {
    const user = await exchangeCode(code);
    await registerLoginEmployee(user);
    const response = NextResponse.redirect(new URL(savedLogin.returnTo, request.url));
    response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    response.cookies.set(SESSION_COOKIE, encodeSession(user), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 60 * 60 });
    return response;
  } catch (error) {
    return loginPage(error instanceof FeishuLoginError && error.kind === "unauthorized_tenant" ? "tenant" : error instanceof FeishuLoginError && error.kind === "configuration" ? "configuration" : "failed");
  }
}
