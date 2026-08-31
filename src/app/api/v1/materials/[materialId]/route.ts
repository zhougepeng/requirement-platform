import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";
import { deleteMaterial, getMaterial, updateMaterial } from "@/services/materials/material-service";
import { scheduleMaterialKnowledgeDelete, scheduleMaterialKnowledgeSync } from "@/services/materials/material-knowledge-sync-service";
import { getProject } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  content: z.string().min(1).max(400_000).optional(),
  scope: z.enum(["project", "public"]).optional(),
  projectId: z.string().trim().min(2).max(80).optional(),
  directoryId: z.string().trim().min(2).max(100).nullable().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  try {
    await actorFromRequest(request);
    return apiJson(await getMaterial((await params).materialId));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  try {
    await publisherFromRequest(request);
    const input = updateSchema.parse(await request.json());
    if (input.scope === "project" && input.projectId) await getProject(input.projectId);
    const material = await updateMaterial((await params).materialId, input);
    scheduleMaterialKnowledgeSync(material.id);
    return apiJson(material);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  try {
    await publisherFromRequest(request);
    const { materialId } = await params;
    await deleteMaterial(materialId);
    scheduleMaterialKnowledgeDelete(materialId);
    return apiJson({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
