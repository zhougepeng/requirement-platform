import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(ROOT, "data", "requirement-platform");
export const PUBLISHED_DEMO_DIR = process.env.REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR)
  : path.join(DATA_DIR, "published-demos");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp", ".woff2": "font/woff2",
};

export function isSafePublishedDemoPath(segments: string[]) {
  return Boolean(segments.length) && segments.every((segment) => segment && segment !== "." && segment !== ".." && !/[\\/]/.test(segment));
}

/** Vite defaults to /assets. Published demos live below a version folder instead. */
export function normalizeDemoEntryHtml(html: string) {
  return html.replace(
    /(\b(?:src|href|poster)\s*=\s*["'])\/(assets|img|images|fonts|static)\/([^"']+)(["'])/gi,
    "$1./$2/$3$4",
  );
}

export async function readPublishedDemoAsset(segments: string[]) {
  if (!isSafePublishedDemoPath(segments)) return undefined;
  const requestedPath = path.resolve(PUBLISHED_DEMO_DIR, ...segments);
  if (!requestedPath.startsWith(`${PUBLISHED_DEMO_DIR}${path.sep}`)) return undefined;
  const candidates = [requestedPath];
  // Snapshot document links use vN/demo/... while older static publishes were
  // materialized at vN/... only. Keep both layouts readable during migration.
  if (segments[3]?.toLowerCase() === "demo") {
    const legacyPath = path.resolve(PUBLISHED_DEMO_DIR, ...segments.slice(0, 3), ...segments.slice(4));
    if (legacyPath.startsWith(`${PUBLISHED_DEMO_DIR}${path.sep}`)) candidates.push(legacyPath);
  }
  for (const candidate of candidates) {
    try {
      const body = await readFile(candidate);
      const contentType = MIME[path.extname(candidate).toLowerCase()] ?? "application/octet-stream";
      return { body, contentType, isHtml: contentType.startsWith("text/html") };
    } catch {}
  }
  return undefined;
}
