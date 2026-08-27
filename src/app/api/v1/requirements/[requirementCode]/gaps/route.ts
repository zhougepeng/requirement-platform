import { apiError, apiJson } from "@/lib/api-response";
import { addRequirementGap, listRequirementGaps } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await actorFromRequest(request);
    const { requirementCode } = await params;
    return apiJson(await listRequirementGaps(requirementCode));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    const actor = await actorFromRequest(request);
    const { requirementCode } = await params;
    const body = await request.json() as { question?: unknown };
    if (typeof body.question !== "string") throw new Error("question 必填。");
    return apiJson(await addRequirementGap(requirementCode, body.question, actor), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
