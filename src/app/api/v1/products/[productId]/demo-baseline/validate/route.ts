import { apiError, apiJson } from "@/lib/api-response";
import { validateDemoAgainstProductBaseline } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    await actorFromRequest(request);
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.html !== "string") throw new Error("待校验的 Demo HTML 必填。");
    return apiJson(await validateDemoAgainstProductBaseline((await params).productId, body.html));
  } catch (error) {
    return apiError(error);
  }
}
