import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { getRequirementDetail } from "@/services/requirement/repository";
import { buildReleaseNotificationDraft } from "@/services/notifications/release-notification-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await publisherFromRequest(request);
    const [{ requirementCode }, body] = await Promise.all([params, request.json() as Promise<{ kind?: unknown; releaseVersion?: unknown; releaseDate?: unknown; scheduleVersion?: unknown; scheduledGrayDate?: unknown; scheduledFullDate?: unknown }>]);
    const kind = body.kind === "scheduled" ? "scheduled" : "online";
    const releaseVersion = typeof body.releaseVersion === "string" ? body.releaseVersion.trim() : "";
    const releaseDate = typeof body.releaseDate === "string" ? body.releaseDate.trim() : "";
    const scheduleVersion = typeof body.scheduleVersion === "string" ? body.scheduleVersion.trim() : "";
    const scheduledGrayDate = typeof body.scheduledGrayDate === "string" ? body.scheduledGrayDate.trim() : "";
    const scheduledFullDate = typeof body.scheduledFullDate === "string" ? body.scheduledFullDate.trim() : "";
    if (kind === "online" && (!releaseVersion || !releaseDate)) throw new Error("请填写上线版本和上线时间。");
    if (kind === "scheduled" && (!scheduleVersion || !scheduledGrayDate || !scheduledFullDate)) throw new Error("请填写排期版本、预计灰度时间和预计全量时间。");
    const detail = await getRequirementDetail(requirementCode);
    if (!detail) throw new Error("需求不存在。");
    return apiJson(await buildReleaseNotificationDraft(requirementCode, detail.currentVersion.number, { kind, releaseVersion, releaseDate, scheduleVersion, scheduledGrayDate, scheduledFullDate }));
  } catch (error) {
    return apiError(error);
  }
}
