import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 仅用于本机部署探活。不要在这里输出认证模式、环境变量、版本路径或业务数据。
 */
export function GET() {
  return NextResponse.json(
    { status: "ok", timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
