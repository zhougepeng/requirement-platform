import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";
import { createDemandPoolSource, listDemandPoolSources, listFeishuBaseTables } from "@/services/demand-pool/demand-pool-source-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inspectSchema = z.object({ url: z.string().min(1).max(2_000) });
const createSchema = z.object({ name: z.string().max(120).optional(), url: z.string().min(1).max(2_000), tableId: z.string().min(1).max(200) });

export async function GET(request: Request) {
  try {
    await actorFromRequest(request);
    return apiJson(await listDemandPoolSources());
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await publisherFromRequest(request);
    const input = createSchema.parse(await request.json());
    return apiJson(await createDemandPoolSource(input), { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    await actorFromRequest(request);
    return apiJson(await listFeishuBaseTables(inspectSchema.parse(await request.json())));
  } catch (error) { return apiError(error); }
}
