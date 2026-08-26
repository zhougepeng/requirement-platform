import { apiError, apiJson } from "@/lib/api-response";
import { addComment, listComments } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await actorFromRequest(request);
    const { requirementCode } = await params;
    const versionId = new URL(request.url).searchParams.get("version_id") ?? undefined;
    return apiJson(await listComments(requirementCode, versionId));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    const { requirementCode } = await params;
    const body = await request.json() as { version_id?: unknown; content?: unknown };
    if (typeof body.version_id !== "string" || typeof body.content !== "string") throw new Error("version_id 和 content 必填。");
    return apiJson(await addComment(requirementCode, body.version_id, body.content, await actorFromRequest(request)), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
