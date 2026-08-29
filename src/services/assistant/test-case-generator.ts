import "server-only";

import { getTestCaseGenerationContext, replaceVersionTestCases } from "@/services/requirement/repository";
import { scheduleRequirementKnowledgeSync } from "@/services/assistant/knowledge-sync-service";
import { reasoningEffortPayload, resolveAssistantModel } from "@/services/assistant/model-config";
import type { RequirementTestCase } from "@/lib/types";

type ModelContentPart = { type?: string; text?: string };
type ModelResponse = { choices?: Array<{ message?: { content?: string | ModelContentPart[] | null } }> };
type Generated = Record<string, unknown>;

class TestCaseGenerationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function logGeneration(requestId: string, stage: string, startedAt: number, details: Record<string, number | string | boolean> = {}) {
  console.info("[test-case-generator]", JSON.stringify({ requestId, stage, elapsedMs: Date.now() - startedAt, ...details }));
}

function record(value: unknown): Generated | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Generated : undefined;
}

function pick(value: Generated, keys: string[]) {
  return keys.map((key) => value[key]).find((candidate) => candidate !== undefined && candidate !== null);
}

function text(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown, max = 20) {
  if (typeof value === "string") return value.split(/[\n；;]+/).map((item) => item.replace(/^\s*\d+[.、)）]\s*/, "").trim()).filter(Boolean).slice(0, max);
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item : text(record(item) ? pick(record(item)!, ["text", "content", "description", "描述"]) : undefined)).map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function steps(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : [];
  return values.flatMap((item, index) => {
    const itemRecord = record(item);
    const action = typeof item === "string"
      ? item.replace(/^\s*\d+[.、)）]\s*/, "").trim()
      : text(itemRecord ? pick(itemRecord, ["action", "description", "content", "step", "操作", "步骤", "动作"]) : undefined);
    return action ? [{ step: index + 1, action: action.slice(0, 300) }] : [];
  }).slice(0, 20);
}

function parse(raw: string): Generated[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw.trim();
  let payload: unknown;
  try {
    payload = JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[\[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start < 0 || end < start) throw new Error("AI 返回内容不是有效 JSON。");
    payload = JSON.parse(candidate.slice(start, end + 1));
  }
  if (Array.isArray(payload)) return payload.flatMap((item) => record(item) ? [item] : []);
  const root = record(payload);
  const direct = root ? pick(root, ["cases", "testCases", "test_cases", "测试用例", "items", "data"]) : undefined;
  const nested = record(direct) ? pick(record(direct)!, ["cases", "testCases", "test_cases", "测试用例", "items"]) : direct;
  if (!Array.isArray(nested)) throw new Error("AI 未返回测试用例列表。");
  return nested.flatMap((item) => record(item) ? [item] : []);
}

function priority(value: unknown): RequirementTestCase["priority"] {
  const normalized = text(value).toUpperCase();
  if (normalized === "P0" || /最高|高|HIGH|CRITICAL/.test(normalized)) return "P0";
  if (normalized === "P2" || /低|LOW/.test(normalized)) return "P2";
  return "P1";
}

function caseType(value: unknown): RequirementTestCase["type"] {
  const normalized = text(value).toLowerCase();
  if (["happy_path", "branch", "exception", "boundary", "validation", "permission"].includes(normalized)) return normalized as RequirementTestCase["type"];
  if (/分支/.test(normalized)) return "branch";
  if (/异常|失败|错误/.test(normalized)) return "exception";
  if (/边界|极限/.test(normalized)) return "boundary";
  if (/校验|验证|必填/.test(normalized)) return "validation";
  if (/权限|角色/.test(normalized)) return "permission";
  return "happy_path";
}

function redactDetail(value: string) {
  return value.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]").slice(0, 240).trim();
}

function extractContent(value: ModelResponse) {
  const content = value.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => typeof part === "object" && part !== null && typeof part.text === "string" ? part.text : "").join("").trim();
  return "";
}

