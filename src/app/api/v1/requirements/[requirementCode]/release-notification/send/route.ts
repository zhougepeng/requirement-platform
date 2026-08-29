import { apiError, apiJson } from "@/lib/api-response";
import type { NotificationTarget } from "@/lib/release-notification";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { getRequirementDetail } from "@/services/requirement/repository";
import { feishuNotificationService } from "@/services/notifications/feishu-notification-service";
import { saveReleaseNotificationPreference } from "@/services/notifications/release-notification-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    const [actor, { requirementCode }, body] = await Promise.all([
      publisherFromRequest(request),
      params,
      request.json() as Promise<{ targets?: unknown; content?: unknown }>,
    ]);
    if (!Array.isArray(body.targets) || typeof body.content !== "string") throw new Error("通知参数无效。");
    const detail = await getRequirementDetail(requirementCode);
    if (!detail) throw new Error("需求不存在。");
    const targets = body.targets as NotificationTarget[];
    const result = await feishuNotificationService.send(targets, body.content);
    await saveReleaseNotificationPreference(actor.id, detail.project.id, { enabled: true, targets });
    return apiJson(result);
  } catch (error) {
    return apiError(error);
  }
}
