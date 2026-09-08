import { normalizeDemoEntryHtml, readPublishedDemoAsset } from "@/services/demo/published-demo-assets";
import { verifyDemoPreviewToken } from "@/services/demo/demo-preview-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function startsWithPath(path: string[], prefix: string[]) {
  return path.length >= prefix.length && prefix.every((segment, index) => path[index] === segment);
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; segments: string[] }> }) {
  const { token, segments } = await params;
  const claims = verifyDemoPreviewToken(token);
  if (!claims || !startsWithPath(segments, claims.path)) return new Response("Not found", { status: 404 });
  const asset = await readPublishedDemoAsset(segments);
  if (!asset) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": asset.contentType,
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": "private, max-age=300",
  });
  if (asset.isHtml) {
    headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'self'; form-action 'none'; connect-src 'none'; base-uri 'none'");
    return new Response(normalizeDemoEntryHtml(asset.body.toString("utf8")), { headers });
  }
  return new Response(asset.body, { headers });
}
