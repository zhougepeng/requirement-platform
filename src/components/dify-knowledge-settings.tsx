"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/icons";

type MemorySettings = {
  baseUrl: string;
  bankId: string;
  source: "managed" | "environment";
  hasToken: boolean;
  tokenHint?: string;
  canSave: boolean;
  encryptionMessage?: string;
  sync: { totalDocuments: number; failedDocuments: number; lastError?: string };
  verification?: { bankId: string; memoryCount?: number };
  syncResult?: { total: number; synced: number; failed: Array<{ requirementCode: string; error: string }> };
};

type MemoryForm = { baseUrl: string; bankId: string; token: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json() as { data?: T; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error || "项目记忆配置请求失败。");
  return body.data;
}

export function DifyKnowledgeSettings({ initialOpen = false, onClose }: { initialOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(initialOpen);
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [form, setForm] = useState<MemoryForm>({ baseUrl: "", bankId: "", token: "" });
  const [loading, setLoading] = useState(initialOpen);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const next = await request<MemorySettings>("/api/v1/admin/memory");
      setSettings(next);
      setForm((current) => ({ baseUrl: current.baseUrl || next.baseUrl, bankId: current.bankId || next.bankId, token: "" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取项目记忆配置。");
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
      const saved = await request<MemorySettings>("/api/v1/admin/memory", { method: "PUT", body: JSON.stringify(form) });
      setSettings(saved);
      setForm((current) => ({ ...current, token: "" }));
      const verified = await request<MemorySettings>("/api/v1/admin/memory", { method: "POST", body: JSON.stringify({ action: "verify" }) });
      setSettings(verified);
      setNotice("已保存并验证项目记忆连接。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存或验证项目记忆配置失败。");
    } finally {
      setSaving(false);
    }
  }

  async function syncAll() {
    if (syncing || !settings?.hasToken) return;
    if (!window.confirm("将把当前所有已上线和已排期需求同步到项目记忆，是否继续？")) return;
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const result = await request<MemorySettings>("/api/v1/admin/memory", { method: "POST", body: JSON.stringify({ action: "sync" }) });
      setSettings(result);
      const syncResult = result.syncResult;
      setNotice(syncResult ? `同步完成：${syncResult.synced}/${syncResult.total} 个需求成功。` : "同步任务已完成。");
      if (syncResult?.failed.length) setError(`仍有 ${syncResult.failed.length} 个需求未同步，请根据下方错误信息重试。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "同步项目记忆失败。");
    } finally {
      setSyncing(false);
    }
  }

  return open ? <div className="model-manager-layer" role="presentation">
    <button className="model-manager-backdrop" aria-label="关闭项目记忆设置" onClick={close} />
    <section className="model-manager-dialog dify-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="dify-settings-title">
      <header><div><h2 id="dify-settings-title">项目记忆</h2><p>管理员配置需求智能体的记忆系统。凭证只保存于服务器端。</p></div><button className="model-manager-close" onClick={close} aria-label="关闭项目记忆设置"><Icon name="close" /></button></header>
      <div className="model-manager-body">
        {loading && !settings ? <p className="model-manager-empty">正在读取项目记忆配置…</p> : <>
          <div className="dify-settings-status">
            <div><span>配置来源</span><b>{settings?.hasToken ? (settings.source === "managed" ? "管理员设置" : "部署环境变量") : "未配置"}</b></div>
            <div><span>知识库同步</span><b>{settings?.sync.failedDocuments ? `${settings.sync.failedDocuments} 个文档待重试` : `${settings?.sync.totalDocuments ?? 0} 个文档已记录`}</b></div>
          </div>
          {settings?.encryptionMessage ? <p className="model-manager-error">{settings.encryptionMessage}</p> : null}
          {error ? <p className="model-manager-error">{error}</p> : null}
          {notice ? <p className="model-manager-success">{notice}</p> : null}
          <form className="model-form dify-settings-form" onSubmit={(event) => void saveAndVerify(event)}>
            <label>记忆服务地址<input value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} required placeholder="https://ai.qpww.cn/hindsight" disabled={!settings?.canSave || saving} /></label>
            <label>Bank ID<input value={form.bankId} onChange={(event) => setForm((current) => ({ ...current, bankId: event.target.value }))} required placeholder="记忆空间 Bank ID" disabled={!settings?.canSave || saving} /></label>
            <label>访问凭证 <small>{settings?.hasToken ? `当前已保存：${settings.tokenHint ?? "已配置"}；重新输入后将替换。` : "请粘贴该 Agent 专属的 Hindsight 读写凭证；只读凭证不能同步需求。"}</small><input value={form.token} onChange={(event) => setForm((current) => ({ ...current, token: event.target.value }))} required type="password" maxLength={4000} placeholder="输入 Hindsight 凭证" disabled={!settings?.canSave || saving} /></label>
            <p className="dify-settings-help">保存后会立即验证记忆空间；可手动同步已上线和已排期需求。未上线需求不会写入。</p>
            <footer><button type="button" className="model-cancel" onClick={close}>关闭</button><button className="model-save" disabled={!settings?.canSave || saving}>{saving ? "保存并验证中…" : "保存并验证"}</button></footer>
          </form>
          <div className="dify-settings-sync"><div><b>项目记忆同步</b><small>{settings?.sync.lastError ? `最近错误：${settings.sync.lastError}` : "发布、排期、上线或版本恢复后会自动同步；也可手动补齐。"}</small></div><button className="project-dialog-cancel" onClick={() => void syncAll()} disabled={!settings?.hasToken || syncing}>{syncing ? "同步中…" : "同步已上线 / 已排期"}</button></div>
        </>}
      </div>
    </section>
  </div> : null;
}
