import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { archiveProject } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = await publisherFromRequest(request);
    const { projectId } = await params;
    return apiJson(await archiveProject(projectId, actor));
  } catch (error) {
    return apiError(error);
  }
}
