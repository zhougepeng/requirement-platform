"use client";

import { FormEvent, useEffect, useState } from "react";
import { Icon } from "@/components/icons";

type ModelSummary = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  embeddingModel?: string;
  reasoningEffort?: "low" | "medium" | "high";
  isDefault: boolean;
  hasApiKey: boolean;
};

type ModelForm = { name: string; baseUrl: string; model: string; embeddingModel: string; reasoningEffort: "low" | "medium" | "high"; apiKey: string; isDefault: boolean };
const emptyForm: ModelForm = { name: "", baseUrl: "", model: "", embeddingModel: "", reasoningEffort: "medium", apiKey: "", isDefault: true };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json() as { data?: T; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error || "模型配置请求失败。");
  return payload.data;
}

export function ModelManager({ initialOpen = false, hideTrigger = false, onClose }: { initialOpen?: boolean; hideTrigger?: boolean; onClose?: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState(initialOpen);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ModelSummary | null>(null);
  const [form, setForm] = useState<ModelForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!initialOpen) return;
    void loadModels();
  }, [initialOpen]);

  async function loadModels() {
    setLoading(true);
    setError("");
    try {
      setModels(await request<ModelSummary[]>("/api/v1/models"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取模型配置。");
    } finally {
      setLoading(false);
    }
  }

  async function testConnection() {
    if (testing || !models.length) return;
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{ model: string; host: string; elapsedMs: number }>("/api/v1/models/test", { method: "POST" });
      setNotice(`默认模型连接正常：${result.model} · ${result.host} · ${result.elapsedMs}ms`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "模型连接检测失败。");
    } finally {
      setTesting(false);
    }
  }

  function beginCreate() {
    setEditing(null);
    setForm({ ...emptyForm, isDefault: !models.length });
    setError("");
    setFormOpen(true);
  }

  function beginEdit(item: ModelSummary) {
    setEditing(item);
    setForm({ name: item.name, baseUrl: item.baseUrl, model: item.model, embeddingModel: item.embeddingModel ?? "", reasoningEffort: item.reasoningEffort ?? "medium", apiKey: "", isDefault: item.isDefault });
    setError("");
    setFormOpen(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await request<ModelSummary>("/api/v1/models", {
          method: "PATCH",
          body: JSON.stringify({ id: editing.id, name: form.name, baseUrl: form.baseUrl, model: form.model, embeddingModel: form.embeddingModel || null, reasoningEffort: form.reasoningEffort, apiKey: form.apiKey || undefined, isDefault: form.isDefault }),
        });
      } else {
        await request<ModelSummary>("/api/v1/models", { method: "POST", body: JSON.stringify(form) });
      }
      setFormOpen(false);
      await loadModels();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存模型配置。");
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(id: string) {
    try {
      await request<ModelSummary>("/api/v1/models", { method: "PATCH", body: JSON.stringify({ id, isDefault: true }) });
      await loadModels();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法设置默认模型。");
    }
  }

  async function remove(item: ModelSummary) {
    if (!window.confirm(`删除模型“${item.name}”吗？`)) return;
    try {
      await request<{ id: string }>("/api/v1/models", { method: "DELETE", body: JSON.stringify({ id: item.id }) });
      await loadModels();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法删除模型配置。");
    }
  }

  function close() {
    setFormOpen(false);
    setOpen(false);
    onClose?.();
  }

  return <>
    {!hideTrigger ? <div className="model-manager-menu">
      <button className="model-manager-trigger" onClick={() => setMenuOpen((current) => !current)} title="设置" aria-label="设置" aria-expanded={menuOpen}><Icon name="settings" /></button>
      {menuOpen ? <><button className="model-manager-menu-dismiss" aria-label="关闭设置菜单" onClick={() => setMenuOpen(false)} /><div className="model-manager-popover" role="menu"><button role="menuitem" onClick={() => { setMenuOpen(false); setOpen(true); void loadModels(); }}><Icon name="settings" /><span>模型管理</span></button></div></> : null}
    </div> : null}
    {open ? <div className="model-manager-layer" role="presentation"><button className="model-manager-backdrop" aria-label="关闭模型管理" onClick={close} /><section className="model-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="model-manager-title">
      <header><div><h2 id="model-manager-title">模型管理</h2><p>管理需求库 AI 助手使用的模型配置。</p></div><button className="model-manager-close" onClick={close} aria-label="关闭模型管理"><Icon name="close" /></button></header>
      <div className="model-manager-body">
        <div className="model-manager-toolbar"><span>{models.length ? `已配置 ${models.length} 个模型` : "尚未添加模型"}</span><div><button className="project-dialog-cancel" onClick={() => void testConnection()} disabled={!models.length || testing}>{testing ? "检测中…" : "测试默认模型"}</button><button className="model-manager-add" onClick={beginCreate}><Icon name="plus" />新增模型</button></div></div>
        {error && <p className="model-manager-error">{error}</p>}
        {notice && <p className="model-manager-success">{notice}</p>}
        {loading ? <p className="model-manager-empty">正在读取模型配置…</p> : models.length ? <div className="model-manager-list">{models.map((item) => <article className="model-card" key={item.id}><div className="model-card-main"><div><b>{item.name}</b>{item.isDefault ? <span className="model-default">默认</span> : null}</div><code>{item.model}</code><small title={item.baseUrl}>{item.baseUrl}</small></div><div className="model-card-state"><span>{item.embeddingModel ? "语义检索已开启" : "使用语义重排"}</span><div><button onClick={() => beginEdit(item)}>编辑</button>{!item.isDefault ? <button onClick={() => void makeDefault(item.id)}>设为默认</button> : null}<button className="model-delete" onClick={() => void remove(item)} title="删除模型"><Icon name="trash" /></button></div></div></article>)}</div> : <div className="model-manager-empty"><b>还没有模型配置</b><span>新增一个兼容 OpenAI Chat Completions 的模型后，需求库助手即可回答命中的需求内容。</span></div>}
      </div>
      {formOpen ? <div className="model-form-layer"><button className="model-form-backdrop" aria-label="取消模型编辑" onClick={() => setFormOpen(false)} /><form className="model-form" onSubmit={(event) => void save(event)}><header><div><h3>{editing ? "编辑模型" : "新增模型"}</h3><p>密钥只保存在本机，不会在此页面回显。</p></div><button type="button" className="model-manager-close" onClick={() => setFormOpen(false)} aria-label="关闭模型编辑"><Icon name="close" /></button></header><label>配置名称<input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} required maxLength={80} placeholder="例如：团队模型服务" /></label><label>服务地址<input value={form.baseUrl} onChange={(event) => setForm((value) => ({ ...value, baseUrl: event.target.value }))} required type="url" placeholder="https://api.example.com/v1" /></label><label>回答模型 ID<input value={form.model} onChange={(event) => setForm((value) => ({ ...value, model: event.target.value }))} required maxLength={160} placeholder="例如：gpt-4.1-mini" /></label><label>思考深度<select value={form.reasoningEffort} onChange={(event) => setForm((value) => ({ ...value, reasoningEffort: event.target.value as ModelForm["reasoningEffort"] }))}><option value="low">低：响应更快</option><option value="medium">中：速度与质量平衡</option><option value="high">高：更深入分析</option></select></label><label>向量模型 ID <small>可选，用于提升相近语义的 PRD 命中</small><input value={form.embeddingModel} onChange={(event) => setForm((value) => ({ ...value, embeddingModel: event.target.value }))} maxLength={160} placeholder="例如：text-embedding-3-small" /></label><label>API Key<input value={form.apiKey} onChange={(event) => setForm((value) => ({ ...value, apiKey: event.target.value }))} required={!editing} type="password" maxLength={2000} placeholder={editing ? "留空则保留当前密钥" : "输入 API Key"} /></label><label className="model-default-check"><input checked={form.isDefault} onChange={(event) => setForm((value) => ({ ...value, isDefault: event.target.checked }))} type="checkbox" />设为 AI 助手默认模型</label><footer><button type="button" className="model-cancel" onClick={() => setFormOpen(false)}>取消</button><button className="model-save" disabled={saving}>{saving ? "保存中…" : "保存模型"}</button></footer></form></div> : null}
    </section></div> : null}
  </>;
}
