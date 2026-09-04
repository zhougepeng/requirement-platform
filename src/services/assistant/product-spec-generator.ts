import "server-only";

import type { ProductSpec, ProductSpecComponent, ProductSpecEntry, ProductSpecEvidence } from "@/lib/types";
import { reasoningEffortPayload, resolveAssistantModel } from "@/services/assistant/model-config";
import { extractProductSpec, getProductSpecExtractionContext } from "@/services/requirement/repository";

type JsonRecord = Record<string, unknown>;
type ModelContentPart = { text?: unknown; content?: unknown; output_text?: unknown };
type ModelChoice = { message?: { content?: unknown; reasoning_content?: unknown }; text?: unknown; finish_reason?: unknown };
type ModelResponse = { choices?: ModelChoice[]; output_text?: unknown };

class ProductSpecModelError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function strings(value: unknown, max = 40) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n；;]+/) : [];
  return values.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean).slice(0, max);
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (typeof item === "string") return item;
    const part = record(item) as ModelContentPart | null;
    return part ? contentText(part.text) || contentText(part.content) || contentText(part.output_text) : "";
  }).join("").trim();
}

function contentOf(payload: ModelResponse) {
  const choice = payload.choices?.[0];
  return contentText(choice?.message?.content) || contentText(choice?.text) || contentText(payload.output_text);
}

function modelResponseSummary(payload: ModelResponse) {
  const choice = payload.choices?.[0];
  const message = record(choice?.message);
  return {
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown",
    contentChars: contentOf(payload).length,
    reasoningChars: typeof message?.reasoning_content === "string" ? message.reasoning_content.length : 0,
  };
}

