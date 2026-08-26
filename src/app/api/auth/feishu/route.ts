import { NextResponse } from "next/server";
import { getFeishuQrGotoUrl } from "@/services/auth/feishu-auth";
import { createOAuthLoginState, OAUTH_STATE_COOKIE, safeReturnTo } from "@/services/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
    const loginState = createOAuthLoginState(returnTo);
    const response = NextResponse.json({ data: { goto: getFeishuQrGotoUrl(loginState.state) } });
    response.cookies.set(OAUTH_STATE_COOKIE, loginState.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "飞书登录尚未完成配置，请联系管理员。" }, { status: 503 });
  }
}
