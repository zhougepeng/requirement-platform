import { apiError, apiJson } from "@/lib/api-response";
import { listVersions, publishRequirementSnapshot } from "@/services/requirement/repository";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await actorFromRequest(_request);
    const { requirementCode } = await params;
    return apiJson(await listVersions(requirementCode));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    const actor = await publisherFromRequest(request);
    const { requirementCode } = await params;
    const formData = await request.formData();
    const archive = formData.get("archive");
    const changeSummary = formData.get("change_summary");
    if (!(archive instanceof File)) throw new Error("请以 archive 字段上传需求资产 ZIP。");
    if (typeof changeSummary !== "string") throw new Error("change_summary 必填。");
    return apiJson(await publishRequirementSnapshot({ requirementCode, archive, changeSummary, versionName: typeof formData.get("version_name") === "string" ? String(formData.get("version_name")) : undefined, setCurrent: formData.get("set_current") !== "false", actor }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
