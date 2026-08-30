import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";
import { createMaterial, listMaterials } from "@/services/materials/material-service";
import { scheduleMaterialKnowledgeSync } from "@/services/materials/material-knowledge-sync-service";
import { getProject } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  scope: z.enum(["project", "public"]),
  projectId: z.string().trim().min(2).max(80).optional(),
  directoryId: z.string().trim().min(2).max(100).optional(),
  title: z.string().trim().min(1).max(120),
  content: z.string().min(1).max(400_000),
  fileName: z.string().trim().max(180).optional(),
}).superRefine((value, context) => {
  if (value.scope === "project" && !value.projectId) context.addIssue({ code: "custom", message: "项目资料必须指定项目。", path: ["projectId"] });
});

export async function GET(request: Request) {
  try {
    await actorFromRequest(request);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "public" ? "public" : "project";
    const projectId = url.searchParams.get("project_id")?.trim() || undefined;
    const directoryId = url.searchParams.get("directory_id")?.trim() || undefined;
    return apiJson(await listMaterials({ scope, projectId, directoryId }));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await publisherFromRequest(request);
    const input = createSchema.parse(await request.json());
    if (input.scope === "project") await getProject(input.projectId!);
    const material = await createMaterial(input);
    scheduleMaterialKnowledgeSync(material.id);
    return apiJson(material, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
