import { apiError, apiJson } from "@/lib/api-response";
import type { NotificationTarget } from "@/lib/release-notification";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { getProject } from "@/services/requirement/repository";
import { getReleaseNotificationPreference, saveReleaseNotificationPreference } from "@/services/notifications/release-notification-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(request: Request, params: Promise<{ projectId: string }>) {
  const [actor, { projectId }] = await Promise.all([publisherFromRequest(request), params]);
  const project = await getProject(projectId);
  if (!project || project.archivedAt) throw new Error("项目不存在或已作废。");
  return { actor, projectId };
}

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { actor, projectId } = await context(request, params);
    return apiJson(await getReleaseNotificationPreference(actor.id, projectId) ?? { enabled: true, targets: [] });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { actor, projectId } = await context(request, params);
    const body = await request.json() as { enabled?: unknown; targets?: unknown };
    if (typeof body.enabled !== "boolean" || !Array.isArray(body.targets)) throw new Error("通知偏好参数无效。");
    return apiJson(await saveReleaseNotificationPreference(actor.id, projectId, {
      enabled: body.enabled,
      targets: body.targets as NotificationTarget[],
    }));
  } catch (error) {
    return apiError(error);
  }
}
