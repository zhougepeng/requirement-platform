import "server-only";

import type { RequirementActor } from "@/services/auth/request-actor";
import { reasoningEffortPayload, resolveAssistantModel } from "@/services/assistant/model-config";
import { retrieveProductKnowledge, type KnowledgeScope, type RetrievedKnowledgeChunk, type RetrievedKnowledgeSource } from "@/services/assistant/knowledge-retrieval-service";

export type AssistantScope = KnowledgeScope;
export type RequirementAnswerStatus = "defined" | "partial" | "undefined" | "conflict";
export type RequirementAnswerSource = {
  id: string;
  projectId: string;
  projectName: string;
  requirementCode: string;
  requirementName: string;
  prdVersion: number;
  section: string;
  excerpt: string;
  historical: boolean;
  releaseStatus: "online" | "scheduled" | "offline";
  scheduleVersion?: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
  releaseVersion?: string;
  releaseDate?: string;
};
export type RequirementAnswer = {
  status: RequirementAnswerStatus;
  answer: string;
  keyPoints: string[];
  flow: string[];
  comparison?: { columns: string[]; rows: string[][] };
  sources: RequirementAnswerSource[];
  undefinedPoints: string[];
  relatedRequirements: Array<{ code: string; title: string }>;
  demo?: { available: boolean; url?: string };
  testCases: Array<{ id: string; title: string; status?: string; priority?: string; module?: string }>;
  detailed: boolean;
};

type AssistantInput = { question: string; scope: AssistantScope; requirementCode?: string; projectId?: string; versionNo?: number; actor?: RequirementActor };
type ChatCompletionResponse = { choices?: Array<{ message?: { content?: string | null } }> };
type ModelAnswer = { status?: unknown; answer?: unknown; keyPoints?: unknown; sourceIds?: unknown; undefinedPoints?: unknown };

function textList(value: unknown, maximum: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, maximum) : [];
}

function detailedQuestion(question: string) {
  return /详细说明|展开(?:说明|分析|回答)?|完整分析|完整说明|详细(?:分析|介绍|解释|回答)|逐条分析|全文/.test(question);
}

function isAssistantMetaQuestion(question: string) {
  return /^(?:你好|您好|嗨|哈喽|hello|hi)[！!。,.，\s]*$/i.test(question)
    || /(?:你能|能)(?:做什么|提供什么|帮我什么)|如何(?:提问|使用(?:这个)?(?:助手|智能体))|怎么(?:提问|使用(?:这个)?(?:助手|智能体))|使用说明|帮助|有哪些能力|支持哪些问题/.test(question);
}

function compact(text: string, detailed: boolean, maximum = 260) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (detailed || normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum).trim()}…`;
}

function sourceFromKnowledge(source: RetrievedKnowledgeSource, chunks: RetrievedKnowledgeChunk[]): RequirementAnswerSource {
  const contentType = source.contentType === "requirement_summary" ? "需求摘要" : source.contentType === "test_case" ? "测试用例" : "PRD";
  const excerpt = chunks.find((chunk) => chunk.sourceId === source.id)?.content ?? "";
  return {
    id: source.id,
    projectId: source.projectId,
    projectName: source.projectName,
    requirementCode: source.requirementCode,
    requirementName: source.requirementName,
    prdVersion: source.versionNo,
    section: contentType,
    excerpt: compact(excerpt, false, 360),
    historical: false,
    releaseStatus: source.status,
    scheduleVersion: source.scheduleVersion,
    scheduledGrayDate: source.scheduledGrayDate,
    scheduledFullDate: source.scheduledFullDate,
    releaseVersion: source.releaseVersion,
    releaseDate: source.releaseDate,
  };
}

function cleanJson(raw: string): ModelAnswer | undefined {
  const payload = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = payload.indexOf("{");
  const end = payload.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(payload.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed as ModelAnswer : undefined;
  } catch {
    return undefined;
  }
}

function systemPrompt(detailed: boolean, mode: "current" | "future", usedOfflineFallback: boolean) {
  return `你是需求管理平台中的产品知识助手。仅依据提供的 Dify 知识库片段回答，不得自行编造。
