import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";
import { createMaterialDirectory, listMaterialDirectories } from "@/services/materials/material-service";

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
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(await request.json());
    return apiJson(await createMaterialDirectory(name), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
