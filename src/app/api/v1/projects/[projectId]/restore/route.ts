import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { restoreProject } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    await publisherFromRequest(request);
    const { projectId } = await params;
    return apiJson(await restoreProject(projectId));
  } catch (error) {
    return apiError(error);
  }
}
