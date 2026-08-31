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
 * 个人访问令牌存于服务端数据目录，Edge 中间件无法安全读取该文件。
 * Bearer 请求仅在此处放行，真正的令牌、在职状态和角色校验统一由 API Route 完成。
 */
function hasBearerAccessToken(request: NextRequest) {
  return request.nextUrl.pathname.startsWith("/api/") && /^Bearer\s+\S+$/i.test(request.headers.get("authorization") ?? "");
}

export async function middleware(request: NextRequest) {
  if (process.env.AUTH_MODE !== "feishu") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path === "/login" || path.startsWith("/auth/") || path.startsWith("/api/auth/") || path === "/api/health" || path === "/mcp") return NextResponse.next();
  if (hasBearerAccessToken(request)) return NextResponse.next();
  if (await hasValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "请先使用飞书登录。" }, { status: 401 });
  const loginUrl = publicAppUrl("/login", request.url);
  loginUrl.searchParams.set("returnTo", `${path}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
