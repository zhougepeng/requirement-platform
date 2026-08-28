import { apiError, apiJson } from "@/lib/api-response";
import { adminFromRequest } from "@/services/auth/request-actor";
import { testAssistantModelConnection } from "@/services/assistant/model-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await adminFromRequest(request);
    return apiJson(await testAssistantModelConnection());
  } catch (error) {
    return apiError(error);
  }
}
