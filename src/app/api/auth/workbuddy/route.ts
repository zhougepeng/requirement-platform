import { apiError, apiJson } from "@/lib/api-response";
import { sessionActorFromRequest } from "@/services/auth/request-actor";
import { getEmployee } from "@/services/auth/employee-store";
import { createWorkbuddySsoToken } from "@/services/auth/workbuddy-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workbuddyBaseUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw Object.assign(new Error("工作搭子网址格式不正确。"), { statusCode: 400 });
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw Object.assign(new Error("工作搭子网址必须是没有查询参数的 http 或 https 地址。"), { statusCode: 400 });
  }
  const allowedOrigins = (process.env.WORKBUDDY_SSO_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowedOrigins.length && !allowedOrigins.includes(parsed.origin)) {
    throw Object.assign(new Error("该工作搭子地址未被服务器允许。"), { statusCode: 403 });
  }
  return parsed.toString().replace(/\/$/, "");
}

export async function GET(request: Request) {
  try {
    const baseUrl = workbuddyBaseUrl(new URL(request.url).searchParams.get("workbuddyUrl") || "");
    const target = new URL("auth/sso", `${baseUrl}/`);
    if (process.env.AUTH_MODE?.trim() !== "feishu") return apiJson({ url: target.toString() });

    const actor = sessionActorFromRequest(request);
    if (!actor) throw Object.assign(new Error("请先使用飞书登录。"), { statusCode: 401 });
    const employee = await getEmployee(actor.id);
    if (!employee || employee.directoryActive === false) {
      throw Object.assign(new Error("当前员工账号不可进入工作搭子。"), { statusCode: 403 });
    }
    const token = createWorkbuddySsoToken({ openId: actor.id, name: actor.name });
    target.searchParams.set("token", token);
    return apiJson({ url: target.toString() });
  } catch (error) {
    return apiError(error);
  }
}
