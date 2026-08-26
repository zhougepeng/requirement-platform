import "server-only";

type OutlineConfig = { baseUrl: string; apiKey: string };

export class OutlineAdapter {
  constructor(private readonly config: OutlineConfig) {}

  async createCollection(name: string, description: string) {
    return this.call<{ id: string }>("collections.create", { name, description });
  }

  async createDocument(input: { title: string; text: string; collectionId: string }) {
    return this.call<{ id: string; revision?: { id: string } }>("documents.create", input);
  }

  async updateDocument(input: { id: string; title: string; text: string }) {
    return this.call<{ id: string; revision?: { id: string } }>("documents.update", input);
  }

  async getDocument(id: string) {
    return this.call<{ id: string; title: string; text: string }>("documents.info", { id });
  }

  async searchDocuments(query: string, collectionId?: string) {
    return this.call<{ data: Array<{ id: string; title: string }> }>("documents.search", { query, collectionId });
  }

  async listRevisions(documentId: string) {
    return this.call<{ data: Array<{ id: string; createdAt: string }> }>("revisions.list", { documentId });
  }

  async getRevision(id: string) {
    return this.call<{ id: string; text: string }>("revisions.info", { id });
  }

  private async call<T>(method: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Outline ${method} 请求失败：${response.status}`);
    return response.json() as Promise<T>;
  }
}
