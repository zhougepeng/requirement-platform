import { apiError, apiJson } from "@/lib/api-response";
import { getProduct, getProductGenerationContext, getProductSpec } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    await actorFromRequest(request);
    const { productId } = await params;
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind === "spec") return apiJson(await getProductSpec(productId));
    if (kind === "context") return apiJson(await getProductGenerationContext(productId));
    return apiJson(await getProduct(productId));
  } catch (error) { return apiError(error); }
}
