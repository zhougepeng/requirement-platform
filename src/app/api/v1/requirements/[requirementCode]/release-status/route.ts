import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { updateRequirementReleaseStatus } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await publisherFromRequest(request);
    const { requirementCode } = await params;
    const body = await request.json() as { status?: unknown; releaseVersion?: unknown; releaseDate?: unknown };
    const status = body.status === "online" || body.status === "offline" ? body.status : undefined;
    if (!status) throw new Error("需求状态无效。");
    return apiJson(await updateRequirementReleaseStatus(requirementCode, {
      status,
      releaseVersion: typeof body.releaseVersion === "string" ? body.releaseVersion : undefined,
      releaseDate: typeof body.releaseDate === "string" ? body.releaseDate : undefined,
    }));
  } catch (error) {
    return apiError(error);
  }
}
