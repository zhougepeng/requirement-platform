import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { recordRequirementAudit, restoreRequirement } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    const actor = await publisherFromRequest(request);
    const { requirementCode } = await params;
    const restored = await restoreRequirement(requirementCode);
    await recordRequirementAudit({ requirementCode, action: "restore_requirement", actor });
    return apiJson(restored);
  } catch (error) {
    return apiError(error);
  }
}
