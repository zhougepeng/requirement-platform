import "server-only";

import type { RequirementActor } from "@/services/auth/request-actor";
import { listCurrentRequirementKnowledgeSources, listProjects, type CurrentRequirementKnowledgeSource } from "@/services/requirement/repository";
import { DifyKnowledgeClient, type DifyRetrievedChunk } from "@/services/assistant/dify-knowledge-client";
import { listKnowledgeSyncEntries, schedulePendingKnowledgeRetry, type KnowledgeContentType } from "@/services/assistant/knowledge-sync-service";
import { listAllMaterials, type Material } from "@/services/materials/material-service";
import { listMaterialKnowledgeSyncEntries, schedulePendingMaterialKnowledgeRetry } from "@/services/materials/material-knowledge-sync-service";
import { schedulePendingRequirementKnowledgeExtractionRetry } from "@/services/materials/requirement-knowledge-extraction-service";

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
  contentType: KnowledgeContentType | "material";
  sourceKind?: "material";
  sourceUpdatedAt: string;
};
export type RetrievedKnowledgeChunk = { sourceId: string; content: string; score?: number };
export type KnowledgeRetrievalResult = { mode: KnowledgeQuestionMode; usedOfflineFallback: boolean; chunks: RetrievedKnowledgeChunk[]; sources: RetrievedKnowledgeSource[] };

type Input = { question: string; scope: KnowledgeScope; requirementCode?: string; projectId?: string; actor: RequirementActor | undefined };

function isFutureQuestion(question: string) {
  return /后面|未来|规划|下一版|下个版本|准备做|待做|尚未上线|未上线(?:的)?(?:需求|功能)?|还没有上线|排期|预计上线/.test(question);
}

function mergeHits(...groups: DifyRetrievedChunk[][]) {
  const seen = new Set<string>();
  const merged: DifyRetrievedChunk[] = [];
  for (const hit of groups.flat()) {
    const key = `${hit.documentId}\n${hit.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }
  return merged;
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

function materialSource(material: Material, documentId: string, projectNames: Map<string, string>): RetrievedKnowledgeSource {
  return {
    id: documentId,
    projectId: material.projectId ?? "public",
    projectName: material.projectId ? projectNames.get(material.projectId) ?? "已删除项目" : "公共资料",
    requirementCode: material.id,
    requirementName: material.title,
    versionNo: 0,
    status: "online",
    contentType: "material",
    sourceKind: "material",
    sourceUpdatedAt: material.updatedAt,
  };
}

function filterMaterialHits(hits: DifyRetrievedChunk[], materials: Material[], entries: Awaited<ReturnType<typeof listMaterialKnowledgeSyncEntries>>, input: Input, projectNames: Map<string, string>, requirementSources: Awaited<ReturnType<typeof listCurrentRequirementKnowledgeSources>>) {
  const documentIds = new Map(entries.flatMap((entry) => entry.documentId ? [[entry.documentId, entry.materialId] as const] : []));
  const materialById = new Map(materials.map((item) => [item.id, item]));
  const visible = new Map<string, RetrievedKnowledgeSource>();
  const chunks: RetrievedKnowledgeChunk[] = [];
  for (const hit of hits) {
    const material = materialById.get(documentIds.get(hit.documentId) ?? "");
    if (!material) continue;
    if (material.origin === "system_generated") {
      const onlineCodes = new Set(requirementSources.filter((source) => source.status === "online").map((source) => source.requirementCode));
      if (!material.sourceRequirementCodes.some((code) => onlineCodes.has(code))) continue;
    }
    const visibleInScope = material.scope === "public"
      || input.scope === "all-published"
      || (input.scope === "current-project" && material.projectId === input.projectId)
      || (input.scope === "current-requirement" && material.projectId === input.projectId);
    if (!visibleInScope) continue;
    visible.set(hit.documentId, materialSource(material, hit.documentId, projectNames));
    chunks.push({ sourceId: hit.documentId, content: hit.content, score: hit.score });
  }
  return { chunks, sources: [...visible.values()] };
}

/**
 * Dify's public dataset retrieval API currently has no reliable document
 * metadata-filter request parameter. The platform therefore treats the Dify
 * document mapping as a mandatory post-retrieval guard before any chunk can
 * reach the LLM. Metadata is still synchronized for Dify operations/audit.
 */
export async function retrieveProductKnowledge(input: Input): Promise<KnowledgeRetrievalResult> {
  schedulePendingKnowledgeRetry();
  schedulePendingMaterialKnowledgeRetry();
  schedulePendingRequirementKnowledgeExtractionRetry();
  const [allRequirementSources, projects, materials, materialEntries] = await Promise.all([
    listCurrentRequirementKnowledgeSources(),
    listProjects(),
    listAllMaterials(),
    listMaterialKnowledgeSyncEntries(),
  ]);
  const scopedSources = resolveScope(input, allRequirementSources);
  const mode: KnowledgeQuestionMode = isFutureQuestion(input.question) ? "future" : "current";
  const client = new DifyKnowledgeClient();
  const [entries, primaryHits, planningHits] = await Promise.all([
    listKnowledgeSyncEntries(),
    client.retrieve(input.question),
    mode === "future" ? Promise.resolve([]) : client.retrieve(`${input.question}\n\n同时检索相关的已排期、未上线和规划需求。`),
  ]);
  const hits = mergeHits(primaryHits, planningHits);
  if (mode === "future") return { mode, usedOfflineFallback: false, ...filterHits(hits, scopedSources, entries, new Set(["scheduled", "offline"])) };

  // 普通查询也要能提示相关规划，但“当前已支持”的判断只由回答层依据已上线来源给出。
  const requirementMatched = filterHits(hits, scopedSources, entries, new Set(["online", "scheduled", "offline"]));
  const materialMatched = filterMaterialHits(hits, materials, materialEntries, input, new Map(projects.map((project) => [project.id, project.name])), allRequirementSources);
  const matched = {
    chunks: limitChunks([...requirementMatched.chunks, ...materialMatched.chunks]),
    sources: [...requirementMatched.sources, ...materialMatched.sources],
  };
  const usedOfflineFallback = matched.chunks.length > 0 && !matched.sources.some((source) => source.status === "online");
  return { mode, usedOfflineFallback, ...matched };
}
