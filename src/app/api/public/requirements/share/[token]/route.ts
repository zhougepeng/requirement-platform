import { apiError, apiJson } from "@/lib/api-response";
import { getPublicRequirementSharePayload, requestOrigin } from "@/services/requirement/public-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const payload = await getPublicRequirementSharePayload(token, requestOrigin(request));
    return apiJson(payload, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
  } catch (error) {
    return apiError(error);
  }
}
