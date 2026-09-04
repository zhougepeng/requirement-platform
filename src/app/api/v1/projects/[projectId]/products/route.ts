import { apiError, apiJson } from "@/lib/api-response";
import { linkProjectProduct, listProjectProducts } from "@/services/requirement/repository";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try { await actorFromRequest(_request); return apiJson(await listProjectProducts((await params).projectId)); } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    await publisherFromRequest(request);
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.productId !== "string") throw new Error("产品必填。");
    return apiJson(await linkProjectProduct((await params).projectId, body.productId), { status: 201 });
  } catch (error) { return apiError(error); }
}
