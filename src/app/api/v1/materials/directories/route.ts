import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";
import { createMaterialDirectory, listMaterialDirectories } from "@/services/materials/material-service";
import { getProject } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await actorFromRequest(request);
    return apiJson(await listMaterialDirectories());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await publisherFromRequest(request);
    const input = z.object({
      name: z.string().trim().min(1).max(120),
      scope: z.enum(["project", "public"]),
      projectId: z.string().trim().min(2).max(80).optional(),
      parentId: z.string().trim().min(2).max(100).optional(),
    }).superRefine((value, context) => {
      if (value.scope === "project" && !value.projectId) context.addIssue({ code: "custom", message: "项目子目录必须指定项目。", path: ["projectId"] });
    }).parse(await request.json());
    if (input.scope === "project") await getProject(input.projectId!);
    return apiJson(await createMaterialDirectory(input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
