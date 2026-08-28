import { apiError, apiJson } from "@/lib/api-response";
import { generateTestCases } from "@/services/assistant/test-case-generator";
import { listVersionTestCases } from "@/services/requirement/repository";
import { actorFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function input(request: Request, params: Promise<{ requirementCode: string; versionNo: string }>) {
  await actorFromRequest(request);
  const { requirementCode, versionNo } = await params;
  const number = Number(versionNo);
  if (!Number.isInteger(number) || number < 1) throw new Error("版本号不合法。");
  return { requirementCode, versionNo: number };
}

export async function GET(request: Request, { params }: { params: Promise<{ requirementCode: string; versionNo: string }> }) {
  try { const value = await input(request, params); return apiJson(await listVersionTestCases(value.requirementCode, value.versionNo)); } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string; versionNo: string }> }) {
  try { const value = await input(request, params); return apiJson(await generateTestCases(value.requirementCode, value.versionNo), { status: 201 }); } catch (error) { return apiError(error); }
}
