import "server-only";

import { getDifyKnowledgeConfiguration } from "@/services/assistant/dify-config";

export type DifyKnowledgeMetadata = Record<string, string>;
export type DifyKnowledgeDocument = { name: string; text: string };
export type DifyRetrievedChunk = { documentId: string; content: string; score?: number };

type MetadataField = { id: string; name: string; type?: string };
type DifyResponse = { message?: string; code?: string; detail?: string };

const METADATA_FIELDS = [
  "project_id",
  "project_name",
  "scope",
  "directory_id",
  "source_id",
  "origin",
  "file_name",
  "requirement_id",
  "requirement_name",
  "status",
  "schedule_version",
  "scheduled_gray_date",
  "scheduled_full_date",
  "release_version",
  "release_date",
  "content_type",
  "source_updated_at",
] as const;

export class DifyKnowledgeError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
}

function configured() {
  const configuration = getDifyKnowledgeConfiguration();
  const baseUrl = configuration?.baseUrl;
  const apiKey = configuration?.apiKey;
  const datasetId = configuration?.datasetId;
  if (!baseUrl || !apiKey || !datasetId) {
    throw new DifyKnowledgeError("Dify 知识库尚未配置。请设置 DIFY_API_BASE_URL、DIFY_API_KEY 和 DIFY_DATASET_ID 后执行初始化同步。", 503);
  }
  return { baseUrl, apiKey, datasetId };
}

export function isDifyKnowledgeConfigured() {
  return Boolean(getDifyKnowledgeConfiguration());
}

function errorMessage(status: number, body: unknown) {
  const payload = body && typeof body === "object" ? body as DifyResponse : undefined;
  const detail = payload?.message || payload?.detail || payload?.code;
  return `Dify 知识库请求失败（HTTP ${status}${detail ? `：${detail}` : ""}）。`;
}

function contentFromRecord(record: unknown) {
  if (!record || typeof record !== "object") return undefined;
  const value = record as Record<string, unknown>;
  const segment = value.segment && typeof value.segment === "object" ? value.segment as Record<string, unknown> : {};
  const document = value.document && typeof value.document === "object" ? value.document as Record<string, unknown> : {};
  const documentId = [segment.document_id, value.document_id, document.id].find((item): item is string => typeof item === "string" && item.length > 0);
  const content = [segment.content, segment.answer, value.content, value.text].find((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (!documentId || !content) return undefined;
  return { documentId, content: content.trim(), score: typeof value.score === "number" ? value.score : undefined } satisfies DifyRetrievedChunk;
}

export class DifyKnowledgeClient {
  private metadataFields?: Map<string, MetadataField>;

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const { baseUrl, apiKey } = configured();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "网络连接失败";
      throw new DifyKnowledgeError(`无法连接 Dify 知识库：${reason}`, 502);
    }
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => undefined);
    if (!response.ok) throw new DifyKnowledgeError(errorMessage(response.status, body), response.status >= 500 ? 502 : response.status);
    return body as T;
  }

  private async metadataFieldMap() {
    if (this.metadataFields) return this.metadataFields;
    const { datasetId } = configured();
    const current = await this.request<{ data?: MetadataField[] }>(`/datasets/${encodeURIComponent(datasetId)}/metadata`, { method: "GET" });
    const map = new Map((current.data ?? []).filter((item) => item?.id && item.name).map((item) => [item.name, item]));
    for (const name of METADATA_FIELDS) {
      if (map.has(name)) continue;
      const created = await this.request<MetadataField>(`/datasets/${encodeURIComponent(datasetId)}/metadata`, { method: "POST", body: JSON.stringify({ name, type: "string" }) });
      map.set(name, created);
    }
    this.metadataFields = map;
    return map;
  }

  async createDocument(input: DifyKnowledgeDocument) {
    const { datasetId } = configured();
    const response = await this.request<{ document?: { id?: string } }>(`/datasets/${encodeURIComponent(datasetId)}/document/create-by-text`, {
      method: "POST",
      body: JSON.stringify({ name: input.name, text: input.text, doc_form: "text_model", doc_language: "Chinese", indexing_technique: process.env.DIFY_INDEXING_TECHNIQUE?.trim() || "high_quality", process_rule: { mode: "automatic" } }),
    });
    const id = response.document?.id;
    if (!id) throw new DifyKnowledgeError("Dify 创建文档成功但未返回 document.id。", 502);
    return id;
  }

  async verifyConnection() {
    const { datasetId } = configured();
    const response = await this.request<{ id?: string; name?: string }>(`/datasets/${encodeURIComponent(datasetId)}`, { method: "GET" });
    return { datasetId: response.id ?? datasetId, datasetName: response.name?.trim() || undefined };
  }

  async updateDocument(documentId: string, input: DifyKnowledgeDocument) {
    const { datasetId } = configured();
    await this.request(`/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/update-by-text`, {
      method: "POST",
      body: JSON.stringify({ name: input.name, text: input.text, doc_form: "text_model", doc_language: "Chinese", process_rule: { mode: "automatic" } }),
    });
  }

  async updateMetadata(documentId: string, metadata: DifyKnowledgeMetadata) {
    const { datasetId } = configured();
    const fields = await this.metadataFieldMap();
    const metadataList = Object.entries(metadata).flatMap(([name, value]) => {
      const field = fields.get(name);
      return field ? [{ id: field.id, name, value }] : [];
    });
    await this.request(`/datasets/${encodeURIComponent(datasetId)}/documents/metadata`, {
      method: "POST",
      body: JSON.stringify({ operation_data: [{ document_id: documentId, metadata_list: metadataList, partial_update: false }] }),
    });
  }

  async deleteDocument(documentId: string) {
    const { datasetId } = configured();
    await this.request(`/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" });
  }

  async retrieve(query: string) {
    const { datasetId } = configured();
    const response = await this.request<{ records?: unknown[] }>(`/datasets/${encodeURIComponent(datasetId)}/retrieve`, { method: "POST", body: JSON.stringify({ query: query.slice(0, 250) }) });
    const chunks: DifyRetrievedChunk[] = [];
    for (const record of response.records ?? []) {
      const chunk = contentFromRecord(record);
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  }
}
