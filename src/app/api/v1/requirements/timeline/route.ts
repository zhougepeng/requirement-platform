import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest } from "@/services/auth/request-actor";
import { listRequirementTimeline, type RequirementTimelineView } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await actorFromRequest(request);
    const searchParams = new URL(request.url).searchParams;
    const view: RequirementTimelineView = searchParams.get("view") === "version" ? "version" : "month";
    const cursor = searchParams.get("cursor")?.trim() || undefined;
    return apiJson(await listRequirementTimeline(view, cursor));
  } catch (error) {
    return apiError(error);
  }
}
