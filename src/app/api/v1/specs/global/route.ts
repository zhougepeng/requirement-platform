import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest } from "@/services/auth/request-actor";
import { getGlobalSpec } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { await actorFromRequest(request); return apiJson(await getGlobalSpec()); } catch (error) { return apiError(error); }
}
