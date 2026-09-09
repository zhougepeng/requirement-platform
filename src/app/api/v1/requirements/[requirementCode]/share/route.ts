import { apiError, apiJson } from "@/lib/api-response";
import type { NotificationTarget } from "@/lib/release-notification";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { feishuNotificationService } from "@/services/notifications/feishu-notification-service";
import { getRequirementDetail } from "@/services/requirement/repository";
import { createPublicRequirementShareToken, requestOrigin } from "@/services/requirement/public-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await publisherFromRequest(request);
    const [{ requirementCode }, body] = await Promise.all([
      params,
      request.json() as Promise<{ targets?: unknown }>,
    ]);
    if (!Array.isArray(body.targets) || !body.targets.length) throw new Error("请至少选择一个接收对象。");
    const detail = await getRequirementDetail(requirementCode);
    if (!detail) throw new Error("需求不存在。");
    const { token } = createPublicRequirementShareToken(requirementCode, detail.currentVersion.number);
    const url = `${requestOrigin(request)}/share/${encodeURIComponent(token)}`;
    const content = [`【需求分享】${detail.requirement.title}`, `查看需求：${url}`].join("\n");
    return apiJson(await feishuNotificationService.send(body.targets as NotificationTarget[], content));
  } catch (error) {
    return apiError(error);
  }
}
