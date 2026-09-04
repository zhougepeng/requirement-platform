import { apiError, apiJson } from "@/lib/api-response";
import { extractProductSpecWithModel } from "@/services/assistant/product-spec-generator";
import { publisherFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await publisherFromRequest(request);
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.productId !== "string") throw new Error("产品必填。");
    return apiJson(await extractProductSpecWithModel((await params).requirementCode, body.productId));
  } catch (error) { return apiError(error); }
}
