import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { uploadArtifact } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await publisherFromRequest(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("请以 file 字段上传 demo.zip。");
    return apiJson(await uploadArtifact(file), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
