"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import type { Product, ProductSpec, ProductSpecChange } from "@/lib/types";

type Extraction = { product: Product; changes: ProductSpecChange[]; summary: { total: number; added: number; supplemented: number; conflicts: number }; draftSpec: ProductSpec };
type ConflictAction = "keep_existing" | "use_incoming" | "product_override";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json() as { data?: T; error?: string };
  if (!response.ok || body.error) throw new Error(body.error ?? "请求失败。");
  return body.data as T;
}

export function ProductSpecDialog({ open, requirementCode, initialProductId, onClose, onMerged }: { open: boolean; requirementCode: string; initialProductId?: string; onClose: () => void; onMerged: (productId: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState(initialProductId ?? "");
  const [step, setStep] = useState<"select" | "extract" | "review">("select");
  const [result, setResult] = useState<Extraction | null>(null);
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decisions, setDecisions] = useState<Record<number, ConflictAction>>({});

  useEffect(() => {
    if (!open) return;
    void request<Product[]>("/api/v1/products").then(setProducts).catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取产品。"));
  }, [open]);

  if (!open) return null;

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const product = await request<Product>("/api/v1/products", { method: "POST", body: JSON.stringify({ name: newName, description: newDescription }) });
      setProducts((current) => [...current, product].toSorted((left, right) => left.name.localeCompare(right.name)));
      setSelectedId(product.id);
      setNewName("");
      setNewDescription("");
      setNewProductOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建产品失败。");
    } finally {
      setBusy(false);
    }
  }

  async function extract() {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    setStep("extract");
    try {
      const data = await request<Extraction>(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/product-spec-extraction`, { method: "POST", body: JSON.stringify({ productId: selectedId }) });
      setResult(data);
      setDecisions(Object.fromEntries(data.changes.map((change, index) => [index, change.category === "conflict" ? "keep_existing" : "use_incoming"])));
      setStep("review");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "提取产品规范失败。");
      setStep("select");
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const draftSpec = { ...result.draftSpec, entries: result.draftSpec.entries?.flatMap((entry) => {
        const index = result.changes.findIndex((change) => change.path === `entries.${entry.category}.${entry.title}`);
        const action = index >= 0 ? decisions[index] : "use_incoming";
        if (action === "keep_existing") return [];
        if (action === "product_override") return [{ ...entry, scope: "product" as const, productId: result.product.id, sourceProductId: result.product.id }];
        return [entry];
      }) };
      await request<ProductSpec>(`/api/v1/products/${encodeURIComponent(result.product.id)}/spec`, { method: "POST", body: JSON.stringify({ draftSpec }) });
      await request(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/product`, { method: "PATCH", body: JSON.stringify({ productId: result.product.id }) });
      onMerged(result.product.id);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新产品规范失败。");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="product-spec-backdrop" role="presentation">
      <section className="product-spec-dialog" role="dialog" aria-modal="true" aria-labelledby="product-spec-title">
        <header>
          <div>
            <h2 id="product-spec-title">提取产品规范</h2>
            <p>{step === "select" ? "选择规范归属产品（任意状态均可手动提取）" : step === "extract" ? "正在进行程序分析与 AI 规范提炼" : "确认规范变化"}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><Icon name="close" /></button>
        </header>
        {step === "select" ? <div className="product-spec-select-step">
          <label>
            <span>产品</span>
            <div className="product-spec-field">
              <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label="选择产品">
                <option value="">选择产品</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
              <button type="button" className="product-spec-add" onClick={() => setNewProductOpen(true)} title="新增产品" aria-label="新增产品"><Icon name="plus" /></button>
            </div>
          </label>
          <p className="product-spec-hint">选择后，本次提取结果会保存到该产品的全局规范。</p>
        </div> : step === "extract" ? <div className="product-spec-progress"><Icon name="sparkles" /><p>正在读取 PRD、Demo HTML、CSS、DOM 和测试用例，再由 AI 提炼可复用规范…</p></div> : result ? <div className="product-spec-review">
          <div className="product-spec-summary"><strong>发现 {result.summary.total} 项规范变化</strong><span>公共规范 {result.changes.filter((change) => change.scope === "global").length}</span><span>产品规范 {result.changes.filter((change) => change.scope !== "global").length}</span><span>新增 {result.summary.added}</span><span>补充 {result.summary.supplemented}</span><span className={result.summary.conflicts ? "has-conflict" : ""}>冲突 {result.summary.conflicts}</span></div>
          <div className="product-spec-changes">{result.changes.length ? result.changes.map((change, index) => <div key={`${change.path}-${index}`} className={`product-spec-change is-${change.category}`}><b>{change.category === "added" ? "新增" : change.category === "supplemented" ? "补充" : "冲突"}</b><span>{change.summary}</span><small>{change.path}</small>{change.category === "conflict" ? <select value={decisions[index] || "keep_existing"} onChange={(event) => setDecisions((current) => ({ ...current, [index]: event.target.value as ConflictAction }))} aria-label={`处理冲突 ${change.path}`}><option value="keep_existing">保持现有</option><option value="use_incoming">使用当前提取</option><option value="product_override">仅作为产品规范</option></select> : null}{change.scope ? <select value={change.scope} onChange={(event) => { const scope = event.target.value as "global" | "product"; const incomingTitle = typeof change.incoming === "object" && change.incoming && "title" in change.incoming ? String(change.incoming.title) : ""; setResult((current) => current ? { ...current, draftSpec: { ...current.draftSpec, entries: current.draftSpec.entries?.map((entry) => entry.title === incomingTitle ? { ...entry, scope, productId: scope === "product" ? current.product.id : undefined } : entry) } } : current); }} aria-label={`规范作用域 ${change.path}`}><option value="global">公共</option><option value="product">当前产品</option></select> : null}</div>) : <p className="product-spec-empty">没有发现新的规范变化。</p>}</div>
        </div> : null}
        {error ? <p className="product-spec-error">{error}</p> : null}
        <footer>
          <button type="button" onClick={onClose}>取消</button>
          {step === "select" ? <button type="button" className="primary" disabled={!selectedId || busy} onClick={() => void extract()}>开始提取</button> : null}
          {step === "review" ? <button type="button" className="primary" disabled={busy} onClick={() => void merge()}>确认更新</button> : null}
        </footer>
      </section>
    </div>
    {newProductOpen ? <div className="product-spec-new-layer" role="presentation">
      <div className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="product-create-title">
        <header>
          <div>
            <span className="project-dialog-kicker">全局产品</span>
            <h2 id="product-create-title">新增产品</h2>
            <p>创建完成后会自动选中，不关联当前项目。</p>
          </div>
          <button type="button" className="project-dialog-close" onClick={() => setNewProductOpen(false)} aria-label="关闭"><Icon name="close" /></button>
        </header>
        <div className="project-dialog-body">
          <label>产品名称<input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={120} placeholder="输入产品名称" /></label>
          <label>产品说明<span className="project-dialog-optional">可选</span><textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} maxLength={500} placeholder="说明产品边界、用户或主要场景" /></label>
          {error ? <p className="project-dialog-error">{error}</p> : null}
        </div>
        <footer>
          <button type="button" className="project-dialog-cancel" onClick={() => setNewProductOpen(false)}>取消</button>
          <button type="button" className="project-dialog-save" disabled={!newName.trim() || busy} onClick={() => void create()}>{busy ? "创建中…" : "创建并选中"}</button>
        </footer>
      </div>
    </div> : null}
  </>;
}
