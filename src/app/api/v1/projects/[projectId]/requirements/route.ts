import { apiError, apiJson } from "@/lib/api-response";
import { listProjectRequirements } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    await actorFromRequest(request);
    const { projectId } = await params;
    const includeArchived = new URL(request.url).searchParams.get("include_archived") === "true";
    return apiJson(await listProjectRequirements(projectId, includeArchived));
  } catch (error) {
    return apiError(error);
  }
}
