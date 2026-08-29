import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { listFeishuNotificationTargets } from "@/services/notifications/feishu-notification-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await publisherFromRequest(request);
    return apiJson(await listFeishuNotificationTargets());
  } catch (error) {
    return apiError(error);
  }
}
