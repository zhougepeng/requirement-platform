import { apiError, apiJson } from "@/lib/api-response";
import { listProjectRequirements } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    await actorFromRequest(_request);
    const { projectId } = await params;
    return apiJson(await listProjectRequirements(projectId));
  } catch (error) {
    return apiError(error);
  }
}
