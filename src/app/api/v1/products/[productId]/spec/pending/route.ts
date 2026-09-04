import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";
import { listPendingProductSpecExtractions, resolvePendingProductSpecExtraction } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    await actorFromRequest(request);
    return apiJson(await listPendingProductSpecExtractions((await params).productId));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await publisherFromRequest(request);
    const body = await request.json() as { id?: unknown; decisions?: unknown };
    if (typeof body.id !== "string" || !Array.isArray(body.decisions)) throw new Error("冲突处理参数不完整。");
    return apiJson(await resolvePendingProductSpecExtraction(body.id, body.decisions as Array<{ path: string; action: "keep_existing" | "use_incoming" | "product_override" }>, actor));
  } catch (error) { return apiError(error); }
}
