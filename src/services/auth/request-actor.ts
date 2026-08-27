import "server-only";

import { decodeSession, SESSION_COOKIE } from "@/services/auth/session";
import { requireAdminEmployee, requirePublisherEmployee, requireViewerEmployee } from "@/services/auth/employee-store";

export type RequirementActor = { id: string; name: string };

function sessionFromRequest(request: Request) {
  const value = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`))?.[1];
  return decodeSession(value);
}

export function sessionActorFromRequest(request: Request): RequirementActor | undefined {
  if (process.env.AUTH_MODE !== "feishu") return undefined;
  const session = sessionFromRequest(request);
  return session ? { id: session.openId, name: session.name } : undefined;
}

export async function actorFromRequest(request: Request): Promise<RequirementActor | undefined> {
  if (process.env.AUTH_MODE !== "feishu") return undefined;
  const session = sessionFromRequest(request);
  if (!session) throw new Error("请先使用飞书登录。");
  if (session) await requireViewerEmployee(session.openId);
  return session ? { id: session.openId, name: session.name } : undefined;
}

/** Browser writes require a Feishu session with publisher or admin role. */
export async function publisherFromRequest(request: Request): Promise<RequirementActor> {
  const actor = await actorFromRequest(request);
  if (process.env.AUTH_MODE !== "feishu") {
    return { id: "local-dev-user", name: process.env.LOCAL_USER_NAME?.trim() || "本地开发身份" };
  }
  if (!actor) throw new Error("请先使用飞书登录。");
  await requirePublisherEmployee(actor.id);
  return actor;
}

export async function adminFromRequest(request: Request): Promise<RequirementActor> {
  const actor = await actorFromRequest(request);
  if (process.env.AUTH_MODE !== "feishu") return { id: "local-dev-admin", name: process.env.LOCAL_USER_NAME?.trim() || "本地管理员" };
  if (!actor) throw new Error("请先使用飞书登录。");
  await requireAdminEmployee(actor.id);
  return actor;
}
