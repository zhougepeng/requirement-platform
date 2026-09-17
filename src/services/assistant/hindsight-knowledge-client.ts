import "server-only";

import { getHindsightConfiguration } from "@/services/assistant/hindsight-config";

export type HindsightKnowledgeMetadata = Record<string, string>;
export type HindsightKnowledgeDocument = { documentId: string; text: string; metadata: HindsightKnowledgeMetadata; tags?: string[]; timestamp?: string };
export type HindsightRetrievedChunk = { documentId: string; content: string; score?: number };

type HindsightResponse = { message?: string; detail?: string; error?: string };

export class HindsightKnowledgeError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) { super(message); this.statusCode = statusCode; }
}

function configured() {
  const value = getHindsightConfiguration();
  if (!value) throw new HindsightKnowledgeError("项目记忆尚未配置。请设置 HINDSIGHT_API_BASE_URL、HINDSIGHT_TOKEN 和 HINDSIGHT_BANK_ID。", 503);
  return value;
}

function errorMessage(status: number, body: unknown) {
  const payload = body && typeof body === "object" ? body as HindsightResponse : undefined;
  return `项目记忆请求失败（HTTP ${status}${payload?.message || payload?.detail || payload?.error ? `：${payload.message || payload.detail || payload.error}` : ""}）。`;
}

export function isHindsightConfigured() { return Boolean(getHindsightConfiguration()); }

export class HindsightKnowledgeClient {
  private async request<T>(suffix: string, init: RequestInit): Promise<T> {
    const { baseUrl, bankId, token } = configured();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}${suffix}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      throw new HindsightKnowledgeError(`无法连接项目记忆：${error instanceof Error ? error.message : "网络连接失败"}`, 502);
    }
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => undefined);
    if (!response.ok) throw new HindsightKnowledgeError(errorMessage(response.status, body), response.status >= 500 ? 502 : response.status);
    return body as T;
  }

  async verifyConnection() {
    const response = await this.request<{ items?: unknown[] }>("/memories/list", { method: "GET" });
    const { bankId } = configured();
    return { bankId, memoryCount: Array.isArray(response.items) ? response.items.length : undefined };
  }

  async listDocumentMemories(documentId: string) {
    const memories: Array<{ id: string; factType: string }> = [];
    const pageSize = 100;
    for (let offset = 0; offset < 10_000; offset += pageSize) {
      const response = await this.request<{ items?: unknown[] }>(`/memories/list?document_id=${encodeURIComponent(documentId)}&state=valid&limit=${pageSize}&offset=${offset}`, { method: "GET" });
      const page = (response.items ?? []).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const value = item as Record<string, unknown>;
        return typeof value.id === "string" ? [{ id: value.id, factType: typeof value.fact_type === "string" ? value.fact_type : typeof value.type === "string" ? value.type : "world" }] : [];
      });
      memories.push(...page);
      if (page.length < pageSize) break;
    }
    return memories;
  }

  async invalidateDocument(documentId: string) {
    for (const memory of await this.listDocumentMemories(documentId)) {
      if (memory.factType === "observation") continue;
      await this.request(`/memories/${encodeURIComponent(memory.id)}`, { method: "PATCH", body: JSON.stringify({ state: "invalidated", reason: "需求库内容已更新，旧版本不再作为当前事实" }) });
    }
  }

  async retain(document: HindsightKnowledgeDocument) {
    await this.request("/memories", {
      method: "POST",
      body: JSON.stringify({ items: [{ content: document.text, document_id: document.documentId, metadata: document.metadata, tags: document.tags ?? [], timestamp: document.timestamp, update_mode: "replace" }], async: false }),
    });
  }

  async retrieve(query: string) {
    const response = await this.request<{ results?: unknown[] }>("/memories/recall", {
      method: "POST",
      // Raw facts retain the source document_id used by the platform's scope
      // guard; consolidated observations may not carry that identifier.
      body: JSON.stringify({ query: query.slice(0, 1000), max_tokens: 3500, budget: "mid", types: ["world", "experience"] }),
    });
    return (response.results ?? []).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const documentId = typeof value.document_id === "string" ? value.document_id : "";
      const content = [value.text, value.content, value.context].find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
      if (!documentId || !content) return [];
      const scores = value.scores && typeof value.scores === "object" ? value.scores as Record<string, unknown> : undefined;
      const score = typeof value.score === "number" ? value.score : typeof scores?.final === "number" ? scores.final : typeof value.similarity === "number" ? value.similarity : undefined;
      return [{ documentId, content: content.trim(), score } satisfies HindsightRetrievedChunk];
    });
  }
}
