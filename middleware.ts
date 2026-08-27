import { NextResponse, type NextRequest } from "next/server";
import { publicAppUrl } from "@/lib/public-app-url";

const SESSION_COOKIE = "requirement_platform_session";

function bytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hasValidSession(value: string | undefined) {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!value || !secret) return false;
  const [payload, signature, ...rest] = value.split(".");
  if (!payload || !signature || rest.length) return false;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, bytes(signature), new TextEncoder().encode(payload));
    if (!valid) return false;
    const session = JSON.parse(new TextDecoder().decode(bytes(payload))) as { expiresAt?: unknown; openId?: unknown };
    return typeof session.openId === "string" && typeof session.expiresAt === "number" && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

/**
 * 服务间调用（例如工作搭子）使用独立的 Bearer 令牌，不携带浏览器会话。
 * 中间件必须在进入 API Route 前放行该令牌，否则请求会在这里先返回 401。
 * 令牌只对 API 请求生效，页面和静态资源仍然必须通过飞书登录。
 */
function hasValidIntegrationToken(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) return false;
  const configured = process.env.WORKBENCH_INTEGRATION_TOKEN?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(configured && supplied && configured === supplied);
}

export async function middleware(request: NextRequest) {
  if (process.env.AUTH_MODE !== "feishu") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path === "/login" || path.startsWith("/auth/") || path.startsWith("/api/auth/") || path === "/api/health" || path === "/mcp") return NextResponse.next();
  if (hasValidIntegrationToken(request)) return NextResponse.next();
  if (await hasValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "请先使用飞书登录。" }, { status: 401 });
  const loginUrl = publicAppUrl("/login", request.url);
  loginUrl.searchParams.set("returnTo", `${path}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
