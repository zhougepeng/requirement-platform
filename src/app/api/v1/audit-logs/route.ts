import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest } from "@/services/auth/request-actor";
import { listRequirementAuditLogs, REQUIREMENT_AUDIT_ACTION_LABELS } from "@/services/requirement/local-store";
import type { RequirementAuditAction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await actorFromRequest(request);
    const params = new URL(request.url).searchParams;
    const action = params.get("action") || undefined;
    if (action && !(action in REQUIREMENT_AUDIT_ACTION_LABELS)) throw new Error("操作类型无效。");
    const limitParam = params.get("limit");
    let limit: number | undefined;
    if (limitParam !== null) {
      const parsedLimit = Number(limitParam);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) throw new Error("分页大小无效。");
      limit = parsedLimit;
    }
    return apiJson(await listRequirementAuditLogs({
      requirementCode: params.get("requirement_code") || undefined,
      actorName: params.get("actor") || undefined,
      action: action as RequirementAuditAction | undefined,
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
      cursor: params.get("cursor") || undefined,
      limit,
    }));
  } catch (error) {
    return apiError(error);
  }
}
