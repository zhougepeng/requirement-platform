"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/icons";

type DifySettings = {
  baseUrl: string;
  datasetId: string;
  source: "managed" | "environment";
  hasApiKey: boolean;
  apiKeyHint?: string;
  canSave: boolean;
  encryptionMessage?: string;
  sync: { totalDocuments: number; failedDocuments: number; lastError?: string };
  verification?: { datasetId: string; datasetName?: string };
  syncResult?: { total: number; synced: number; failed: Array<{ requirementCode: string; error: string }> };
};

type DifyForm = { baseUrl: string; datasetId: string; apiKey: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json() as { data?: T; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error || "Dify 配置请求失败。");
  return body.data;
}

export function DifyKnowledgeSettings({ initialOpen = false, onClose }: { initialOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(initialOpen);
  const [settings, setSettings] = useState<DifySettings | null>(null);
  const [form, setForm] = useState<DifyForm>({ baseUrl: "", datasetId: "", apiKey: "" });
  const [loading, setLoading] = useState(initialOpen);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const next = await request<DifySettings>("/api/v1/admin/dify");
      setSettings(next);
      setForm((current) => ({ baseUrl: current.baseUrl || next.baseUrl, datasetId: current.datasetId || next.datasetId, apiKey: "" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取 Dify 配置。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialOpen) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [initialOpen, load]);

  function close() {
    setOpen(false);
    onClose?.();
  }

  async function saveAndVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !settings?.canSave) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await request<DifySettings>("/api/v1/admin/dify", { method: "PUT", body: JSON.stringify(form) });
      setSettings(saved);
      setForm((current) => ({ ...current, apiKey: "" }));
      const verified = await request<DifySettings>("/api/v1/admin/dify", { method: "POST", body: JSON.stringify({ action: "verify" }) });
      setSettings(verified);
      setNotice(`已保存并验证知识库${verified.verification?.datasetName ? `：${verified.verification.datasetName}` : "连接"}。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存或验证 Dify 配置失败。");
    } finally {
      setSaving(false);
    }
  }

  async function syncAll() {
    if (syncing || !settings?.hasApiKey) return;
    if (!window.confirm("将把当前所有已发布需求同步到 Dify 知识库，是否继续？")) return;
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const result = await request<DifySettings>("/api/v1/admin/dify", { method: "POST", body: JSON.stringify({ action: "sync" }) });
      setSettings(result);
      const syncResult = result.syncResult;
      setNotice(syncResult ? `同步完成：${syncResult.synced}/${syncResult.total} 个需求成功。` : "同步任务已完成。");
      if (syncResult?.failed.length) setError(`仍有 ${syncResult.failed.length} 个需求未同步，请根据下方错误信息重试。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "同步 Dify 知识库失败。");
    } finally {
      setSyncing(false);
    }
  }

  return open ? <div className="model-manager-layer" role="presentation">
    <button className="model-manager-backdrop" aria-label="关闭 Dify 知识库设置" onClick={close} />
    <section className="model-manager-dialog dify-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="dify-settings-title">
      <header><div><h2 id="dify-settings-title">Dify 知识库</h2><p>管理员配置需求智能体的知识检索服务。API Key 只保存于服务器端。</p></div><button className="model-manager-close" onClick={close} aria-label="关闭 Dify 知识库设置"><Icon name="close" /></button></header>
      <div className="model-manager-body">
        {loading && !settings ? <p className="model-manager-empty">正在读取 Dify 配置…</p> : <>
          <div className="dify-settings-status">
            <div><span>配置来源</span><b>{settings?.hasApiKey ? (settings.source === "managed" ? "管理员设置" : "部署环境变量") : "未配置"}</b></div>
            <div><span>知识库同步</span><b>{settings?.sync.failedDocuments ? `${settings.sync.failedDocuments} 个文档待重试` : `${settings?.sync.totalDocuments ?? 0} 个文档已记录`}</b></div>
          </div>
          {settings?.encryptionMessage ? <p className="model-manager-error">{settings.encryptionMessage}</p> : null}
          {error ? <p className="model-manager-error">{error}</p> : null}
          {notice ? <p className="model-manager-success">{notice}</p> : null}
          <form className="model-form dify-settings-form" onSubmit={(event) => void saveAndVerify(event)}>
            <label>Dify 服务地址<input value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} required placeholder="https://api.dify.ai/v1" disabled={!settings?.canSave || saving} /></label>
            <label>知识库 ID<input value={form.datasetId} onChange={(event) => setForm((current) => ({ ...current, datasetId: event.target.value }))} required placeholder="Dify Dataset ID" disabled={!settings?.canSave || saving} /></label>
            <label>Dify API Key <small>{settings?.hasApiKey ? `当前已保存：${settings.apiKeyHint ?? "已配置"}；重新输入后将替换。` : "请使用该知识库对应的 Dataset API Key。"}</small><input value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} required type="password" maxLength={4000} placeholder="输入 Dataset API Key" disabled={!settings?.canSave || saving} /></label>
            <p className="dify-settings-help">保存后会立即校验 Dify 服务和知识库；首次接入请再执行一次“同步全部需求”。</p>
            <footer><button type="button" className="model-cancel" onClick={close}>关闭</button><button className="model-save" disabled={!settings?.canSave || saving}>{saving ? "保存并验证中…" : "保存并验证"}</button></footer>
          </form>
          <div className="dify-settings-sync"><div><b>知识库同步</b><small>{settings?.sync.lastError ? `最近错误：${settings.sync.lastError}` : "发布、版本恢复等变更会自动同步；可在此手动补齐。"}</small></div><button className="project-dialog-cancel" onClick={() => void syncAll()} disabled={!settings?.hasApiKey || syncing}>{syncing ? "同步中…" : "同步全部需求"}</button></div>
        </>}
      </div>
    </section>
  </div> : null;
}
