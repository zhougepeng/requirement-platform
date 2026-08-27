import { apiError, apiJson } from "@/lib/api-response";
import { sessionActorFromRequest } from "@/services/auth/request-actor";
import { getEmployee } from "@/services/auth/employee-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = sessionActorFromRequest(request);
    const name = actor?.name || process.env.LOCAL_USER_NAME?.trim() || "本地开发身份";
    const employee = actor ? await getEmployee(actor.id) : undefined;
    const role = actor ? (employee?.role ?? "none") : "admin";
    const enabled = !actor || role !== "none";
    return apiJson({ name, initial: name.slice(0, 1) || "用", mode: actor ? "feishu" : "local", openId: actor?.id, role, enabled, pendingApproval: Boolean(actor && !enabled), canView: !actor || enabled, canPublish: !actor || role === "publisher" || role === "admin", isAdmin: !actor || role === "admin" });
  } catch (error) {
    return apiError(error);
  }
}
