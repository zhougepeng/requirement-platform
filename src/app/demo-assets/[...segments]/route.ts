import { actorFromRequest } from "@/services/auth/request-actor";
import { normalizeDemoEntryHtml, readPublishedDemoAsset } from "@/services/demo/published-demo-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  try {
    await actorFromRequest(request);
  } catch {
    return new Response("Unauthorized", { status: 403 });
  }
  const { segments } = await params;
  try {
    const asset = await readPublishedDemoAsset(segments);
    if (!asset) return new Response("Not found", { status: 404 });
    const headers = new Headers({ "Content-Type": asset.contentType, "X-Content-Type-Options": "nosniff" });
    // Demo pages are served from this same route, so their relative images,
    // styles and scripts must be allowed as same-origin resources. Keep all
    // external/network capabilities disabled.
    if (asset.isHtml) {
      headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; form-action 'none'; connect-src 'none'; base-uri 'none'");
      return new Response(normalizeDemoEntryHtml(asset.body.toString("utf8")), { headers });
    }
    return new Response(asset.body, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
