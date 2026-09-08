import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest } from "@/services/auth/request-actor";
import { ensureRequirementRuntime, getRequirementRuntimeStatus, stopRequirementRuntime } from "@/services/requirement/runtime-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function versionNumber(value: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error("版本号不合法。");
  return number;
}

export async function GET(request: Request, { params }: { params: Promise<{ requirementCode: string; versionNo: string }> }) {
  try {
    await actorFromRequest(request);
    const { requirementCode, versionNo } = await params;
    return apiJson(await getRequirementRuntimeStatus(requirementCode, versionNumber(versionNo)));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string; versionNo: string }> }) {
  try {
    await actorFromRequest(request);
    const { requirementCode, versionNo } = await params;
    return apiJson(await ensureRequirementRuntime(requirementCode, versionNumber(versionNo)));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ requirementCode: string; versionNo: string }> }) {
  try {
    await actorFromRequest(request);
    const { requirementCode, versionNo } = await params;
    return apiJson(await stopRequirementRuntime(requirementCode, versionNumber(versionNo)));
  } catch (error) {
    return apiError(error);
  }
}
