import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveAssistantModel, reasoningEffortPayload } from "@/services/assistant/model-config";
import { listCurrentRequirementKnowledgeSources } from "@/services/requirement/repository";
import { listMaterials, upsertGeneratedMaterial } from "@/services/materials/material-service";
import { scheduleMaterialKnowledgeSync } from "@/services/materials/material-knowledge-sync-service";

type Extraction = { materials?: Array<{ title?: unknown; content?: unknown }> };
type ExtractionFailure = { requirementCode: string; failedAt: string; lastError: string };
type ExtractionStore = { schemaVersion: 1; failures: ExtractionFailure[] };
const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR) : path.join(process.cwd(), "data", "requirement-platform");
const STORE_FILE = path.join(DATA_DIR, "requirement-knowledge-extraction.local.json");
let queue = Promise.resolve();

function now() { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date()).replaceAll("/", "-"); }

async function readStore(): Promise<ExtractionStore> {
  try {
    const parsed = JSON.parse(await readFile(STORE_FILE, "utf8")) as Partial<ExtractionStore>;
    return { schemaVersion: 1, failures: Array.isArray(parsed.failures) ? parsed.failures.filter((item): item is ExtractionFailure => Boolean(item?.requirementCode && item.lastError)) : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { schemaVersion: 1, failures: [] };
    throw error;
  }
}

async function writeStore(store: ExtractionStore) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${STORE_FILE}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, STORE_FILE);
}

async function markFailure(requirementCode: string, error: unknown) {
  const store = await readStore();
  const failure = { requirementCode, failedAt: now(), lastError: error instanceof Error ? error.message.slice(0, 800) : "项目知识提取失败" };
  const index = store.failures.findIndex((item) => item.requirementCode === requirementCode);
  if (index >= 0) store.failures[index] = failure;
  else store.failures.push(failure);
  await writeStore(store);
}

async function clearFailure(requirementCode: string) {
  const store = await readStore();
  const next = store.failures.filter((item) => item.requirementCode !== requirementCode);
  if (next.length === store.failures.length) return;
  store.failures = next;
  await writeStore(store);
}

function parse(raw: string): Extraction | undefined {
  const payload = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = payload.indexOf("{");
  const end = payload.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(payload.slice(start, end + 1)) as Extraction; } catch { return undefined; }
}

function normalizeMaterials(value: Extraction | undefined) {
  return (value?.materials ?? []).flatMap((item) => {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!title || !content || title.length > 120 || content.length > 60_000) return [];
    return [{ title, content }];
  }).slice(0, 3);
}

export async function extractRequirementProjectKnowledge(requirementCode: string) {
  const source = (await listCurrentRequirementKnowledgeSources()).find((item) => item.requirementCode === requirementCode && item.status === "online");
  if (!source) return { skipped: true as const, reason: "not-online" as const };
  const existing = await listMaterials({ scope: "project", projectId: source.projectId });
  const { baseUrl, apiKey, model, reasoningEffort } = await resolveAssistantModel();
  const existingRules = existing.filter((item) => item.origin === "system_generated").map((item) => `# ${item.title}\n${item.content}`).join("\n\n") || "暂无系统整理的长期规范。";
  const evidence = [
    `项目：${source.projectName}`,
    `需求：${source.requirementName}（${source.requirementCode}）`,
    `正式上线：${source.releaseVersion ?? ""} ${source.releaseDate ?? ""}`,
    `PRD：\n${source.prdDocuments.map((item) => item.content).join("\n\n").slice(0, 28_000)}`,
    `最终 Demo：${source.demoEntryUrl ? `已发布，页面地址 ${source.demoEntryUrl}。Demo 仅用于辅助识别页面和交互范围，不得复制 HTML 源码，也不得据此猜测 PRD 未定义规则。` : "未提供。"}`,
    `测试用例：\n${source.testCases.slice(0, 24).map((item) => `${item.title}：${item.expectedResults.join("；")}`).join("\n")}`,
    `已有项目长期规范：\n${existingRules.slice(0, 28_000)}`,
  ].join("\n\n");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, ...reasoningEffortPayload(reasoningEffort), response_format: { type: "json_object" }, messages: [
      { role: "system", content: "你是项目长期知识提取器。仅根据已正式上线需求和已有项目规范，提取以后需求仍可复用、明确且稳定的产品规则、UI与交互规范或PRD规范。不要写上线总结、需求摘要、实施过程或猜测。没有新增、补充或被新事实明确替代的长期规则时，必须返回 {\"materials\":[]}。有规则时，只能返回最多三份资料，title 只能是 产品规范、UI与交互规范、PRD规范 之一；content 为可直接维护的 Markdown，需保留已有仍有效内容，并在底部写“系统根据已上线需求自动整理”。新上线需求可覆盖旧规则，但仅限资料明确证明的冲突。" },
      { role: "user", content: evidence },
    ] }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`项目知识提取失败（HTTP ${response.status}）。`);
  const raw = (await response.json() as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]?.message?.content ?? "";
  const materials = normalizeMaterials(parse(raw));
  const results = [];
  for (const material of materials) {
    const result = await upsertGeneratedMaterial({ projectId: source.projectId, title: material.title, content: material.content, sourceRequirementCode: source.requirementCode });
    if (result.changed) scheduleMaterialKnowledgeSync(result.material.id);
    results.push(result);
  }
  await clearFailure(requirementCode);
  return { skipped: false as const, createdOrUpdated: results.filter((item) => item.changed).length };
}

/** The caller never awaits this queue, so releasing a requirement cannot be blocked by AI or Dify. */
export function scheduleRequirementKnowledgeExtraction(requirementCode: string) {
  queue = queue.then(async () => {
    try { await extractRequirementProjectKnowledge(requirementCode); } catch (error) { await markFailure(requirementCode, error).catch(() => undefined); }
  });
}

export function schedulePendingRequirementKnowledgeExtractionRetry() {
  queue = queue.then(async () => {
    for (const failure of (await readStore()).failures) {
      try { await extractRequirementProjectKnowledge(failure.requirementCode); } catch (error) { await markFailure(failure.requirementCode, error).catch(() => undefined); }
    }
  }).catch(() => undefined);
}
