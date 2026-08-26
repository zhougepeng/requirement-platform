import { apiError, apiJson } from "@/lib/api-response";
import { getVersion } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ requirementCode: string; versionNo: string }> }) {
  try {
    await actorFromRequest(_request);
    const { requirementCode, versionNo } = await params;
    const number = Number(versionNo);
    if (!Number.isInteger(number) || number < 1) throw new Error("版本号不合法。");
    return apiJson(await getVersion(requirementCode, number));
  } catch (error) {
    return apiError(error);
  }
}
