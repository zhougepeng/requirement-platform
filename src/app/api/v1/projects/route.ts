import { apiError, apiJson } from "@/lib/api-response";
import { createProject, listProjects } from "@/services/requirement/repository";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await actorFromRequest(request);
    return apiJson(await listProjects());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await publisherFromRequest(request);
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.code !== "string" || typeof body.name !== "string") throw new Error("项目编码和项目名称必填。");
    return apiJson(await createProject({
      code: body.code,
      name: body.name,
      description: typeof body.description === "string" ? body.description : "",
      owner: typeof body.owner === "string" ? body.owner : undefined,
    }, actor), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
