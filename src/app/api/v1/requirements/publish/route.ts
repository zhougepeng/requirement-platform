import { apiError, apiJson } from "@/lib/api-response";
import { publishRequirement } from "@/services/requirement/repository";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { scheduleRequirementKnowledgeSync } from "@/services/assistant/knowledge-sync-service";
import { scheduleRequirementProductSpecExtraction } from "@/services/requirement/product-spec-extraction-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const required = ["project_code", "title", "prd_markdown", "change_summary"] as const;
    for (const key of required) if (typeof body[key] !== "string") throw new Error(`${key} 必填。`);
    if (body.artifact_id !== undefined && typeof body.artifact_id !== "string") throw new Error("artifact_id 必须是字符串。");
    const published = await publishRequirement({
      projectCode: body.project_code as string,
      requirementCode: typeof body.requirement_code === "string" ? body.requirement_code : undefined,
      title: body.title as string,
      prdMarkdown: body.prd_markdown as string,
      artifactId: typeof body.artifact_id === "string" ? body.artifact_id : undefined,
      changeSummary: body.change_summary as string,
      actor: await publisherFromRequest(request),
    });
    scheduleRequirementKnowledgeSync(published.requirement.code);
    if (published.requirement.status === "online") scheduleRequirementProductSpecExtraction(published.requirement.code, published.requirement.ownerId && published.requirement.owner ? { id: published.requirement.ownerId, name: published.requirement.owner } : undefined);
    return apiJson(published, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
