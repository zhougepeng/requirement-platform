import { apiError, apiJson } from "@/lib/api-response";
import { getProductSpecExtractionPreflight } from "@/services/requirement/repository";
import { publisherFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await publisherFromRequest(request);
    const productId = new URL(request.url).searchParams.get("productId");
    if (!productId) throw new Error("产品必填。");
    return apiJson(await getProductSpecExtractionPreflight((await params).requirementCode, productId));
  } catch (error) {
    return apiError(error);
  }
}
