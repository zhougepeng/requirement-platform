import { apiError, apiJson } from "@/lib/api-response";
import { getRequirementDetail, getRequirementDetailSummary } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await actorFromRequest(request);
    const { requirementCode } = await params;
    const meta = new URL(request.url).searchParams.get("meta") === "true";
    return apiJson(await (meta ? getRequirementDetailSummary(requirementCode) : getRequirementDetail(requirementCode)));
  } catch (error) {
    return apiError(error);
  }
}
