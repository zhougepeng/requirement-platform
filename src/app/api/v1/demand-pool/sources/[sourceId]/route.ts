import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { deleteDemandPoolSource, syncDemandPoolSource } from "@/services/demand-pool/demand-pool-source-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  try {
    await publisherFromRequest(request);
    await deleteDemandPoolSource((await params).sourceId);
    return apiJson({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  try {
    await publisherFromRequest(request);
    return apiJson(await syncDemandPoolSource((await params).sourceId));
  } catch (error) { return apiError(error); }
}
