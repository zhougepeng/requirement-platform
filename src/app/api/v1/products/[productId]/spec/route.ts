import { apiError, apiJson } from "@/lib/api-response";
import { getProductSpec, mergeProductSpec } from "@/services/requirement/repository";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try { await actorFromRequest(request); return apiJson(await getProductSpec((await params).productId)); } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const actor = await publisherFromRequest(request);
    const body = await request.json() as Record<string, unknown>;
    if (!body.draftSpec || typeof body.draftSpec !== "object") throw new Error("规范草稿必填。");
    return apiJson(await mergeProductSpec((await params).productId, body.draftSpec as never, actor));
  } catch (error) { return apiError(error); }
}
