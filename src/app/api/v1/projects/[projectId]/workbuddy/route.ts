import { apiError, apiJson } from "@/lib/api-response";
import { adminFromRequest, actorFromRequest } from "@/services/auth/request-actor";
import { getProject, updateProjectWorkbuddyUrl } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    await actorFromRequest(request);
    const { projectId } = await params;
    const project = await getProject(projectId);
    return apiJson({ url: project.workbuddyUrl ?? "" });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    await adminFromRequest(request);
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.url !== "string") throw new Error("工作搭子网址必须是文本。");
    return apiJson(await updateProjectWorkbuddyUrl(projectId, { url: body.url }));
  } catch (error) {
    return apiError(error);
  }
}
