import { apiError, apiJson } from "@/lib/api-response";
import type { NotificationTarget } from "@/lib/release-notification";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { feishuNotificationService } from "@/services/notifications/feishu-notification-service";
import { getRequirementDetail } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : url.origin;
}

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
    const url = `${requestOrigin(request)}/r/${encodeURIComponent(requirementCode)}`;
    const content = [`【需求分享】${detail.requirement.title}`, `查看需求：${url}`].join("\n");
    return apiJson(await feishuNotificationService.send(body.targets as NotificationTarget[], content));
  } catch (error) {
    return apiError(error);
  }
}
