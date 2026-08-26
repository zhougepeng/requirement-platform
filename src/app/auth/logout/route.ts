import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/services/auth/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL(process.env.AUTH_MODE === "feishu" ? "/login" : "/", request.url));
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
