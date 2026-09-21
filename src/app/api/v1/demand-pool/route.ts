import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";
import { createDemandPoolItem, listDemandPoolItems } from "@/services/demand-pool/demand-pool-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().optional(),
  category: z.string().optional(),
  projectId: z.string().nullable().optional(),
  detail: z.string().optional(),
  value: z.string().optional(),
  proposer: z.string().optional(),
  rawContent: z.string().min(1).max(100_000),
  relatedRequirementCodes: z.array(z.string()).optional(),
});

export async function GET(request: Request) {
  try {
    await actorFromRequest(request);
    return apiJson(await listDemandPoolItems());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await publisherFromRequest(request);
    const input = createSchema.parse(await request.json());
    return apiJson(await createDemandPoolItem({
      title: input.title ?? "",
      category: input.category as never,
      projectId: input.projectId ?? undefined,
      detail: input.detail ?? "",
      value: input.value as never,
      proposer: input.proposer ?? undefined,
      rawContent: input.rawContent,
      relatedRequirementCodes: input.relatedRequirementCodes,
    }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