export async function generateTestCases(requirementCode: string, versionNo: number) {
  const requestId = `tc_${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = Date.now();
  logGeneration(requestId, "started", startedAt, { requirementCode, versionNo });
  const context = await getTestCaseGenerationContext(requirementCode, versionNo);
  logGeneration(requestId, "context_ready", startedAt, {
    prdChars: context.prd.length,
    demoChars: context.demoSummary.length,
    historyCount: context.historicalTestCases.length,
  });
  const { baseUrl, apiKey, model, reasoningEffort } = await resolveAssistantModel();
  let response: Response;
  try {
    logGeneration(requestId, "model_request_started", startedAt, { model, endpointHost: new URL(baseUrl).host });
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model, temperature: 0, ...reasoningEffortPayload(reasoningEffort), response_format: { type: "json_object" }, messages: [
        { role: "system", content: "你是测试用例生成助手。只能依据给出的 PRD 生成测试条件，PRD 未定义的规则不能编造。只输出 JSON 对象：{cases:[{title,module,priority,type,prd_source,preconditions,steps:[{step,action}],expected_results,demo_available,demo_script}]}。最多生成 16 条高价值用例，优先覆盖主流程、关键分支、异常、边界和表单校验，不要为同一规则拆出重复用例。priority 只能 P0/P1/P2，type 只能 happy_path/branch/exception/boundary/validation/permission。Demo 信息只用于识别页面与交互范围，不能补充 PRD 未定义的业务规则。只有提供稳定 data-demo-id 且明确支持自动化通信协议时，才可以将 demo_available 设为 true 并生成 demo_script；否则必须为 false 和 []。" },
        { role: "user", content: `项目：${context.projectName}\n需求：${context.requirementTitle}（${context.requirementCode} V${context.versionNo}）\n版本说明：${context.changeSummary}\n\nPRD：\n${context.prd}\n\nDemo 页面分析：\n${context.demoSummary}\n\nDemo 可用 data-demo-id：${context.demoIds.length ? context.demoIds.join(",") : "无"}\nDemo 自动化通信协议：${context.demoSupportsAutomation ? "已检测到" : "未检测到"}\n\n历史版本测试用例（只作覆盖参考，必须以当前 PRD 为准，不得复制后直接保留）：\n${context.historicalTestCases.length ? context.historicalTestCases.map((item) => `V${item.versionNo} ${item.id}｜${item.priority}｜${item.module}｜${item.title}｜${item.prdSource}`).join("\n") : "无"}` },
      ] }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      logGeneration(requestId, "model_request_timeout", startedAt);
      throw new TestCaseGenerationError(`模型调用超过 60 秒未返回（请求 ${requestId}）。已完成 PRD 与 Demo 准备，请检查模型服务响应速度或稍后重试。`, 504);
    }
    const reason = error instanceof Error ? error.message : "网络连接失败";
    logGeneration(requestId, "model_request_failed", startedAt, { reason: redactDetail(reason) });
    throw new TestCaseGenerationError(`无法连接 AI 服务：${redactDetail(reason)}（请求 ${requestId}）。`, 502);
  }
  logGeneration(requestId, "model_response_received", startedAt, { status: response.status });
  const responseText = await response.text();
  if (!response.ok) {
    const detail = redactDetail(responseText);
    logGeneration(requestId, "model_response_error", startedAt, { status: response.status });
    throw new TestCaseGenerationError(`AI 服务请求失败（HTTP ${response.status}）${detail ? `：${detail}` : "。"}（请求 ${requestId}）。`, 502);
  }
  let payload: ModelResponse;
  try {
    payload = JSON.parse(responseText) as ModelResponse;
  } catch {
    throw new TestCaseGenerationError(`AI 服务返回的内容不是有效 JSON 响应（请求 ${requestId}）。请检查模型服务是否兼容 OpenAI Chat Completions。`, 502);
  }
  const raw = extractContent(payload);
  if (!raw) throw new TestCaseGenerationError(`AI 服务未返回测试用例（请求 ${requestId}）。`, 422);
  let generated: Generated[];
  try {
    generated = parse(raw).slice(0, 16);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "无法解析测试用例";
    throw new TestCaseGenerationError(`${reason}（请求 ${requestId}）。`, 422);
  }
  const cases = generated.map((item) => {
    const title = text(pick(item, ["title", "name", "case_name", "caseName", "用例名称", "标题"]), 160);
    const featureModule = text(pick(item, ["module", "feature", "模块", "功能模块"]), 80) || "需求功能";
    return {
      title,
      module: featureModule,
      priority: priority(pick(item, ["priority", "优先级"])),
      type: caseType(pick(item, ["type", "case_type", "caseType", "类型"])),
      prdSource: text(pick(item, ["prdSource", "prd_source", "prdSection", "prd_section", "PRD来源", "PRD 来源"]), 160) || "当前版本 PRD",
      preconditions: list(pick(item, ["preconditions", "pre_conditions", "前置条件"])),
      steps: steps(pick(item, ["steps", "test_steps", "testSteps", "步骤", "测试步骤"])),
      expectedResults: list(pick(item, ["expectedResults", "expected_results", "expected", "预期结果", "期望结果"])),
      status: "pending" as const,
      demoAvailable: false,
      demoScript: [],
      demoVersion: `V${versionNo}`,
    };
  }).filter((item) => item.title && item.steps.length && item.expectedResults.length);
  if (!cases.length) throw new TestCaseGenerationError(`AI 已返回用例，但缺少标题、测试步骤或预期结果（请求 ${requestId}）。请重试。`, 422);
  logGeneration(requestId, "validation_complete", startedAt, { caseCount: cases.length, responseChars: raw.length });
  const saved = await replaceVersionTestCases(requirementCode, versionNo, cases);
  scheduleRequirementKnowledgeSync(requirementCode);
  logGeneration(requestId, "saved", startedAt, { caseCount: saved.length });
  return saved;
}
