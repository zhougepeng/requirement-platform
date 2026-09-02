import { apiError, apiJson } from "@/lib/api-response";
import { deleteRequirementDiscussion, processRequirementDiscussion, updateRequirementDiscussion } from "@/services/requirement/repository";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ requirementCode: string; discussionId: string }> }) {
  try {
    const [{ requirementCode, discussionId }, body, actor] = await Promise.all([params, request.json() as Promise<{ content?: unknown; action?: unknown; resolution?: unknown; note?: unknown; related_requirement_code?: unknown }>, actorFromRequest(request)]);
    if (body.action === "process") {
      let canManage = false;
      try { await publisherFromRequest(request); canManage = true; } catch { /* owner permission is checked by the store. */ }
      if (body.resolution !== "resolved" && body.resolution !== "rejected" && body.resolution !== "related_requirement") throw new Error("处理方式无效。");
      if (typeof body.note !== "string") throw new Error("处理说明必填。");
      return apiJson(await processRequirementDiscussion(requirementCode, discussionId, { resolution: body.resolution, note: body.note, relatedRequirementCode: typeof body.related_requirement_code === "string" ? body.related_requirement_code : undefined }, actor, canManage));
    }
    if (typeof body.content !== "string") throw new Error("讨论内容必填。");
    return apiJson(await updateRequirementDiscussion(discussionId, body.content, actor));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ discussionId: string }> }) {
  try {
    const [{ discussionId }, actor] = await Promise.all([params, actorFromRequest(request)]);
    return apiJson(await deleteRequirementDiscussion(discussionId, actor));
  } catch (error) {
    return apiError(error);
  }
}
