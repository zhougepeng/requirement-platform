import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { fetchFeishuEmployees } from "@/services/auth/feishu-org";
import { adminFromRequest } from "@/services/auth/request-actor";
import { listEmployees, syncEmployees, updateEmployee } from "@/services/auth/employee-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({ open_id: z.string().trim().min(1).max(200), role: z.enum(["none", "viewer", "publisher", "admin"]) });

export async function GET(request: Request) {
  try { await adminFromRequest(request); return apiJson(await listEmployees()); } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await adminFromRequest(request);
    const directory = await fetchFeishuEmployees();
    const employees = await syncEmployees(directory.employees);
    return apiJson({
      employees,
      count: employees.length,
      fetchedCount: directory.employees.length,
      departmentCount: directory.departmentCount,
      diagnostics: directory.diagnostics,
    });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    await adminFromRequest(request);
    const body = updateSchema.parse(await request.json());
    return apiJson(await updateEmployee(body.open_id, { role: body.role }));
  } catch (error) { return apiError(error); }
}
