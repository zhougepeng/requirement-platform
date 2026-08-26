import { NextResponse } from "next/server";
import { getFeishuLoginUrl } from "@/services/auth/feishu-auth";
import { createState, OAUTH_STATE_COOKIE } from "@/services/auth/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const state = createState();
    const response = NextResponse.redirect(getFeishuLoginUrl(state));
    response.cookies.set(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法发起飞书登录。" }, { status: 503 });
  }
}