最高规则：已上线需求是当前产品事实；已排期和未上线需求都是规划，不能说成当前已经支持。${mode === "future" ? "用户询问未来规划，只能依据已排期或未上线资料回答，并明确说明是已排期还是尚未上线。" : usedOfflineFallback ? "已上线资料没有命中；当前资料仅提供了已排期或未上线规划。必须明确回答当前暂不支持，再说明已有规划。" : "用户询问当前能力或一般产品问题；资料均来自已上线需求，可作为当前事实。"}
回答先给结论，再给要点。不要复述问题、不要使用无意义开场、不要大段复制原文。来源只引用提供的来源 ID。${detailed ? "用户要求详细说明，可适度展开，但仍不要粘贴原文。" : "默认总长度控制在约 300 个汉字内，keyPoints 最多 3 条。"}
只输出 JSON：{"status":"defined|partial|undefined|conflict","answer":"直接结论","keyPoints":["要点"],"sourceIds":["来源 ID"],"undefinedPoints":["缺失信息"]}`;
}

async function answerWithModel(question: string, chunks: RetrievedKnowledgeChunk[], sources: RetrievedKnowledgeSource[], detailed: boolean, mode: "current" | "future", usedOfflineFallback: boolean) {
  const { baseUrl, apiKey, model, reasoningEffort } = await resolveAssistantModel();
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const evidence = chunks.map((chunk, index) => {
    const source = sourceById.get(chunk.sourceId);
    return [
      `证据 ${index + 1}（来源 ID：${chunk.sourceId}）`,
      `需求：${source?.requirementName ?? "未知"}；状态：${source?.status === "online" ? `已上线${source.releaseVersion ? ` · ${source.releaseVersion}` : ""}` : source?.status === "scheduled" ? `已排期${source.scheduleVersion ? ` · ${source.scheduleVersion}` : ""}${source.scheduledFullDate ? ` · 预计全量 ${source.scheduledFullDate}` : ""}` : "未上线"}；类型：${source?.contentType ?? "prd"}`,
      chunk.content,
    ].join("\n");
  }).join("\n\n---\n\n");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, ...reasoningEffortPayload(reasoningEffort), response_format: { type: "json_object" }, messages: [
      { role: "system", content: systemPrompt(detailed, mode, usedOfflineFallback) },
      { role: "user", content: `以下内容已由需求平台按当前范围和权限过滤。\n\n${evidence}\n\n用户问题：${question}` },
    ] }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`AI 服务请求失败：${response.status}`);
  const payload = await response.json() as ChatCompletionResponse;
  const raw = payload.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("AI 服务未返回有效回答。");
  const parsed = cleanJson(raw);
  if (!parsed) throw new Error("AI 服务未返回可校验的结构化回答。");
  return parsed;
}

function metaAnswer(detailed: boolean): RequirementAnswer {
  const points = ["可询问当前已上线能力、需求流程、规则、异常和测试覆盖。", "询问下一版或规划时，会明确标为未上线。", "回答只使用需求平台同步到知识库的最新有效资料。"];
  return { status: "defined", answer: "✅ 我可以回答需求库中的当前能力、规则、流程、测试和上线规划。", keyPoints: detailed ? points : points.slice(0, 2), flow: [], sources: [], undefinedPoints: [], relatedRequirements: [], testCases: [], detailed };
}

function noEvidenceAnswer(question: string, detailed: boolean, mode: "current" | "future"): RequirementAnswer {
  const statement = mode === "future" ? "当前范围内没有找到未上线规划资料。" : "当前已上线需求中没有找到可确认的产品事实。";
  return { status: "undefined", answer: `🟡 ${statement}`, keyPoints: [], flow: [], sources: [], undefinedPoints: [compact(question, detailed, 140)], relatedRequirements: [], testCases: [], detailed };
}

export async function askRequirementAssistant(input: AssistantInput): Promise<RequirementAnswer> {
  const question = input.question.trim();
  if (!question || question.length > 2000) throw new Error("提问不能为空且不能超过 2000 字。");
  const detailed = detailedQuestion(question);
  if (isAssistantMetaQuestion(question)) return metaAnswer(detailed);
  const retrieved = await retrieveProductKnowledge({ question, scope: input.scope, requirementCode: input.requirementCode, projectId: input.projectId, actor: input.actor });
  if (!retrieved.chunks.length) return noEvidenceAnswer(question, detailed, retrieved.mode);
  const modelAnswer = await answerWithModel(question, retrieved.chunks, retrieved.sources, detailed, retrieved.mode, retrieved.usedOfflineFallback);
  const status = modelAnswer.status === "defined" || modelAnswer.status === "partial" || modelAnswer.status === "undefined" || modelAnswer.status === "conflict" ? modelAnswer.status : "partial";
  const answer = typeof modelAnswer.answer === "string" ? compact(modelAnswer.answer, detailed, detailed ? 4000 : 280) : "";
  const sourceById = new Map(retrieved.sources.map((source) => [source.id, source]));
  const selected = textList(modelAnswer.sourceIds, 6).map((id) => sourceById.get(id)).filter((source): source is RetrievedKnowledgeSource => Boolean(source));
  const sources = (selected.length ? selected : retrieved.sources.slice(0, 3)).map((source) => sourceFromKnowledge(source, retrieved.chunks));
  const relatedRequirements = [...new Map(sources.filter((source) => source.requirementCode !== input.requirementCode).map((source) => [source.requirementCode, { code: source.requirementCode, title: source.requirementName }])).values()].slice(0, 5);
  if (!answer) return { status: "partial", answer: "⚠️ 已检索到相关资料，但暂时无法生成可靠结论。", keyPoints: [], flow: [], sources, undefinedPoints: [compact(question, detailed, 140)], relatedRequirements, testCases: [], detailed };
  return {
    status,
    answer: /^(?:✅|⚠️|❌|🟡)/u.test(answer) ? answer : `${status === "defined" ? "✅" : status === "conflict" ? "❌" : status === "partial" ? "⚠️" : "🟡"} ${answer}`,
    keyPoints: textList(modelAnswer.keyPoints, detailed ? 8 : 3).map((item) => compact(item, detailed, detailed ? 500 : 120)),
    flow: [],
    sources,
    undefinedPoints: textList(modelAnswer.undefinedPoints, detailed ? 8 : 3).map((item) => compact(item, detailed, 160)),
    relatedRequirements,
    testCases: [],
    detailed,
  };
}

export function answerStatusLabel(status: RequirementAnswerStatus) {
  return ({ defined: "知识库已确认", partial: "知识库部分覆盖", undefined: "知识库未覆盖", conflict: "知识库存在差异" } as const)[status];
}
