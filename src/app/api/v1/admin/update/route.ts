import { apiError, apiJson } from "@/lib/api-response";
import { adminFromRequest } from "@/services/auth/request-actor";
import { checkInstallerUpdate, startInstallerUpdate } from "@/services/system/github-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await adminFromRequest(request);
    return apiJson(await checkInstallerUpdate());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await adminFromRequest(request);
    return apiJson(await startInstallerUpdate());
  } catch (error) {
    return apiError(error);
  }
}
