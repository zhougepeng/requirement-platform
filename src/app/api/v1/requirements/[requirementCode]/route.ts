import { apiError, apiJson } from "@/lib/api-response";
import { getRequirementDetail, getRequirementDetailSummary, recordRequirementAudit } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    const actor = await actorFromRequest(request);
    const { requirementCode } = await params;
    const meta = new URL(request.url).searchParams.get("meta") === "true";
    const detail = await (meta ? getRequirementDetailSummary(requirementCode) : getRequirementDetail(requirementCode));
    await recordRequirementAudit({ requirementCode, action: "view_requirement", actor, detail: meta ? "打开需求详情" : "读取需求内容" });
    return apiJson(detail);
  } catch (error) {
    return apiError(error);
  }
}
