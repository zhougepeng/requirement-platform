import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { restoreRequirementVersion } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string; versionNo: string }> }) {
  try {
    const actor = await publisherFromRequest(request);
    const { requirementCode, versionNo } = await params;
    const number = Number(versionNo);
    if (!Number.isInteger(number) || number < 1) throw new Error("版本号不合法。");
    return apiJson(await restoreRequirementVersion(requirementCode, number, actor), { status: 201 });
  } catch (error) { return apiError(error); }
}
