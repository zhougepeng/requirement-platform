import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { createModel, deleteModel, listModels, updateModel } from "@/services/assistant/model-config";
import { adminFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const modelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().min(1).max(500),
  model: z.string().trim().min(1).max(160),
  apiKey: z.string().trim().min(1).max(2000),
  isDefault: z.boolean().optional(),
});
const updateSchema = modelSchema.partial().extend({ id: z.string().trim().min(6).max(100) });
const deleteSchema = z.object({ id: z.string().trim().min(6).max(100) });

export async function GET(request: Request) {
  try {
    await adminFromRequest(request);
    return apiJson(await listModels());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await adminFromRequest(request);
    return apiJson(await createModel(modelSchema.parse(await request.json())), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await adminFromRequest(request);
    return apiJson(await updateModel(updateSchema.parse(await request.json())));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await adminFromRequest(request);
    const body = deleteSchema.parse(await request.json());
    await deleteModel(body.id);
    return apiJson({ id: body.id });
  } catch (error) {
    return apiError(error);
  }
}
