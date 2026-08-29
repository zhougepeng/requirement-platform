import "server-only";

import { listVersionTestCases, getTestCaseGenerationContext } from "@/services/requirement/repository";
import { reasoningEffortPayload, resolveAssistantModel } from "@/services/assistant/model-config";

type ModelContent = string | Array<{ text?: string }> | null | undefined;
type ModelResponse = { choices?: Array<{ message?: { content?: ModelContent } }> };

function textFromResponse(payload: ModelResponse) {
  const value = payload.choices?.[0]?.message?.content;
  if (typeof value === "string") return value.trim();
  return Array.isArray(value) ? value.map((part) => part.text ?? "").join("").trim() : "";
}

type NotificationDraftInput = {
  kind?: "online" | "scheduled";
  releaseVersion?: string;
  releaseDate?: string;
  scheduleVersion?: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
};

function fallback(context: Awaited<ReturnType<typeof getTestCaseGenerationContext>>, input: NotificationDraftInput) {
  const scheduled = input.kind === "scheduled";
  return [
    `${scheduled ? "📅 需求已排期" : "🚀 新功能上线"}｜${context.requirementTitle}`,
    "",
    scheduled ? `排期版本：${input.scheduleVersion}` : `版本：${input.releaseVersion}`,
    scheduled ? `预计灰度时间：${input.scheduledGrayDate}` : `上线时间：${input.releaseDate}`,
    ...(scheduled ? [`预计全量时间：${input.scheduledFullDate}`] : []),
    "",
    "本次上线",
    context.changeSummary || "请查看需求说明。",
    "",
    "查看需求：",
    `${process.env.APP_BASE_URL?.replace(/\/$/, "") ?? ""}/requirements/${encodeURIComponent(context.requirementCode)}`,
  ].join("\n");
}

export async function buildReleaseNotificationDraft(requirementCode: string, versionNo: number, input: NotificationDraftInput) {
  const context = await getTestCaseGenerationContext(requirementCode, versionNo);
  const testCases = await listVersionTestCases(requirementCode, versionNo);
  const defaultContent = fallback(context, input);
  const scheduled = input.kind === "scheduled";
  try {
    const { baseUrl, apiKey, model, reasoningEffort } = await resolveAssistantModel();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...reasoningEffortPayload(reasoningEffort),
        messages: [
          { role: "system", content: scheduled ? "你是公司内部需求排期通知助手。只能依据给出的当前需求资料写通知，禁止补充不存在的能力、客户或效果。内容必须简洁，使用固定结构：📅 需求已排期｜名称；排期版本；预计灰度时间；预计全量时间；面向客户；解决问题；本次计划；带来的价值；查看需求。没有依据的段落可省略。只输出可直接发送的中文正文，不要解释。" : "你是公司内部上线公告助手。只能依据给出的当前需求资料写通知，禁止补充不存在的能力、客户或效果。内容必须简洁，使用固定结构：🚀 新功能上线｜名称；版本；上线时间；面向客户；解决问题；本次上线；带来的价值；查看需求。没有依据的段落可省略。只输出可直接发送的中文正文，不要解释。" },
          { role: "user", content: `项目：${context.projectName}\n需求：${context.requirementTitle}\n${scheduled ? `排期版本：${input.scheduleVersion}\n预计灰度时间：${input.scheduledGrayDate}\n预计全量时间：${input.scheduledFullDate}` : `版本：${input.releaseVersion}\n上线时间：${input.releaseDate}`}\n需求说明：${context.changeSummary}\n\nPRD：\n${context.prd.slice(0, 14_000)}\n\nDemo 摘要：\n${context.demoSummary}\n\n测试用例摘要：\n${testCases.slice(0, 12).map((item) => `${item.priority}｜${item.title}`).join("\n") || "暂无"}\n\n查看需求：${process.env.APP_BASE_URL?.replace(/\/$/, "") ?? ""}/requirements/${encodeURIComponent(context.requirementCode)}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI 服务请求失败（HTTP ${response.status}）。`);
    const payload = await response.json() as ModelResponse;
    const content = textFromResponse(payload);
    if (!content) throw new Error("AI 未返回可用通知内容。");
    return { content: content.slice(0, 5000) };
  } catch (error) {
    return { content: defaultContent, generationError: error instanceof Error ? `AI 文案生成失败，已带入基础通知：${error.message}` : "AI 文案生成失败，已带入基础通知。" };
  }
}
