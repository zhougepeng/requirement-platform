import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { askRequirementAssistant, askRequirementKnowledgeAssistant } from "@/services/assistant/requirement-assistant";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requirementRequestSchema = z.object({
  requirement_code: z.string().trim().min(2).max(80),
  question: z.string().trim().min(1).max(2000),
  version_no: z.number().int().positive().optional(),
});
const knowledgeRequestSchema = z.object({
  scope: z.literal("knowledge-base"),
  question: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  try {
    await actorFromRequest(request);
    const body = await request.json();
    const knowledgeRequest = knowledgeRequestSchema.safeParse(body);
    if (knowledgeRequest.success) return apiJson(await askRequirementKnowledgeAssistant(knowledgeRequest.data.question));
    const requirementRequest = requirementRequestSchema.parse(body);
    return apiJson(await askRequirementAssistant({ requirementCode: requirementRequest.requirement_code, question: requirementRequest.question, versionNo: requirementRequest.version_no }));
  } catch (error) {
    return apiError(error);
  }
}
