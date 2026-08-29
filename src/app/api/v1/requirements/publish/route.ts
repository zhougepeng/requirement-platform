import { apiError, apiJson } from "@/lib/api-response";
import { publishRequirement } from "@/services/requirement/repository";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { scheduleRequirementKnowledgeSync } from "@/services/assistant/knowledge-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const required = ["project_code", "title", "prd_markdown", "artifact_id", "change_summary"] as const;
    for (const key of required) if (typeof body[key] !== "string") throw new Error(`${key} 必填。`);
    const published = await publishRequirement({
      projectCode: body.project_code as string,
      requirementCode: typeof body.requirement_code === "string" ? body.requirement_code : undefined,
      title: body.title as string,
      prdMarkdown: body.prd_markdown as string,
      artifactId: body.artifact_id as string,
      changeSummary: body.change_summary as string,
      actor: await publisherFromRequest(request),
    });
    scheduleRequirementKnowledgeSync(published.requirement.code);
    return apiJson(published, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
