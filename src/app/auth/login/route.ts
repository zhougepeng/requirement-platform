import { NextResponse } from "next/server";
import { getFeishuLoginUrl } from "@/services/auth/feishu-auth";
import { createOAuthLoginState, OAUTH_STATE_COOKIE, safeReturnTo, shouldUseSecureCookies } from "@/services/auth/session";
import { publicAppUrl } from "@/lib/public-app-url";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  try {
    const loginState = createOAuthLoginState(safeReturnTo(requestUrl.searchParams.get("returnTo")));
    const response = NextResponse.redirect(getFeishuLoginUrl(loginState.state));
    response.cookies.set(OAUTH_STATE_COOKIE, loginState.cookieValue, { httpOnly: true, sameSite: "lax", secure: shouldUseSecureCookies(), path: "/", maxAge: 600 });
    return response;
  } catch {
    return NextResponse.redirect(publicAppUrl("/login?error=configuration", request.url));
  }
}
