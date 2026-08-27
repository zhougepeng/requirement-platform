import { apiError } from "@/lib/api-response";
import { actorFromRequest } from "@/services/auth/request-actor";
import { downloadRequirementVersion } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ requirementCode: string; versionNo: string }> }) {
  try {
    await actorFromRequest(request);
    const { requirementCode, versionNo } = await params;
    const result = await downloadRequirementVersion(requirementCode, Number(versionNo));
    return new Response(new Uint8Array(result.body), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename=\"${result.name}\"`, "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
