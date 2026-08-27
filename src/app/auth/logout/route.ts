import { NextResponse } from "next/server";
import { SESSION_COOKIE, shouldUseSecureCookies } from "@/services/auth/session";
import { publicAppUrl } from "@/lib/public-app-url";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const response = NextResponse.redirect(publicAppUrl(process.env.AUTH_MODE === "feishu" ? "/login" : "/", request.url));
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: shouldUseSecureCookies(), path: "/", maxAge: 0 });
  return response;
}
