import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { updateDemandPoolItem } from "@/services/demand-pool/demand-pool-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  title: z.string().optional(),
  category: z.string().optional(),
  projectId: z.string().nullable().optional(),
  detail: z.string().optional(),
  value: z.string().optional(),
  proposer: z.string().optional(),
  status: z.string().optional(),
  closedReason: z.string().nullable().optional(),
  relatedRequirementCodes: z.array(z.string()).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    await publisherFromRequest(request);
    const input = updateSchema.parse(await request.json());
    const id = (await params).itemId;
    return apiJson(await updateDemandPoolItem(id, {
      ...input,
      projectId: input.projectId,
      closedReason: input.closedReason,
      category: input.category as never,
      value: input.value as never,
      status: input.status as never,
    }));
  } catch (error) {
    return apiError(error);
  }
}
