import "server-only";

import { findRelevantTestCases, findScopedRequirementKnowledge, listScopedRequirementReleaseFacts, type RequirementKnowledgeMatch, type RequirementKnowledgeScope, type RequirementReleaseFact } from "@/services/requirement/repository";
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
  releaseStatus: "online" | "offline";
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
  return { id: match.id, projectId: match.projectId, projectName: match.projectName, requirementCode: match.requirementCode, requirementName: match.title, prdVersion: match.versionNo, section: match.section, excerpt: match.excerpt, historical: match.isHistorical, releaseStatus: match.releaseStatus, releaseVersion: match.releaseVersion, releaseDate: match.releaseDate };
}

function sourceFromReleaseFact(fact: RequirementReleaseFact): RequirementAnswerSource {
  const statusText = fact.status === "online"
    ? `已上线${fact.releaseVersion ? ` · ${fact.releaseVersion}` : ""}${fact.releaseDate ? ` · ${fact.releaseDate}` : ""}`
    : "未上线（规划中）";
  return {
    id: `${fact.requirementCode}:status`,
    projectId: fact.projectId,
    projectName: fact.projectName,
    requirementCode: fact.requirementCode,
    requirementName: fact.requirementName,
    prdVersion: fact.versionNo,
    section: "需求状态",
    excerpt: statusText,
    historical: false,
    releaseStatus: fact.status,
    releaseVersion: fact.releaseVersion,
    releaseDate: fact.releaseDate,
  };
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

function detailedQuestion(question: string) {
  return /详细说明|展开(?:说明|分析|回答)?|完整分析|完整说明|详细(?:分析|介绍|解释|回答)|逐条分析|全文/.test(question);
}

function isFutureQuestion(question: string) {
  return /后面|未来|规划|下一版|下个版本|准备做|待做|尚未上线|未上线(?:的)?(?:需求|功能)?|还没有上线/.test(question);
}

function isCurrentCapabilityQuestion(question: string) {
  return /现在支持什么|当前有什么功能|目前能不能做|系统现在是否支持|线上是什么逻辑|当前(?:系统|产品|线上)|目前(?:系统|产品|线上)|现在(?:能不能|是否|有没有|支持)/.test(question);
}

function isReleaseStatusQuestion(question: string) {
  return /(?:未上线|没上线|尚未上线|最近上线|上线了哪些|哪些需求.*上线|上线需求|上线版本|版本.*上线)/.test(question);
}

/** Questions about the assistant itself should not be treated as missing PRD rules. */
function isAssistantMetaQuestion(question: string) {
  return /^(?:你好|您好|嗨|哈喽|hello|hi)[！!。,.，\s]*$/i.test(question)
    || /(?:你能|能)(?:做什么|提供什么|帮我什么)|如何(?:提问|使用(?:这个)?(?:助手|智能体))|怎么(?:提问|使用(?:这个)?(?:助手|智能体))|使用说明|帮助|有哪些能力|支持哪些问题/.test(question);
}

function assistantMetaAnswer(detailed: boolean): RequirementAnswer {
  const keyPoints = [
    "可询问需求流程、规则、字段、异常和版本差异。",
    "回答只引用需求库已发布 PRD；没有依据时会明确标注未定义。",
    "可以直接描述需求名称或业务问题，要求“详细说明”可展开回答。",
  ];
  return {
    status: "defined",
    answer: "✅ 我可以基于需求库中的已发布 PRD，回答需求流程、规则、字段、异常和版本差异。",
    keyPoints: detailed ? keyPoints : keyPoints.slice(0, 2),
    flow: [],
    sources: [],
    undefinedPoints: [],
    relatedRequirements: [],
    testCases: [],
    detailed,
  };
}

function answerMarker(status: RequirementAnswerStatus) {
  if (status === "defined") return "✅";
  if (status === "partial") return "⚠️";
  if (status === "conflict") return "❌";
  return "🟡";
}

function compactAnswer(value: string, status: RequirementAnswerStatus, detailed: boolean) {
  const text = value.replace(/^(?:✅|⚠️|❌|🟡)\s*/u, "").trim();
  const limit = detailed ? 4000 : 180;
  const clipped = text.slice(0, limit).trim();
  return `${answerMarker(status)} ${clipped || STATUS_LABEL[status]}${!detailed && text.length > limit ? "…" : ""}`;
}

function compactKeyPoints(value: unknown, answerLength: number, detailed: boolean) {
  const points = textList(value, detailed ? 8 : 3);
  if (detailed) return points.map((item) => item.slice(0, 500));
  const budget = Math.max(0, 286 - answerLength);
  const perPoint = points.length ? Math.max(1, Math.floor(budget / points.length)) : 0;
  return points.map((item) => item.slice(0, perPoint)).filter(Boolean);
}

function isEvidenceSynthesisQuestion(question: string) {
  return /如何|怎么|流程|步骤|主要|概述|总结|介绍|是什么|做什么/.test(question);
}

function fallbackFromEvidence(question: string, matches: RequirementKnowledgeMatch[], detailed: boolean, relatedRequirements: RequirementAnswer["relatedRequirements"], testCases: RequirementAnswer["testCases"]): RequirementAnswer | undefined {
  if (!isEvidenceSynthesisQuestion(question) || !matches.length) return undefined;
  const lines = Array.from(new Set(matches
    .flatMap((match) => match.excerpt.replace(/```[\s\S]*?```/g, "").split("\n"))
    .map((line) => line.replace(/^\s*(?:#{1,6}|[-*]|\d+[.、])\s*/, "").replace(/\|/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 8 && !/^:?-{2,}:?$/.test(line))))
    .slice(0, detailed ? 8 : 4);
  if (!lines.length) return undefined;
  const answer = lines.slice(0, detailed ? 3 : 2).join("；");
  return {
    status: "defined",
    answer: compactAnswer(answer, "defined", detailed),
    keyPoints: lines.slice(0, detailed ? 8 : 3),
    flow: [],
    sources: matches.slice(0, 3).map(sourceFromMatch),
    undefinedPoints: [],
    relatedRequirements,
    testCases,
    detailed,
  };
}

function modelDeclinedDespiteEvidence(status: RequirementAnswerStatus, answer: string) {
  if (status === "undefined") return true;
  if (!answer) return true;
  return /未定义|无法回答|没有找到(?:相关|明确)?(?:规则|答案|内容)|无法确定|不确定/.test(answer);
}

function systemPrompt(detailed: boolean, answerMode: "current" | "future" | "mixed") {
  return `你是需求管理平台中的需求智能体。你只能把提供的“正式 PRD 证据”中明确存在的内容作为业务事实。
Project Context 只用于理解和检索，不能作为业务事实。禁止使用常识、训练知识、评论、Demo 或测试用例补充规则。
如果证据没有定义答案，status 必须为 undefined；如果只定义一部分，status 为 partial 并列出 undefinedPoints；不同证据冲突时 status 为 conflict，绝不自行选择。
每个具体业务结论必须通过 sourceIds 引用至少一条证据。历史版本只能解释历史，不能作为当前规则。
需求状态规则：已上线需求是当前产品事实；未上线需求只是规划，不能描述为当前已支持。Demo 可用性和测试用例只用于说明演示或验证覆盖情况，不能替代 PRD 规则。${answerMode === "current" ? "本次问题在询问当前能力，你收到的证据均为已上线需求；若没有证据，不得用未上线内容补充为当前能力。" : answerMode === "future" ? "本次问题在询问未来规划或未上线内容。你可以引用未上线需求，但必须明确写出“尚未上线 / 规划中 / 当前暂不支持”。" : "本次问题可能同时涉及当前事实和未来规划。回答时必须先说明已上线事实，再单独说明未上线规划，并明确两者区别。"}
回答格式必须是“结论 → 要点 → 来源”。answer 的第一句直接回答问题，不要复述问题，不要用“根据 PRD”“从资料来看”等开场。对“总结、概述、如何、流程、主要步骤”类问题，只要多个证据可以共同支撑结论，就应归纳回答，不要因为不是逐字匹配而判定未定义。只有正式 PRD 没有涉及，或证据只有标题而没有可验证正文时，才使用 undefined。仍不得补充 PRD 外的事实。${detailed ? "用户明确要求展开，可完整说明，但仍不可粘贴 PRD、Demo 或测试用例原文。" : "默认简短回答：answer 加 keyPoints 总计控制在 200 到 300 个汉字内；keyPoints 最多 3 项，每项一行；不要输出大段原文、流程全文或表格。"}
只输出一个 JSON 对象：{"status":"defined|partial|undefined|conflict","answer":"直接结论","keyPoints":[""],"flow":[""],"comparison":{"columns":[""],"rows":[[""]]},"sourceIds":["证据id"],"undefinedPoints":[""]}。不需要的数组填 []，不要输出 Markdown 或额外文字。`;
}

async function answerWithModel(question: string, matches: RequirementKnowledgeMatch[], projectContext?: string, detailed = false, answerMode: "current" | "future" | "mixed" = "current"): Promise<ModelAnswer> {
  const { baseUrl, apiKey, model } = await resolveAssistantModel();
  const evidence = matches.map((match) => [
    `证据 ID：${match.id}`,
    `来源：${match.projectName} / ${match.title} / ${match.releaseStatus === "online" ? `已上线${match.releaseVersion ? ` ${match.releaseVersion}` : ""}${match.releaseDate ? ` ${match.releaseDate}` : ""}` : "未上线（规划中）"} / V${match.versionNo}${match.isHistorical ? "（历史版本）" : ""} / ${match.section}`,
    `Demo：${match.demoEntryUrl ? "已提供" : "未提供"}`,
    `测试用例：${match.testCases.length ? match.testCases.map((item) => `${item.title}（${item.status}）`).join("；") : "当前版本暂无测试用例"}`,
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
        { role: "system", content: systemPrompt(detailed, answerMode) },
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

function releaseFactsAnswer(question: string, facts: RequirementReleaseFact[], detailed: boolean): RequirementAnswer | undefined {
  if (!isReleaseStatusQuestion(question)) return undefined;
  const version = /\bV?\d+(?:\.\d+)+(?:[-_a-z0-9]+)?\b/i.exec(question)?.[0];
  const wantsOffline = /未上线|没上线|尚未上线|还没有上线/.test(question);
  const candidates = wantsOffline
    ? facts.filter((item) => item.status === "offline")
    : version
      ? facts.filter((item) => item.status === "online" && item.releaseVersion?.toLowerCase() === version.toLowerCase())
      : facts.filter((item) => item.status === "online");
  const label = wantsOffline ? "未上线" : version ? `${version} 已上线` : "最近已上线";
  if (!candidates.length) return {
    status: "undefined",
    answer: compactAnswer(`当前范围内没有${label}的需求。`, "undefined", detailed),
    keyPoints: [], flow: [], sources: [], undefinedPoints: [], relatedRequirements: [], testCases: [], detailed,
  };
  const listed = candidates.slice(0, detailed ? 20 : 6);
  const suffix = candidates.length > listed.length ? `，另有 ${candidates.length - listed.length} 个` : "";
  return {
    status: "defined",
    answer: compactAnswer(`${label}的需求共有 ${candidates.length} 个：${listed.map((item) => `《${item.requirementName}》`).join("、")}${suffix}。`, "defined", detailed),
    keyPoints: listed.map((item) => item.status === "online"
      ? `${item.requirementName} · 已上线${item.releaseVersion ? ` · ${item.releaseVersion}` : ""}${item.releaseDate ? ` · ${item.releaseDate}` : ""}`
      : `${item.requirementName} · 未上线 · 规划中`),
    flow: [],
    sources: listed.map(sourceFromReleaseFact),
    undefinedPoints: [],
    relatedRequirements: [],
    testCases: [],
    detailed,
  };
}

function offlinePlanningAnswer(question: string, input: AssistantInput, matches: RequirementKnowledgeMatch[], detailed: boolean, testCases: RequirementAnswer["testCases"]): RequirementAnswer {
  return {
    status: "undefined",
    answer: compactAnswer("当前已上线需求中没有找到该能力；但未上线需求中已有相关规划，当前暂不支持。", "undefined", detailed),
    keyPoints: matches.slice(0, 3).map((match) => `${match.title} · 未上线 · 规划中`),
    flow: [],
    sources: matches.slice(0, 3).map(sourceFromMatch),
    undefinedPoints: [question.slice(0, detailed ? 500 : 110)],
    relatedRequirements: [],
    testCases,
    detailed,
  };
}

function undefinedAnswer(question: string, input: AssistantInput, detailed: boolean): RequirementAnswer {
  const target = input.scope === "current-requirement" ? "当前需求的已发布 PRD" : input.scope === "current-project" ? "当前项目的已发布 PRD" : "当前所有已发布 PRD";
  return { status: "undefined", answer: compactAnswer(`${target}未定义相关规则。`, "undefined", detailed), keyPoints: [], flow: [], sources: [], undefinedPoints: [question.slice(0, detailed ? 500 : 110)], relatedRequirements: [], testCases: [], detailed };
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
  const detailed = detailedQuestion(question);
  if (isAssistantMetaQuestion(question)) return assistantMetaAnswer(detailed);
  const testCases = await relevantTestCases(input, question);
  const [facts, result] = await Promise.all([
    listScopedRequirementReleaseFacts(input),
    findScopedRequirementKnowledge({ ...input, query: question, limit: 8 }),
  ]);
  const statusAnswer = releaseFactsAnswer(question, facts, detailed);
  if (statusAnswer) return statusAnswer;
  const future = isFutureQuestion(question);
  const current = isCurrentCapabilityQuestion(question);
  const onlineMatches = result.matches.filter((match) => match.releaseStatus === "online");
  const offlineMatches = result.matches.filter((match) => match.releaseStatus === "offline");
  const matches = future ? result.matches : onlineMatches;
  if (!matches.length) {
    if (current && offlineMatches.length) return offlinePlanningAnswer(question, input, offlineMatches, detailed, testCases);
    return { ...undefinedAnswer(question, input, detailed), testCases };
  }
  const conflicts = conflictMatches(matches, question);
  if (conflicts.length) {
    const sources = conflicts.map(sourceFromMatch);
    return { status: "conflict", answer: compactAnswer(`${sources[0].requirementName} 与 ${sources[1].requirementName} 对该规则存在相反表述，需产品负责人确认。`, "conflict", detailed), keyPoints: [], flow: [], sources, undefinedPoints: [], relatedRequirements: result.relatedRequirements, testCases, detailed };
  }
  const answerMode = future && onlineMatches.length && offlineMatches.length ? "mixed" : future ? "future" : "current";
  const modelAnswer = await answerWithModel(question, matches, result.projectContext, detailed, answerMode);
  const status = modelAnswer.status === "defined" || modelAnswer.status === "partial" || modelAnswer.status === "undefined" || modelAnswer.status === "conflict" ? modelAnswer.status : "partial";
  const answer = typeof modelAnswer.answer === "string" ? modelAnswer.answer.trim().slice(0, 4000) : "";
  const sourceMap = new Map(matches.map((match) => [match.id, match]));
  const cited = textList(modelAnswer.sourceIds, 6).map((id) => sourceMap.get(id)).filter((match): match is RequirementKnowledgeMatch => Boolean(match));
   if (modelDeclinedDespiteEvidence(status, answer)) {
     const evidenceAnswer = fallbackFromEvidence(question, cited.length ? cited : matches, detailed, result.relatedRequirements, testCases);
     if (evidenceAnswer) return evidenceAnswer;
   }
  if (!answer || (status !== "undefined" && !cited.length)) {
    return { status: "partial", answer: compactAnswer("已找到相关内容，但无法形成可校验结论。请换一种更具体的问法。", "partial", detailed), keyPoints: [], flow: [], sources: matches.slice(0, 3).map(sourceFromMatch), undefinedPoints: [question], relatedRequirements: result.relatedRequirements, testCases, detailed };
  }
  const comparison = modelAnswer.comparison && typeof modelAnswer.comparison === "object" ? modelAnswer.comparison as { columns?: unknown; rows?: unknown } : undefined;
  const columns = textList(comparison?.columns, 6);
  const rows = Array.isArray(comparison?.rows) ? comparison.rows.filter(Array.isArray).map((row) => textList(row, 6)).filter((row) => row.length === columns.length).slice(0, 8) : [];
  const selectedMatches = cited.length ? cited : result.matches.slice(0, 3);
  const currentMatch = selectedMatches.find((match) => match.requirementCode === input.requirementCode && !match.isHistorical);
  return {
    status,
    answer: compactAnswer(answer, status, detailed),
    keyPoints: compactKeyPoints(modelAnswer.keyPoints, compactAnswer(answer, status, detailed).length, detailed),
    flow: detailed ? textList(modelAnswer.flow) : [],
    comparison: detailed && columns.length && rows.length ? { columns, rows } : undefined,
    sources: selectedMatches.map(sourceFromMatch),
    undefinedPoints: textList(modelAnswer.undefinedPoints, detailed ? 8 : 3).map((item) => item.slice(0, detailed ? 500 : 110)),
    relatedRequirements: result.relatedRequirements,
    demo: currentMatch?.demoEntryUrl ? { available: true, url: currentMatch.demoEntryUrl } : undefined,
    testCases,
    detailed,
  };
}

export function answerStatusLabel(status: RequirementAnswerStatus) {
  return STATUS_LABEL[status];
}
