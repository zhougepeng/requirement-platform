import { apiError, apiJson } from "@/lib/api-response";
import { addRequirementDiscussion, listRequirementDiscussions, replyRequirementDiscussion } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await actorFromRequest(request);
    const { requirementCode } = await params;
    return apiJson(await listRequirementDiscussions(requirementCode));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    const [{ requirementCode }, body, actor] = await Promise.all([params, request.json() as Promise<{ content?: unknown; parent_id?: unknown }>, actorFromRequest(request)]);
    if (typeof body.content !== "string") throw new Error("讨论内容必填。");
    if (typeof body.parent_id === "string") return apiJson(await replyRequirementDiscussion(requirementCode, body.parent_id, body.content, actor), { status: 201 });
    return apiJson(await addRequirementDiscussion(requirementCode, body.content, actor), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
