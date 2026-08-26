import { apiError, apiJson } from "@/lib/api-response";
import { sessionActorFromRequest } from "@/services/auth/request-actor";
import { getEmployee } from "@/services/auth/employee-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = sessionActorFromRequest(request);
    const name = actor?.name || process.env.LOCAL_USER_NAME?.trim() || "本地开发身份";
    const publishers = (process.env.FEISHU_PUBLISHER_OPEN_IDS ?? "").split(",").map((item) => item.trim());
    const employee = actor ? await getEmployee(actor.id) : undefined;
    const enabled = !actor || employee?.enabled === true;
    return apiJson({ name, initial: name.slice(0, 1) || "用", mode: actor ? "feishu" : "local", openId: actor?.id, enabled, pendingApproval: Boolean(actor && !enabled), canPublish: !actor || (enabled && publishers.includes(actor.id)), isAdmin: !actor || employee?.isAdmin === true });
  } catch (error) {
    return apiError(error);
  }
}
