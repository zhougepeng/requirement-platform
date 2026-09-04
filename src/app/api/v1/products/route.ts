import { apiError, apiJson } from "@/lib/api-response";
import { createProduct, listProducts } from "@/services/requirement/repository";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { await actorFromRequest(request); return apiJson(await listProducts(new URL(request.url).searchParams.get("q") ?? "")); } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await publisherFromRequest(request);
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.name !== "string") throw new Error("产品名称必填。");
    return apiJson(await createProduct({ name: body.name, description: typeof body.description === "string" ? body.description : "" }), { status: 201 });
  } catch (error) { return apiError(error); }
}
