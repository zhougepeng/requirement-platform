import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { fetchFeishuEmployees } from "@/services/auth/feishu-org";
import { adminFromRequest } from "@/services/auth/request-actor";
import { listEmployees, syncEmployees, updateEmployee } from "@/services/auth/employee-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({ open_id: z.string().trim().min(1).max(200), enabled: z.boolean().optional(), is_admin: z.boolean().optional() }).refine((value) => value.enabled !== undefined || value.is_admin !== undefined, "至少提供一项变更。");

export async function GET(request: Request) {
  try { await adminFromRequest(request); return apiJson(await listEmployees()); } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await adminFromRequest(request);
    const synced = await syncEmployees(await fetchFeishuEmployees());
    return apiJson({ employees: synced, count: synced.length });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    await adminFromRequest(request);
    const body = updateSchema.parse(await request.json());
    return apiJson(await updateEmployee(body.open_id, { enabled: body.enabled, isAdmin: body.is_admin }));
  } catch (error) { return apiError(error); }
}
