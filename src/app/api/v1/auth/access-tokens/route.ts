import { z } from "zod";
import { apiError, apiJson } from "@/lib/api-response";
import { requirePublisherEmployee } from "@/services/auth/employee-store";
import { sessionActorFromRequest } from "@/services/auth/request-actor";
import { createPersonalAccessToken, listPersonalAccessTokens, revokePersonalAccessTokens } from "@/services/auth/personal-access-token-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ label: z.string().trim().max(80).optional() });

async function sessionPublisher(request: Request) {
  if (process.env.AUTH_MODE !== "feishu") return { id: "local-dev-user" };
  const actor = sessionActorFromRequest(request);
  if (!actor) throw new Error("请先使用飞书登录。" );
  await requirePublisherEmployee(actor.id);
  return actor;
}

export async function GET(request: Request) {
  try {
    const actor = await sessionPublisher(request);
    return apiJson(await listPersonalAccessTokens(actor.id));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await sessionPublisher(request);
    const body = createSchema.parse(await request.json());
    return apiJson(await createPersonalAccessToken(actor.id, body.label), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await sessionPublisher(request);
    return apiJson(await revokePersonalAccessTokens(actor.id));
  } catch (error) {
    return apiError(error);
  }
}
