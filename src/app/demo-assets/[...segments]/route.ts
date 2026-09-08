import { readFile } from "node:fs/promises";
import path from "node:path";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(ROOT, "data", "requirement-platform");
const PUBLISHED_DEMO_DIR = process.env.REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR)
  : path.join(DATA_DIR, "published-demos");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp", ".woff2": "font/woff2",
};

export async function GET(request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  try {
    await actorFromRequest(request);
  } catch {
    return new Response("Unauthorized", { status: 403 });
  }
  const { segments } = await params;
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\/]/.test(segment))) {
    return new Response("Not found", { status: 404 });
  }
  const requestedPath = path.resolve(PUBLISHED_DEMO_DIR, ...segments);
  if (!requestedPath.startsWith(`${PUBLISHED_DEMO_DIR}${path.sep}`)) return new Response("Not found", { status: 404 });
  // Snapshot document links use vN/demo/... while older static publishes were
  // materialized at vN/... only. Keep both layouts readable during migration.
  const candidates = [requestedPath];
  if (segments[3]?.toLowerCase() === "demo") {
    const legacySegments = [...segments.slice(0, 3), ...segments.slice(4)];
    const legacyPath = path.resolve(PUBLISHED_DEMO_DIR, ...legacySegments);
    if (legacyPath.startsWith(`${PUBLISHED_DEMO_DIR}${path.sep}`)) candidates.push(legacyPath);
  }
  try {
    let filePath = "";
    let body: ArrayBuffer | undefined;
    for (const candidate of candidates) {
      try {
        const source = await readFile(candidate);
        body = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
        filePath = candidate;
        break;
      } catch {}
    }
    if (!body || !filePath) return new Response("Not found", { status: 404 });
    const contentType = MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    const headers = new Headers({ "Content-Type": contentType, "X-Content-Type-Options": "nosniff" });
    // Demo pages are served from this same route, so their relative images,
    // styles and scripts must be allowed as same-origin resources. Keep all
    // external/network capabilities disabled.
    if (contentType.startsWith("text/html")) headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; form-action 'none'; connect-src 'none'; base-uri 'none'");
    return new Response(body, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
