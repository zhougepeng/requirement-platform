import { apiError, apiJson } from "@/lib/api-response";
import { getProject, updateProject } from "@/services/requirement/repository";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    await actorFromRequest(_request);
    const { projectId } = await params;
    return apiJson(await getProject(projectId));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    await publisherFromRequest(request);
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.name !== "string") throw new Error("项目名称必填。");
    return apiJson(await updateProject(projectId, {
      name: body.name,
      description: typeof body.description === "string" ? body.description : "",
      owner: typeof body.owner === "string" ? body.owner : undefined,
    }));
  } catch (error) {
    return apiError(error);
  }
}
