import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { askRequirementAssistant } from "@/services/assistant/requirement-assistant";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const assistantRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  scope: z.enum(["current-requirement", "current-project", "all-published"]),
  requirement_code: z.string().trim().min(2).max(80).optional(),
  project_id: z.string().trim().min(2).max(80).optional(),
  version_no: z.number().int().positive().optional(),
}).superRefine((value, context) => {
  if (value.scope === "current-requirement" && !value.requirement_code) context.addIssue({ code: "custom", message: "当前需求范围必须提供 requirement_code。", path: ["requirement_code"] });
  if (value.scope === "current-project" && !value.project_id) context.addIssue({ code: "custom", message: "当前项目范围必须提供 project_id。", path: ["project_id"] });
});

export async function POST(request: Request) {
  try {
    await actorFromRequest(request);
    const body = await request.json();
    const input = assistantRequestSchema.parse(body);
    return apiJson(await askRequirementAssistant({
      question: input.question,
      scope: input.scope,
      requirementCode: input.requirement_code,
      projectId: input.project_id,
      versionNo: input.version_no,
    }));
  } catch (error) {
    return apiError(error);
  }
}
