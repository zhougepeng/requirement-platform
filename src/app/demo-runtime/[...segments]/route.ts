import { ensureRequirementRuntime } from "@/services/requirement/runtime-manager";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "content-encoding",
]);

function invalidSegment(value: string) {
  return !value || value === "." || value === ".." || /[\\/\0]/.test(value);
}

function errorResponse(message: string, status: number) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  return proxyRuntimeRequest(request, params);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  return proxyRuntimeRequest(request, params);
}

export async function POST(request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  return proxyRuntimeRequest(request, params);
}

export async function PUT(request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  return proxyRuntimeRequest(request, params);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  return proxyRuntimeRequest(request, params);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  return proxyRuntimeRequest(request, params);
}

async function proxyRuntimeRequest(request: Request, params: Promise<{ segments: string[] }>) {
  try {
    await actorFromRequest(request);
  } catch {
    return errorResponse("Unauthorized", 403);
  }
  const { segments } = await params;
  if (segments.length < 3 || segments.some(invalidSegment)) return errorResponse("Not found", 404);
  const [projectCode, requirementCode, versionSegment, ...rest] = segments;
  const versionMatch = /^v([1-9][0-9]*)$/.exec(versionSegment);
  if (!versionMatch) return errorResponse("Not found", 404);
  const versionNo = Number(versionMatch[1]);
  try {
    const runtime = await ensureRequirementRuntime(requirementCode, versionNo);
    if (runtime.projectCode !== projectCode || !runtime.port) return errorResponse("Not found", 404);
    const target = new URL(`http://127.0.0.1:${runtime.port}/${rest.join("/")}`);
    target.search = new URL(request.url).search;
    const headers = new Headers(request.headers);
    for (const header of ["host", "connection", "content-length", "transfer-encoding", "x-forwarded-host", "x-forwarded-proto"]) headers.delete(header);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const upstream = await fetch(target, { method: request.method, headers, body, redirect: "manual", cache: "no-store" });
    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
    });
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    const location = upstream.headers.get("location");
    if (location?.startsWith("/")) responseHeaders.set("Location", `/demo-runtime/${projectCode}/${requirementCode}/v${versionNo}${location}`);
    return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  } catch (error) {
    console.error("[demo-runtime] request failed", error);
    return errorResponse(error instanceof Error ? error.message.slice(0, 4000) : "Demo 运行实例启动失败。", 502);
  }
}
