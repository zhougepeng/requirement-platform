import { apiError, apiJson } from "@/lib/api-response";
import { getRequirementDetail } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await actorFromRequest(_request);
    const { requirementCode } = await params;
    return apiJson(await getRequirementDetail(requirementCode));
  } catch (error) {
    return apiError(error);
  }
}