function bounded(value: string, maximum: number) {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n…（已截取，完整源码已由程序分析阶段处理）`;
}

/** Keep the LLM context focused: the program analysis reads the complete demo;
 * this evidence lets the model review concrete CSS and DOM without spending its
 * entire output budget on a copied page source. */
function demoEvidence(html: string) {
  if (!html) return "无";
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");
  const htmlWithoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const structure = (htmlWithoutScripts.match(/<\/?[a-z][^>]*>/gi) ?? []).slice(0, 220).join("\n");
  return `CSS 样本：\n${bounded(styles || "未识别到 style 标签。", 4_000)}\n\nDOM 结构样本：\n${bounded(structure || "未识别到 HTML 标签。", 2_000)}`;
}

function inferDemoTokens(html: string): ProductSpec["tokens"] {
  if (!html) return {};
  const colors = Array.from(new Set(html.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]{3,40}\)/gi) ?? [])).slice(0, 60);
  const variables = Array.from(html.matchAll(/--([\w-]+)\s*:\s*([^;}{]+)/g), (match) => [match[1], match[2].trim()] as const).slice(0, 80);
  const fontFamilies = Array.from(new Set(Array.from(html.matchAll(/font-family\s*:\s*([^;}{]+)/gi), (match) => match[1].trim()).filter(Boolean))).slice(0, 12);
  const spacing = Array.from(new Set(Array.from(html.matchAll(/(?:padding|margin|gap)\s*:\s*([^;}{]+)/gi), (match) => match[1].trim()).filter(Boolean))).slice(0, 24);
  return {
    ...(colors.length || variables.length ? { color: { sourceColors: colors, cssVariables: Object.fromEntries(variables) } } : {}),
    ...(fontFamilies.length ? { typography: { fontFamilies } } : {}),
    ...(spacing.length ? { spacing: { sourceValues: spacing } } : {}),
  };
}

function inferDemoComponents(html: string, requirementCode: string): ProductSpecComponent[] {
  if (!html) return [];
  const definitions: Array<[string, RegExp, string]> = [
    ["Button", /<button\b|\bbutton\b|role\s*=\s*["']button["']/i, "页面操作、提交和导航操作"],
    ["Input", /<input\b|<textarea\b|contenteditable\s*=\s*["']true["']/i, "文本、编号或多行内容输入"],
    ["Select", /<select\b|role\s*=\s*["']combobox["']/i, "枚举项选择和筛选"],
    ["Dialog", /<dialog\b|role\s*=\s*["']dialog["']|modal|modal-mask/i, "承载确认、导入或编辑流程的弹窗"],
    ["Table", /<table\b|role\s*=\s*["']table["']/i, "结构化列表、明细和结果展示"],
    ["Tabs", /\btablist\b|\btab\b|class\s*=\s*["'][^"']*\btab(?:s)?\b/i, "同一页面内的模块切换"],
    ["Card", /class\s*=\s*["'][^"']*(?:card|panel|pane)[^"']*["']/i, "分组展示指标或业务内容"],
  ];
  return definitions.filter(([, pattern]) => pattern.test(html)).map(([name, , usage]) => ({
    name,
    usage,
    states: ["default", "hover", "disabled"],
    interaction: name === "Button" || name === "Tabs" ? ["点击后更新当前状态或内容"] : [],
    sourceRequirementCodes: [requirementCode],
  }));
}

function compactTestCases(testCases: Array<{ title: string; module: string; type: string; steps: unknown; expectedResults: unknown }>) {
  return testCases.slice(0, 16).map((item) => ({
    title: item.title,
    module: item.module,
    type: item.type,
    expectedResults: Array.isArray(item.expectedResults) ? item.expectedResults.slice(0, 2) : item.expectedResults,
  }));
}

function balancedObject(value: string) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (start < 0) {
      if (character === "{") { start = index; depth = 1; }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return value.slice(start, index + 1);
  }
  return "";
}

function parseJson(value: string): JsonRecord {
  const candidate = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() || value.trim();
  try { return record(JSON.parse(candidate)) ?? {}; } catch {
    const fragment = balancedObject(candidate);
    if (!fragment) throw new Error("AI 返回的规范不是有效 JSON。");
    try { return record(JSON.parse(fragment)) ?? {}; } catch { throw new Error("AI 返回的规范不是有效 JSON。"); }
  }
}

function components(value: unknown, requirementCode: string, fallback: ProductSpecComponent[]) {
  if (!Array.isArray(value)) return fallback;
  const parsed = value.flatMap((entry) => {
    const item = record(entry);
    if (!item) return [];
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, 120) : "";
    const usage = typeof item?.usage === "string" ? item.usage.trim().slice(0, 500) : "";
    if (!name || !usage) return [];
    return [{
      name,
      usage,
      avoid: typeof item.avoid === "string" ? item.avoid.trim().slice(0, 400) : undefined,
      style: record(item.style) ?? undefined,
      states: strings(item.states, 12),
      interaction: strings(item.interaction, 16),
      code: typeof item.code === "string" ? item.code.slice(0, 8_000) : undefined,
      sourceRequirementCodes: [requirementCode],
    } satisfies ProductSpecComponent];
  }).slice(0, 40);
  return parsed.length ? parsed : fallback;
}

const categories = new Set<ProductSpecEntry["category"]>(["prd", "token", "component", "layout", "interaction", "template", "demo", "terminology", "business_rule"]);
const levels = new Set<ProductSpecEntry["level"]>(["must", "should", "forbid"]);
function entries(value: unknown, requirementCode: string, productId: string, fallback: ProductSpecEntry[]) {
  if (!Array.isArray(value)) return fallback;
  return value.flatMap((entry, index) => {
    const item = record(entry);
    if (!item) return [];
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 160) : "";
    const description = typeof item.description === "string" ? item.description.trim().slice(0, 1200) : "";
    if (!title || !description) return [];
    const scope = item.scope === "global" ? "global" : "product";
    const category = categories.has(item.category as ProductSpecEntry["category"]) ? item.category as ProductSpecEntry["category"] : "demo";
    const level = levels.has(item.level as ProductSpecEntry["level"]) ? item.level as ProductSpecEntry["level"] : "should";
    const evidence = Array.isArray(item.evidence) ? item.evidence.flatMap((candidate) => {
      const source = record(candidate);
      if (!source || typeof source.sourceType !== "string") return [];
      return [{ sourceType: ["prd", "demo_html", "css", "dom", "test"].includes(source.sourceType) ? source.sourceType as ProductSpecEvidence["sourceType"] : "demo_html", path: typeof source.path === "string" ? source.path.slice(0, 500) : undefined, selector: typeof source.selector === "string" ? source.selector.slice(0, 300) : undefined, excerpt: typeof source.excerpt === "string" ? source.excerpt.slice(0, 800) : undefined }];
    }).slice(0, 8) : [];
    return [{ id: typeof item.id === "string" ? item.id.slice(0, 120) : `entry_${requirementCode}_${index}`, category, scope, productId: scope === "product" ? productId : undefined, title, description, structuredData: record(item.structuredData) ?? {}, sourceRequirementId: requirementCode, sourceProductId: scope === "product" ? productId : undefined, level, evidence, confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : undefined } satisfies ProductSpecEntry];
  }).slice(0, 120);
}

function normalizeSpec(value: JsonRecord, program: ProductSpec, requirementCode: string, demoHtml = ""): ProductSpec {
  const source = record(value.spec) ?? value;
  const rules = record(source.rules);
  const prd = record(source.prd);
  const demo = record(source.demo);
  const tokens = record(source.tokens);
  const inferredTokens = inferDemoTokens(demoHtml);
  const inferredComponents = inferDemoComponents(demoHtml, requirementCode);
  const parsedTokens = tokens && Object.keys(tokens).length ? tokens : inferredTokens;
  const parsedComponents = components(source.components, requirementCode, inferredComponents.length ? inferredComponents : program.components);
  const parsedEntries = entries(source.entries, requirementCode, program.productId, program.entries ?? []);
  return {
    id: program.id,
    productId: program.productId,
    version: program.version,
    rules: {
      terminology: strings(rules?.terminology).length ? strings(rules?.terminology) : program.rules.terminology,
      businessConstraints: strings(rules?.businessConstraints).length ? strings(rules?.businessConstraints) : program.rules.businessConstraints,
      copywriting: strings(rules?.copywriting),
    },
    prd: {
      structure: strings(prd?.structure).length ? strings(prd?.structure) : program.prd.structure,
      writingRules: strings(prd?.writingRules).length ? strings(prd?.writingRules) : program.prd.writingRules,
    },
    tokens: Object.keys(parsedTokens).length ? parsedTokens : program.tokens,
    components: parsedComponents,
    demo: {
      layoutPrinciples: strings(demo?.layoutPrinciples).length ? strings(demo?.layoutPrinciples) : program.demo.layoutPrinciples,
      componentReuseRules: strings(demo?.componentReuseRules).length ? strings(demo?.componentReuseRules) : program.demo.componentReuseRules,
      interactionRequirements: strings(demo?.interactionRequirements),
      constraints: strings(demo?.constraints).length ? strings(demo?.constraints) : program.demo.constraints,
    },
    entries: parsedEntries,
    scope: "product",
    updatedAt: new Date().toISOString(),
  };
}

export async function extractProductSpecWithModel(requirementCode: string, productId: string) {
  const context = await getProductSpecExtractionContext(requirementCode, productId);
  const { baseUrl, apiKey, model, reasoningEffort } = await resolveAssistantModel();
  const systemPrompt = "你是产品规范提取助手。先以程序分析结果为事实基础，再理解 PRD、Demo HTML/CSS/DOM 和测试用例。只沉淀同一产品未来需求仍可复用的规则；一次性业务逻辑、临时数据和未经证实的推测不得写入规范。只输出一个完整、严格合法的 JSON 对象，不要输出 Markdown、代码围栏、解释或前后缀文字：{spec:{entries:[{category:\"prd|token|component|layout|interaction|template|demo|terminology|business_rule\",scope:\"global|product\",title,description,structuredData,level:\"must|should|forbid\",evidence:[{sourceType,path,selector,excerpt}],confidence}],rules:{terminology:string[],businessConstraints:string[],copywriting:string[]},prd:{structure:string[],writingRules:string[]},tokens:object,components:[{name,usage,avoid,style,states:string[],interaction:string[],code}],demo:{layoutPrinciples:string[],componentReuseRules:string[],interactionRequirements:string[],constraints:string[]}}}。公共规范只记录跨产品可复用规则；产品规范只记录当前产品专属规则。每条 entries 必须有 title、description、category、scope、level；没有可靠证据的字段返回空数组或空对象。组件必须说明使用场景。";
  const userPrompt = `需求：${context.requirement.title}（${context.requirement.code}）\n版本：V${context.version.number}\n变更：${context.version.changeSummary || "无"}\n\n程序分析结果（这是可验证事实，已覆盖完整 Demo）：\n${JSON.stringify(context.programSpec)}\n\nPRD：\n${bounded(context.prd, 16_000)}\n\nDemo 页面分析：\n${bounded(context.demoSummary.summary, 3_000)}\n可用 data-demo-id：${context.demoSummary.demoIds.join(",") || "无"}\n\n从 Demo HTML/CSS/DOM 中抽取的证据：\n${demoEvidence(context.demoHtml)}\n\n测试用例（辅助理解，不得把测试步骤误写为产品规则）：\n${JSON.stringify(compactTestCases(context.testCases))}`;
  async function requestCompletion(prompt: string, lowReasoning = false) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: lowReasoning ? 4_000 : 9_000,
          ...reasoningEffortPayload(lowReasoning ? "low" : reasoningEffort),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new ProductSpecModelError("AI 产品规范分析超过 180 秒未完成，请稍后重试。", 504);
      }
      const reason = error instanceof Error ? error.message : "网络连接失败";
      throw new ProductSpecModelError(`AI 产品规范分析失败：${reason.slice(0, 240)}`, 502);
    }
    const raw = await response.text();
    if (!response.ok) throw new ProductSpecModelError(`AI 产品规范分析失败（HTTP ${response.status}）。`, 502);
    try { return JSON.parse(raw) as ModelResponse; } catch {
      throw new ProductSpecModelError("AI 服务返回的内容不是有效 JSON 响应。", 502);
    }
  }

  let parsed: JsonRecord;
  try {
    let payload = await requestCompletion(userPrompt);
    let content = contentOf(payload);
    if (!content) {
      const summary = modelResponseSummary(payload);
      if (summary.finishReason === "length") {
        const retryPrompt = `请直接输出最终 JSON，不要展示或展开推理过程。以下是已由程序完整分析 Demo 后得到的核心证据；仅提炼可复用规范。\n\n需求：${context.requirement.title}（${context.requirement.code}）\n\n程序分析结果：\n${JSON.stringify(context.programSpec)}\n\nPRD：\n${bounded(context.prd, 8_000)}\n\nDemo 分析：\n${bounded(context.demoSummary.summary, 1_500)}\n\nCSS/DOM 样本：\n${bounded(demoEvidence(context.demoHtml), 2_500)}`;
        console.warn("[product-spec-generator]", JSON.stringify({ requirementCode, productId, stage: "retry_with_compact_context", ...summary }));
        payload = await requestCompletion(retryPrompt, true);
        content = contentOf(payload);
      }
      if (!content) {
        console.warn("[product-spec-generator]", JSON.stringify({ requirementCode, productId, stage: "empty_model_content", ...modelResponseSummary(payload) }));
        throw new Error("AI 分析过程未生成最终规范。请稍后重试，或在模型管理中切换响应更快的模型。");
      }
    }
    parsed = parseJson(content);
  } catch (error) {
    throw new ProductSpecModelError(error instanceof Error ? error.message : "AI 规范解析失败。", 422);
  }
  return extractProductSpec(requirementCode, productId, normalizeSpec(parsed, context.programSpec, requirementCode, context.demoHtml));
}
