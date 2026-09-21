import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest } from "@/services/auth/request-actor";
import { recognizeDemandPool } from "@/services/demand-pool/demand-pool-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ rawContent: z.string().min(1).max(100_000) });

export async function POST(request: Request) {
  try {
    await actorFromRequest(request);
    const input = schema.parse(await request.json());
    return apiJson(await recognizeDemandPool(input.rawContent));
  } catch (error) {
    return apiError(error);
  }
}
