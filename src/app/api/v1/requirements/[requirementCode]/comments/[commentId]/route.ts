import { apiError, apiJson } from "@/lib/api-response";
import { deletePrdComment, recordRequirementAudit, updatePrdComment } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  try {
    const [{ commentId }, body, actor] = await Promise.all([params, request.json() as Promise<{ content?: unknown }>, actorFromRequest(request)]);
    if (typeof body.content !== "string") throw new Error("评论内容必填。");
    const updated = await updatePrdComment(commentId, body.content, actor);
    await recordRequirementAudit({ requirementCode: updated.requirementCode, action: "update_comment", actor });
    return apiJson(updated);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  try {
    const [{ commentId }, actor] = await Promise.all([params, actorFromRequest(request)]);
    const deleted = await deletePrdComment(commentId, actor);
    await recordRequirementAudit({ requirementCode: deleted.requirementCode, action: "delete_comment", actor });
    return apiJson(deleted);
  } catch (error) {
    return apiError(error);
  }
}
