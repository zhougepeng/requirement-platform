import { NextResponse } from "next/server";
import { getFeishuQrGotoUrl } from "@/services/auth/feishu-auth";
import { createOAuthLoginState, OAUTH_STATE_COOKIE, safeReturnTo, shouldUseSecureCookies } from "@/services/auth/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  try {
    const loginState = createOAuthLoginState(safeReturnTo(requestUrl.searchParams.get("returnTo")));
    const response = NextResponse.redirect(getFeishuQrGotoUrl(loginState.state));
    response.cookies.set(OAUTH_STATE_COOKIE, loginState.cookieValue, { httpOnly: true, sameSite: "lax", secure: shouldUseSecureCookies(), path: "/", maxAge: 600 });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=configuration", request.url));
  }
}
