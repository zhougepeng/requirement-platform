import { NextResponse } from "next/server";
import { exchangeCode } from "@/services/auth/feishu-auth";
import { registerLoginEmployee } from "@/services/auth/employee-store";
import { encodeSession, OAUTH_STATE_COOKIE, SESSION_COOKIE } from "@/services/auth/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${OAUTH_STATE_COOKIE}=([^;]+)`))?.[1];
  if (!code || !state || !savedState || state !== savedState) return NextResponse.json({ error: "飞书登录校验失败，请重新登录。" }, { status: 400 });
  try {
    const user = await exchangeCode(code);
    await registerLoginEmployee(user);
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    response.cookies.set(SESSION_COOKIE, encodeSession(user), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 60 * 60 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "飞书登录失败。" }, { status: 403 });
  }
}
