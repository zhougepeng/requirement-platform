import "server-only";

import type { RequirementActor } from "@/services/auth/request-actor";
import { listCurrentRequirementKnowledgeSources, type CurrentRequirementKnowledgeSource } from "@/services/requirement/repository";
import { DifyKnowledgeClient, type DifyRetrievedChunk } from "@/services/assistant/dify-knowledge-client";
import { listKnowledgeSyncEntries, schedulePendingKnowledgeRetry, type KnowledgeContentType } from "@/services/assistant/knowledge-sync-service";

export type KnowledgeScope = "current-requirement" | "current-project" | "all-published";
export type KnowledgeQuestionMode = "current" | "future";
export type RetrievedKnowledgeSource = {
  id: string;
  projectId: string;
  projectName: string;
  requirementCode: string;
  requirementName: string;
  versionNo: number;
  status: "online" | "scheduled" | "offline";
  scheduleVersion?: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
  releaseVersion?: string;
  releaseDate?: string;
  contentType: KnowledgeContentType;
  sourceUpdatedAt: string;
};
export type RetrievedKnowledgeChunk = { sourceId: string; content: string; score?: number };
export type KnowledgeRetrievalResult = { mode: KnowledgeQuestionMode; usedOfflineFallback: boolean; chunks: RetrievedKnowledgeChunk[]; sources: RetrievedKnowledgeSource[] };

type Input = { question: string; scope: KnowledgeScope; requirementCode?: string; projectId?: string; actor: RequirementActor | undefined };

function isFutureQuestion(question: string) {
  return /后面|未来|规划|下一版|下个版本|准备做|待做|尚未上线|未上线(?:的)?(?:需求|功能)?|还没有上线|排期|预计上线/.test(question);
}

function toSource(source: CurrentRequirementKnowledgeSource, contentType: KnowledgeContentType, id: string): RetrievedKnowledgeSource {
  return { id, projectId: source.projectId, projectName: source.projectName, requirementCode: source.requirementCode, requirementName: source.requirementName, versionNo: source.versionNo, status: source.status, scheduleVersion: source.scheduleVersion, scheduledGrayDate: source.scheduledGrayDate, scheduledFullDate: source.scheduledFullDate, releaseVersion: source.releaseVersion, releaseDate: source.releaseDate, contentType, sourceUpdatedAt: source.sourceUpdatedAt };
}

function limitChunks(chunks: RetrievedKnowledgeChunk[]) {
  return chunks.slice(0, 8).map((chunk) => ({ ...chunk, content: chunk.content.slice(0, 2600) }));
}

function resolveScope(input: Input, sources: CurrentRequirementKnowledgeSource[]) {
  // 当前平台的“查看”权限是全局权限。这里仍在后端把请求范围收束到真实项目/需求；
  // 后续增加项目级 ACL 时只需在此处按 actor.id 过滤 sources，前端参数不会成为权限依据。
  void input.actor;
  if (input.scope === "current-requirement") {
    const selected = sources.filter((source) => source.requirementCode === input.requirementCode);
    if (!selected.length) throw new Error("当前需求不存在或无权访问。");
    return selected;
  }
  if (input.scope === "current-project") {
    const selected = sources.filter((source) => source.projectId === input.projectId);
    if (!selected.length) throw new Error("当前项目不存在或无权访问。");
    return selected;
  }
  return sources;
}

function filterHits(hits: DifyRetrievedChunk[], sources: CurrentRequirementKnowledgeSource[], entries: Awaited<ReturnType<typeof listKnowledgeSyncEntries>>, statuses: ReadonlySet<RetrievedKnowledgeSource["status"]>) {
  const sourceByCode = new Map(sources.map((source) => [source.requirementCode, source]));
  const byDocumentId = new Map(entries.flatMap((entry) => entry.documentId ? [[entry.documentId, entry] as const] : []));
  const visible = new Map<string, RetrievedKnowledgeSource>();
  const chunks: RetrievedKnowledgeChunk[] = [];
  for (const hit of hits) {
    const entry = byDocumentId.get(hit.documentId);
    if (!entry) continue;
    const source = sourceByCode.get(entry.requirementCode);
    if (!source || source.projectId !== entry.projectId || !statuses.has(source.status)) continue;
    visible.set(hit.documentId, toSource(source, entry.contentType, hit.documentId));
    chunks.push({ sourceId: hit.documentId, content: hit.content, score: hit.score });
  }
  return { chunks: limitChunks(chunks), sources: [...visible.values()] };
}

/**
 * Dify's public dataset retrieval API currently has no reliable document
 * metadata-filter request parameter. The platform therefore treats the Dify
 * document mapping as a mandatory post-retrieval guard before any chunk can
 * reach the LLM. Metadata is still synchronized for Dify operations/audit.
 */
export async function retrieveProductKnowledge(input: Input): Promise<KnowledgeRetrievalResult> {
  schedulePendingKnowledgeRetry();
  const scopedSources = resolveScope(input, await listCurrentRequirementKnowledgeSources());
  const [entries, hits] = await Promise.all([listKnowledgeSyncEntries(), new DifyKnowledgeClient().retrieve(input.question)]);
  const mode: KnowledgeQuestionMode = isFutureQuestion(input.question) ? "future" : "current";
  if (mode === "future") return { mode, usedOfflineFallback: false, ...filterHits(hits, scopedSources, entries, new Set(["scheduled", "offline"])) };
  const online = filterHits(hits, scopedSources, entries, new Set(["online"]));
  if (online.chunks.length) return { mode, usedOfflineFallback: false, ...online };
  const offline = filterHits(hits, scopedSources, entries, new Set(["scheduled", "offline"]));
  return { mode, usedOfflineFallback: offline.chunks.length > 0, ...offline };
}
