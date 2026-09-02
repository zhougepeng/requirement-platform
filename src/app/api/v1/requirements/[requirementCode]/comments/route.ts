import { apiError, apiJson } from "@/lib/api-response";
import { addHtmlComment, addPrdComment, listHtmlComments, listPrdComments, replyHtmlComment, replyPrdComment } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";
import type { HtmlCommentAnchor, PrdCommentAnchor } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await actorFromRequest(request);
    const { requirementCode } = await params;
    const url = new URL(request.url);
    const versionId = url.searchParams.get("version_id");
    const documentId = url.searchParams.get("document_id");
    const kind = url.searchParams.get("kind") || "prd";
    if (!versionId || !documentId) throw new Error("version_id 和 document_id 必填。");
    if (kind === "html") return apiJson(await listHtmlComments(requirementCode, versionId, documentId));
    if (kind !== "prd") throw new Error("不支持的评论类型。");
    return apiJson(await listPrdComments(requirementCode, versionId, documentId));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    const { requirementCode } = await params;
    const body = await request.json() as { version_id?: unknown; document_id?: unknown; content?: unknown; parent_id?: unknown; anchor?: unknown; kind?: unknown };
    if (typeof body.version_id !== "string" || typeof body.document_id !== "string" || typeof body.content !== "string") throw new Error("version_id、document_id 和 content 必填。");
    const actor = await actorFromRequest(request);
    const kind = body.kind === "html" ? "html" : "prd";
    if (typeof body.parent_id === "string") return apiJson(kind === "html" ? await replyHtmlComment(requirementCode, body.version_id, body.document_id, body.parent_id, body.content, actor) : await replyPrdComment(requirementCode, body.version_id, body.document_id, body.parent_id, body.content, actor), { status: 201 });
    if (!body.anchor || typeof body.anchor !== "object") throw new Error("新建评论必须关联原文或页面区域。");
    if (kind === "html") return apiJson(await addHtmlComment(requirementCode, body.version_id, body.content, body.anchor as HtmlCommentAnchor, actor), { status: 201 });
    return apiJson(await addPrdComment(requirementCode, body.version_id, body.content, body.anchor as PrdCommentAnchor, actor), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
