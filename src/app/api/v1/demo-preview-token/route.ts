import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest } from "@/services/auth/request-actor";
import { createDemoPreviewToken, isSafeDemoPath } from "@/services/demo/demo-preview-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : url.origin;
}

export async function POST(request: Request) {
  try {
    await actorFromRequest(request);
    const body = await request.json() as { src?: unknown };
    if (typeof body.src !== "string" || !body.src.trim()) throw new Error("Demo 地址无效。");
    const origin = requestOrigin(request);
    const source = new URL(body.src, origin);
    if (source.origin !== origin || !source.pathname.startsWith("/demo-assets/")) throw new Error("仅支持预览本平台已发布的 Demo。");
    const segments = source.pathname.slice("/demo-assets/".length).split("/").map((segment) => decodeURIComponent(segment));
    if (!isSafeDemoPath(segments) || segments[3]?.toLowerCase() !== "demo") throw new Error("Demo 预览路径无效。");
    const token = createDemoPreviewToken(segments.slice(0, 4));
    const previewPath = `/demo-preview/${encodeURIComponent(token)}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
    return apiJson({ url: previewPath });
  } catch (error) {
    return apiError(error);
  }
}
