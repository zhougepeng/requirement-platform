import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { restoreRequirement } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requirementCode: string }> }) {
  try {
    await publisherFromRequest(request);
    const { requirementCode } = await params;
    return apiJson(await restoreRequirement(requirementCode));
  } catch (error) {
    return apiError(error);
  }
}
