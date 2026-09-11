import { apiError, apiJson } from "@/lib/api-response";
import type { NotificationTarget } from "@/lib/release-notification";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { getRequirementDetail } from "@/services/requirement/repository";
import { feishuNotificationService } from "@/services/notifications/feishu-notification-service";
import { saveReleaseNotificationPreference } from "@/services/notifications/release-notification-preferences";
import { requestOrigin } from "@/services/requirement/public-share";

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
    if (detail.requirement.status !== "scheduled") throw new Error("只有已排期需求支持发送排期通知，上线需求不会发送此通知。");
    const targets = body.targets as NotificationTarget[];
    if (!targets.length) throw new Error("请至少选择一个飞书通知对象。");
    const scheduleVersion = detail.requirement.scheduleVersion?.trim();
    if (!scheduleVersion) throw new Error("当前需求缺少排期版本，无法发送排期通知。");
    const longTermUrl = `${requestOrigin(request)}/r/${encodeURIComponent(requirementCode)}?${new URLSearchParams({ v: String(detail.currentVersion.number), returnTo: "/?view=assigned" }).toString()}`;
    let content = body.content.trim();
    if (!content) throw new Error("通知内容不能为空。");
    if (!content.includes(detail.requirement.title)) content = `【需求排期】${detail.requirement.title}\n${content}`;
    if (!content.includes(`排期版本：${scheduleVersion}`)) content = `${content}\n排期版本：${scheduleVersion}`;
    if (!content.includes("查看需求：")) content = `${content}\n查看需求：${longTermUrl}`;
    const result = await feishuNotificationService.send(targets, content);
    // Delivery is the user-visible operation. Preference persistence is a convenience
    // for reusing the selected targets and must not turn a successful send into an error.
    let preferenceSaved = true;
    try {
      await saveReleaseNotificationPreference(actor.id, detail.project.id, { enabled: true, targets });
    } catch (error) {
      preferenceSaved = false;
      console.warn(`[release-notification] preference persistence failed after delivery for ${requirementCode}`, error);
    }
    return apiJson({ ...result, preferenceSaved });
  } catch (error) {
    return apiError(error);
  }
}
