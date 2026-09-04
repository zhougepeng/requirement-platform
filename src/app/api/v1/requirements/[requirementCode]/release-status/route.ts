import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { getRequirementDetail, updateRequirementReleaseStatus } from "@/services/requirement/repository";
import { scheduleRequirementKnowledgeSync } from "@/services/assistant/knowledge-sync-service";
import { scheduleRequirementKnowledgeExtraction } from "@/services/materials/requirement-knowledge-extraction-service";
import { detachGeneratedMaterialSource } from "@/services/materials/material-service";
import { scheduleRequirementProductSpecExtraction } from "@/services/requirement/product-spec-extraction-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    const actor = await publisherFromRequest(request);
    const { requirementCode } = await params;
    const before = await getRequirementDetail(requirementCode);
    const body = await request.json() as { status?: unknown; scheduleVersion?: unknown; scheduledGrayDate?: unknown; scheduledFullDate?: unknown; releaseVersion?: unknown; releaseDate?: unknown };
    const status = body.status === "online" || body.status === "scheduled" || body.status === "offline" ? body.status : undefined;
    if (!status) throw new Error("需求状态无效。");
    const updated = await updateRequirementReleaseStatus(requirementCode, {
      status,
      scheduleVersion: typeof body.scheduleVersion === "string" ? body.scheduleVersion : undefined,
      scheduledGrayDate: typeof body.scheduledGrayDate === "string" ? body.scheduledGrayDate : undefined,
      scheduledFullDate: typeof body.scheduledFullDate === "string" ? body.scheduledFullDate : undefined,
      releaseVersion: typeof body.releaseVersion === "string" ? body.releaseVersion : undefined,
      releaseDate: typeof body.releaseDate === "string" ? body.releaseDate : undefined,
    });
    scheduleRequirementKnowledgeSync(requirementCode);
    if (updated.status === "online" && before.requirement.status !== "online") {
      scheduleRequirementKnowledgeExtraction(requirementCode);
      scheduleRequirementProductSpecExtraction(requirementCode, actor);
    }
    else await detachGeneratedMaterialSource(requirementCode);
    return apiJson(updated);
  } catch (error) {
    return apiError(error);
  }
}
