import "server-only";

import { findRelevantTestCases, findScopedRequirementKnowledge, type RequirementKnowledgeMatch, type RequirementKnowledgeScope } from "@/services/requirement/repository";
import type { RequirementTestCase } from "@/lib/types";
import { resolveAssistantModel } from "@/services/assistant/model-config";

export type AssistantScope = RequirementKnowledgeScope;
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
};

type AssistantInput = {
  question: string;
  scope: AssistantScope;
  requirementCode?: string;
  projectId?: string;
  versionNo?: number;
};
type ChatCompletionResponse = { choices?: Array<{ message?: { content?: string | null } }> };
type ModelAnswer = { status?: unknown; answer?: unknown; keyPoints?: unknown; flow?: unknown; comparison?: unknown; sourceIds?: unknown; undefinedPoints?: unknown };

const STATUS_LABEL: Record<RequirementAnswerStatus, string> = {
  defined: "PRD 已明确",
  partial: "PRD 仅部分定义",
  undefined: "当前 PRD 未定义",
  conflict: "当前需求存在规则冲突",
};

function textList(value: unknown, max = 8) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, max)
    : [];
}

function sourceFromMatch(match: RequirementKnowledgeMatch): RequirementAnswerSource {
  return { id: match.id, projectId: match.projectId, projectName: match.projectName, requirementCode: match.requirementCode, requirementName: match.title, prdVersion: match.versionNo, section: match.section, excerpt: match.excerpt, historical: match.isHistorical };
}

function cleanModelJson(raw: string): ModelAnswer | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed as ModelAnswer : undefined;
  } catch {
    return undefined;
  }
}

function conflictMatches(matches: RequirementKnowledgeMatch[], question: string) {
  const terms = (question.match(/[\u4e00-\u9fff]{2,}|[a-z0-9_-]+/gi) ?? []).flatMap((item) => {
    if (!/[\u4e00-\u9fff]/.test(item) || item.length < 3) return [item.toLowerCase()];
    return Array.from({ length: item.length - 1 }, (_, index) => item.slice(index, index + 2).toLowerCase());
  });
  const negative = /不能|不得|禁止|不可|不允许|无法/;
  const positive = /可以|允许|可直接|能够|支持/;
  for (let leftIndex = 0; leftIndex < matches.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < matches.length; rightIndex += 1) {
      const left = matches[leftIndex];
      const right = matches[rightIndex];
      if (left.requirementCode === right.requirementCode && left.versionNo === right.versionNo) continue;
      const leftText = left.excerpt.replace(/\s+/g, "");
      const rightText = right.excerpt.replace(/\s+/g, "");
      const opposite = (negative.test(leftText) && positive.test(rightText)) || (positive.test(leftText) && negative.test(rightText));
      const sharedQuestionTerm = terms.some((term) => term.length >= 2 && leftText.toLowerCase().includes(term) && rightText.toLowerCase().includes(term));
      if (opposite && sharedQuestionTerm) return [left, right];
    }
  }
  return [];
}

function systemPrompt() {
  return `你是需求管理平台中的需求智能体。你只能把提供的“正式 PRD 证据”中明确存在的内容作为业务事实。
Project Context 只用于理解和检索，不能作为业务事实。禁止使用常识、训练知识、评论、Demo 或测试用例补充规则。
如果证据没有定义答案，status 必须为 undefined；如果只定义一部分，status 为 partial 并列出 undefinedPoints；不同证据冲突时 status 为 conflict，绝不自行选择。
每个具体业务结论必须通过 sourceIds 引用至少一条证据。历史版本只能解释历史，不能作为当前规则。
只输出一个 JSON 对象：{"status":"defined|partial|undefined","answer":"简洁中文答案","keyPoints":[""],"flow":[""],"comparison":{"columns":[""],"rows":[[""]]},"sourceIds":["证据id"],"undefinedPoints":[""]}。不需要的数组填 []，不要输出 Markdown 或额外文字。`;
}

async function answerWithModel(question: string, matches: RequirementKnowledgeMatch[], projectContext?: string): Promise<ModelAnswer> {
  const { baseUrl, apiKey, model } = await resolveAssistantModel();
  const evidence = matches.map((match) => [
    `证据 ID：${match.id}`,
    `来源：${match.projectName} / ${match.title} / V${match.versionNo}${match.isHistorical ? "（历史版本）" : ""} / ${match.section}`,
    match.excerpt,
  ].join("\n")).join("\n\n---\n\n");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: `查询范围已经由程序限定，不要自行扩大。\n\nProject Context（只用于理解，不是事实）：\n${projectContext ?? "无"}\n\n正式 PRD 证据：\n${evidence}\n\n问题：${question}` },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`AI 服务请求失败：${response.status}`);
  const payload = await response.json() as ChatCompletionResponse;
  const raw = payload.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("AI 服务未返回有效回答。");
  const parsed = cleanModelJson(raw);
  if (!parsed) throw new Error("AI 服务未返回可校验的结构化回答。");
  return parsed;
}

