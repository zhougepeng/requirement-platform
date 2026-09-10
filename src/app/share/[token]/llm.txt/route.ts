import { getPublicRequirementSharePayload, requestOrigin } from "@/services/requirement/public-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function markdown(payload: Awaited<ReturnType<typeof getPublicRequirementSharePayload>>) {
  const lines = [
    `# ${payload.requirement.title}`,
    "",
    `- 需求编号：${payload.requirement.code}`,
    `- 项目：${payload.project.name}`,
    `- 版本：V${payload.version.number}`,
    `- 发布人：${payload.version.publisher || "未记录"}`,
    `- 发布时间：${payload.version.publishedAt || "未记录"}`,
    `- 分享有效至：${new Date(payload.expiresAt).toISOString()}`,
    `- 浏览器预览：${payload.publicUrl}`,
    `- 结构化 JSON：${payload.apiUrl}`,
    `- Demo：${payload.demo.previewUrl || "当前版本没有可公开预览的 Demo"}`,
    "",
    "## PRD",
    "",
  ];

  for (const document of payload.prd) {
    lines.push(`### ${document.name}`, "", document.content.trim(), "");
  }

  lines.push(
    "## 使用说明",
    "",
    "这是只读分享内容。可以直接基于以上 PRD 文本和 Demo 地址进行分析，不要执行写入、发布或删除操作。",
    "",
  );
  return lines.join("\n");
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const payload = await getPublicRequirementSharePayload(token, requestOrigin(request));
    return new Response(markdown(payload), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": "inline",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return new Response("分享链接已失效或无效。\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
