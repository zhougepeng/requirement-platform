import { apiError, apiJson } from "@/lib/api-response";
import { actorFromRequest, publisherFromRequest } from "@/services/auth/request-actor";
import { listProductSpecSnapshots, restoreProductSpecSnapshot } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    await actorFromRequest(request);
    return apiJson(await listProductSpecSnapshots((await params).productId, "product"));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const actor = await publisherFromRequest(request);
    const body = await request.json() as { snapshotId?: unknown };
    if (typeof body.snapshotId !== "string" || !body.snapshotId.trim()) throw new Error("快照编号必填。");
    const snapshots = await listProductSpecSnapshots((await params).productId, "product");
    const snapshot = snapshots.find((item) => item.snapshotId === body.snapshotId);
    if (!snapshot) throw new Error("规范快照不存在。");
    return apiJson(await restoreProductSpecSnapshot(snapshot.snapshotId, actor));
  } catch (error) { return apiError(error); }
}
