import { apiError, apiJson } from "@/lib/api-response";
import { getGenerationContext } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await actorFromRequest(request);
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    if (type && type !== "prd" && type !== "demo") throw new Error("生成类型无效。");
    return apiJson(await getGenerationContext({
      requirementId: url.searchParams.get("requirementId") || undefined,
      requirementCode: url.searchParams.get("requirementCode") || undefined,
      projectId: url.searchParams.get("projectId") || undefined,
      productId: url.searchParams.get("productId") || undefined,
      type: type as "prd" | "demo" | undefined,
    }));
  } catch (error) {
    return apiError(error);
  }
}
