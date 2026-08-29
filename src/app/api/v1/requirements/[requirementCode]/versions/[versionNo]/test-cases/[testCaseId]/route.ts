import { apiError, apiJson } from "@/lib/api-response";
import { updateVersionTestCaseStatus } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";
import { scheduleRequirementKnowledgeSync } from "@/services/assistant/knowledge-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ requirementCode: string; versionNo: string; testCaseId: string }> }) {
  try {
    await actorFromRequest(request);
    const { requirementCode, versionNo, testCaseId } = await params;
    const number = Number(versionNo);
    const body = await request.json() as { status?: unknown };
    if (!Number.isInteger(number) || number < 1) throw new Error("版本号不合法。");
    if (body.status !== "pending" && body.status !== "passed" && body.status !== "failed" && body.status !== "blocked") throw new Error("测试状态不合法。");
    const updated = await updateVersionTestCaseStatus(requirementCode, number, testCaseId, body.status);
    scheduleRequirementKnowledgeSync(requirementCode);
    return apiJson(updated);
  } catch (error) { return apiError(error); }
}
