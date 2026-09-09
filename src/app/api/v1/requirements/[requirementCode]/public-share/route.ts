import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest } from "@/services/auth/request-actor";
import { createPublicRequirementShareToken, requestOrigin } from "@/services/requirement/public-share";
import { getRequirementDetail } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await actorFromRequest(request);
    const [{ requirementCode }, body] = await Promise.all([
      params,
      request.json().catch(() => ({})) as Promise<{ versionNo?: unknown }>,
    ]);
    const detail = await getRequirementDetail(requirementCode);
    if (detail.requirement.archivedAt || detail.project.archivedAt) throw new Error("已作废的需求不能生成分享链接。");
    const requestedVersion = body.versionNo === undefined ? detail.currentVersion.number : Number(body.versionNo);
    if (!Number.isInteger(requestedVersion) || requestedVersion < 1) throw new Error("版本号无效。");
    const { token, expiresAt } = createPublicRequirementShareToken(requirementCode, requestedVersion);
    return apiJson({ url: `${requestOrigin(request)}/share/${encodeURIComponent(token)}`, expiresAt, versionNo: requestedVersion });
  } catch (error) {
    return apiError(error);
  }
}
