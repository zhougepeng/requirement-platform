import { apiError, apiJson } from "@/lib/api-response";
import { deletePrdComment, updatePrdComment } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  try {
    const [{ commentId }, body, actor] = await Promise.all([params, request.json() as Promise<{ content?: unknown }>, actorFromRequest(request)]);
    if (typeof body.content !== "string") throw new Error("评论内容必填。");
    return apiJson(await updatePrdComment(commentId, body.content, actor));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  try {
    const [{ commentId }, actor] = await Promise.all([params, actorFromRequest(request)]);
    return apiJson(await deletePrdComment(commentId, actor));
  } catch (error) {
    return apiError(error);
  }
}
