import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { createDemoPreviewToken, isSafeDemoPath } from "@/services/demo/demo-preview-token";
import { getRequirementDetail, getVersion } from "@/services/requirement/repository";
import type { RequirementDocument, RequirementVersion } from "@/lib/types";

const PUBLIC_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_CODE = /^[A-Za-z0-9._-]{1,80}$/;

export type PublicRequirementShareClaims = {
  version: 1;
  requirementCode: string;
  versionNo: number;
  expiresAt: number;
};

function signingSecret() {
  const configured = process.env.PUBLIC_SHARE_TOKEN_SECRET || process.env.AUTH_SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== "production") return "requirement-platform-local-public-share-secret";
  throw new Error("生产环境需要配置至少 32 位的 PUBLIC_SHARE_TOKEN_SECRET 或 AUTH_SESSION_SECRET。");
}

function sign(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

function encodeClaims(claims: PublicRequirementShareClaims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function createPublicRequirementShareToken(requirementCode: string, versionNo: number) {
  if (!SAFE_CODE.test(requirementCode) || !Number.isInteger(versionNo) || versionNo < 1) throw new Error("分享需求参数无效。");
  const claims: PublicRequirementShareClaims = { version: 1, requirementCode, versionNo, expiresAt: Date.now() + PUBLIC_SHARE_TTL_MS };
  return { token: encodeClaims(claims), expiresAt: claims.expiresAt };
}

export function verifyPublicRequirementShareToken(value?: string): PublicRequirementShareClaims | undefined {
  if (!value) return undefined;
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length) return undefined;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PublicRequirementShareClaims;
    return claims.version === 1 && SAFE_CODE.test(claims.requirementCode) && Number.isInteger(claims.versionNo) && claims.versionNo > 0 && claims.expiresAt > Date.now() ? claims : undefined;
  } catch {
    return undefined;
  }
}

function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : url.origin;
}

function publicDemoUrl(entryUrl: string | undefined, origin: string) {
  if (!entryUrl || !entryUrl.startsWith("/demo-assets/")) return undefined;
  try {
    const parsed = new URL(entryUrl, origin);
    if (parsed.origin !== origin) return undefined;
    const segments = parsed.pathname.slice("/demo-assets/".length).split("/").map((segment) => decodeURIComponent(segment));
    if (!isSafeDemoPath(segments) || segments.length < 4) return undefined;
    const prefix = segments[3]?.toLowerCase() === "demo" ? segments.slice(0, 4) : segments.slice(0, 3);
    const previewToken = createDemoPreviewToken(prefix);
    return `${origin}/demo-preview/${encodeURIComponent(previewToken)}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
  } catch {
    return undefined;
  }
}

function prdDocuments(version: RequirementVersion) {
  const documents = version.documents?.filter((document) => document.kind === "prd" && document.content?.trim());
  return documents?.length ? documents : [{ id: `${version.id}:prd`, name: "PRD.md", path: "PRD.md", kind: "prd" as const, mimeType: "text/markdown", order: 0, content: version.prd } satisfies RequirementDocument];
}

export async function getPublicRequirementSharePayload(token: string, origin: string) {
  const claims = verifyPublicRequirementShareToken(token);
  if (!claims) throw new Error("分享链接已失效或无效。");
  const detail = await getRequirementDetail(claims.requirementCode);
  if (detail.requirement.archivedAt || detail.project.archivedAt) throw new Error("该需求已作废，无法预览。");
  const version = await getVersion(claims.requirementCode, claims.versionNo);
  const documents = prdDocuments(version).map((document) => ({ name: document.name, path: document.path, content: document.content ?? "" }));
  const demoUrl = publicDemoUrl(version.demoEntryUrl, origin);
  const publicUrl = `${origin}/share/${encodeURIComponent(token)}`;
  const apiUrl = `${origin}/api/public/requirements/share/${encodeURIComponent(token)}`;
  return {
    publicUrl,
    apiUrl,
    expiresAt: claims.expiresAt,
    backUrl: `/?view=requirements&project=${encodeURIComponent(detail.project.id)}`,
    project: { id: detail.project.id, name: detail.project.name },
    requirement: { code: detail.requirement.code, title: detail.requirement.title, status: detail.requirement.status },
    version: { number: version.number, publishedAt: version.publishedAt, publisher: version.publisher, changeSummary: version.changeSummary },
    prd: documents,
    demo: { previewUrl: demoUrl, sourceUrl: version.demoEntryUrl, available: Boolean(demoUrl), runtime: Boolean(version.runtime) },
    agentContext: {
      requirementCode: detail.requirement.code,
      requirementTitle: detail.requirement.title,
      projectName: detail.project.name,
      versionNo: version.number,
      prd: documents,
      demoUrl,
      note: "这是只读预览分享。请结合 PRD 与 Demo 页面分析，不要执行写入或发布操作。",
    },
  };
}

export { requestOrigin };
