import "server-only";

import { decodeSession, SESSION_COOKIE } from "@/services/auth/session";
import { getEmployee, requireAdminEmployee, requirePublisherEmployee, requireViewerEmployee } from "@/services/auth/employee-store";
import { resolvePersonalAccessToken } from "@/services/auth/personal-access-token-store";

export type RequirementActor = { id: string; name: string; authSource?: "session" | "personal_access_token" | "local" };

function sessionFromRequest(request: Request) {
  const value = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`))?.[1];
  return decodeSession(value);
}

function bearerToken(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return supplied || undefined;
}

async function personalAccessTokenActor(request: Request): Promise<RequirementActor | undefined> {
  const supplied = bearerToken(request);
  if (!supplied) return undefined;
  const credential = await resolvePersonalAccessToken(supplied);
  if (!credential) throw new Error("个人访问令牌无效或已撤销，请在需求平台重新生成并配置。" );
  const employee = await requirePublisherEmployee(credential.openId);
  return { id: employee.openId, name: employee.name, authSource: "personal_access_token" };
}

export function sessionActorFromRequest(request: Request): RequirementActor | undefined {
  if (process.env.AUTH_MODE !== "feishu") return undefined;
  const session = sessionFromRequest(request);
  return session ? { id: session.openId, name: session.name, authSource: "session" } : undefined;
}

export async function actorFromRequest(request: Request): Promise<RequirementActor | undefined> {
  if (process.env.AUTH_MODE !== "feishu") return undefined;
  const tokenActor = await personalAccessTokenActor(request);
  if (tokenActor) return tokenActor;
  const session = sessionFromRequest(request);
  if (!session) throw new Error("请先使用飞书登录。");
  if (session) await requireViewerEmployee(session.openId);
  return session ? { id: session.openId, name: session.name } : undefined;
}

/** Browser writes require a Feishu session with publisher or admin role. */
export async function publisherFromRequest(request: Request): Promise<RequirementActor> {
  const actor = await actorFromRequest(request);
  if (process.env.AUTH_MODE !== "feishu") {
    return { id: "local-dev-user", name: process.env.LOCAL_USER_NAME?.trim() || "本地开发身份", authSource: "local" };
  }
  if (!actor) throw new Error("请先使用飞书登录。");
  await requirePublisherEmployee(actor.id);
  return actor;
}

export async function adminFromRequest(request: Request): Promise<RequirementActor> {
  const actor = await actorFromRequest(request);
  if (process.env.AUTH_MODE !== "feishu") return { id: "local-dev-admin", name: process.env.LOCAL_USER_NAME?.trim() || "本地管理员", authSource: "local" };
  if (!actor) throw new Error("请先使用飞书登录。");
  if (actor.authSource === "personal_access_token") throw new Error("个人访问令牌不能访问管理接口，请使用飞书登录。" );
  await requireAdminEmployee(actor.id);
  return actor;
}

/** Personal access tokens may not manage the platform, but an admin owner may manage their own Workbench integration scope. */
export async function isAdministratorActor(actor: RequirementActor | undefined) {
  if (process.env.AUTH_MODE !== "feishu") return true;
  if (!actor) return false;
  return (await getEmployee(actor.id))?.role === "admin";
}
