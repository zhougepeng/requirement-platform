import { apiError } from "@/lib/api-response";
import { actorFromRequest } from "@/services/auth/request-actor";
import { downloadRequirementDocument } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(name: string) {
  const fallback = name.replace(/[^A-Za-z0-9._-]/g, "_") || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requirementCode: string; versionNo: string }> },
) {
  try {
    await actorFromRequest(request);
    const { requirementCode, versionNo } = await params;
    const query = new URL(request.url).searchParams;
    const kind = query.get("kind");
    if (kind !== "prd" && kind !== "demo") throw new Error("下载类型不合法。");
    const result = await downloadRequirementDocument(
      requirementCode,
      Number(versionNo),
      kind,
      query.get("path") || undefined,
    );
    return new Response(new Uint8Array(result.body), {
      headers: {
        "Content-Type": result.mimeType,
        "Content-Disposition": contentDisposition(result.name),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