function undefinedAnswer(question: string, input: AssistantInput): RequirementAnswer {
  const target = input.scope === "current-requirement" ? "当前需求的已发布 PRD" : input.scope === "current-project" ? "当前项目的已发布 PRD" : "当前所有已发布 PRD";
  return { status: "undefined", answer: `${target}未定义“${question}”相关规则。`, keyPoints: [], flow: [], sources: [], undefinedPoints: [question], relatedRequirements: [], testCases: [] };
}

function isTestQuestion(question: string) {
  return /测试|用例|验证|覆盖|测过|已通过|失败|阻塞|回归/.test(question);
}

async function relevantTestCases(input: AssistantInput, question: string) {
  if (input.scope !== "current-requirement" || !input.requirementCode || !input.versionNo || !isTestQuestion(question)) return [];
  const cases = await findRelevantTestCases(input.requirementCode, input.versionNo, question);
  return cases.map((item: RequirementTestCase) => ({ id: item.id, title: item.title, status: item.status, priority: item.priority, module: item.module }));
}

export async function askRequirementAssistant(input: AssistantInput): Promise<RequirementAnswer> {
  const question = input.question.trim();
  if (!question || question.length > 2000) throw new Error("提问不能为空且不能超过 2000 字。");
  const testCases = await relevantTestCases(input, question);
  const result = await findScopedRequirementKnowledge({ ...input, query: question, limit: 6 });
  if (!result.matches.length) return { ...undefinedAnswer(question, input), testCases };
  const conflicts = conflictMatches(result.matches, question);
  if (conflicts.length) {
    const sources = conflicts.map(sourceFromMatch);
    return { status: "conflict", answer: `已发现 ${sources[0].requirementName} 与 ${sources[1].requirementName} 对“${question}”存在相反表述，请由产品负责人确认，不应由 AI 自行决定。`, keyPoints: [], flow: [], sources, undefinedPoints: [], relatedRequirements: result.relatedRequirements, testCases };
  }
  const modelAnswer = await answerWithModel(question, result.matches, result.projectContext);
  const status = modelAnswer.status === "defined" || modelAnswer.status === "partial" || modelAnswer.status === "undefined" ? modelAnswer.status : "partial";
  const answer = typeof modelAnswer.answer === "string" ? modelAnswer.answer.trim().slice(0, 4000) : "";
  const sourceMap = new Map(result.matches.map((match) => [match.id, match]));
  const cited = textList(modelAnswer.sourceIds, 6).map((id) => sourceMap.get(id)).filter((match): match is RequirementKnowledgeMatch => Boolean(match));
  if (!answer || (status !== "undefined" && !cited.length)) {
    return { status: "partial", answer: "已找到相关 PRD 片段，但无法生成可校验的结论。请查看下方来源，或换一种更具体的问法。", keyPoints: [], flow: [], sources: result.matches.slice(0, 3).map(sourceFromMatch), undefinedPoints: [question], relatedRequirements: result.relatedRequirements, testCases };
  }
  const comparison = modelAnswer.comparison && typeof modelAnswer.comparison === "object" ? modelAnswer.comparison as { columns?: unknown; rows?: unknown } : undefined;
  const columns = textList(comparison?.columns, 6);
  const rows = Array.isArray(comparison?.rows) ? comparison.rows.filter(Array.isArray).map((row) => textList(row, 6)).filter((row) => row.length === columns.length).slice(0, 8) : [];
  const selectedMatches = cited.length ? cited : result.matches.slice(0, 3);
  const currentMatch = selectedMatches.find((match) => match.requirementCode === input.requirementCode && !match.isHistorical);
  return {
    status,
    answer: answer || `${STATUS_LABEL[status]}。`,
    keyPoints: textList(modelAnswer.keyPoints),
    flow: textList(modelAnswer.flow),
    comparison: columns.length && rows.length ? { columns, rows } : undefined,
    sources: selectedMatches.map(sourceFromMatch),
    undefinedPoints: textList(modelAnswer.undefinedPoints),
    relatedRequirements: result.relatedRequirements,
    demo: currentMatch?.demoEntryUrl ? { available: true, url: currentMatch.demoEntryUrl } : undefined,
    testCases,
  };
}

export function answerStatusLabel(status: RequirementAnswerStatus) {
  return STATUS_LABEL[status];
}
