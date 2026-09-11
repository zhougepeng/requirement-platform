import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { archiveRequirement, recordRequirementAudit } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    const actor = await publisherFromRequest(request);
    const { requirementCode } = await params;
    const archived = await archiveRequirement(requirementCode, actor);
    await recordRequirementAudit({ requirementCode, action: "archive_requirement", actor });
    return apiJson(archived);
  } catch (error) {
    return apiError(error);
  }
}
