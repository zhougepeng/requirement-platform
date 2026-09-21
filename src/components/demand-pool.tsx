"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import type {
  DemandPoolCategory,
  DemandPoolDraft,
  DemandPoolItem,
  DemandPoolSource,
  DemandPoolSourceTable,
  DemandPoolSyncSummary,
  DemandPoolStatus,
  DemandPoolValue,
  Project,
} from "@/lib/types";

type ApiResponse<T> = { data: T; error?: never } | { data?: never; error: string };
type RelationRequirement = { code: string; title: string; projectName: string };

const CATEGORY_OPTIONS: DemandPoolCategory[] = ["新功能", "功能优化", "问题反馈", "客户诉求", "竞品信息", "其他"];
const VALUE_OPTIONS: DemandPoolValue[] = ["high", "medium", "low", "pending"];
const STATUS_OPTIONS: DemandPoolStatus[] = ["pending", "evaluating", "entered", "closed"];
const CATEGORY_LABELS: Record<DemandPoolCategory, string> = {
  新功能: "新功能",
  功能优化: "功能优化",
  问题反馈: "问题反馈",
  客户诉求: "客户诉求",
  竞品信息: "竞品信息",
  其他: "其他",
};
const VALUE_LABELS: Record<DemandPoolValue, string> = {
  high: "高",
  medium: "中",
  low: "低",
  pending: "待判断",
};
const STATUS_LABELS: Record<DemandPoolStatus, string> = {
  pending: "待评估",
  evaluating: "评估中",
  entered: "已进入需求",
  closed: "已关闭",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : "请求失败。");
  return body.data;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function projectName(projects: Project[], projectId?: string) {
  return projects.find((project) => project.id === projectId)?.name ?? "未关联项目";
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return <label className="demand-pool-field"><span>{label}</span>{children}</label>;
}

export function DemandPool({ projects, canEdit }: { projects: Project[]; canEdit?: boolean }) {
  const [items, setItems] = useState<DemandPoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("");
  const [draft, setDraft] = useState<DemandPoolDraft | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [sourceManagerOpen, setSourceManagerOpen] = useState(false);
  const [sources, setSources] = useState<DemandPoolSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceTables, setSourceTables] = useState<DemandPoolSourceTable[]>([]);
  const [sourceTableId, setSourceTableId] = useState("");
  const [inspectingSource, setInspectingSource] = useState(false);
  const [addingSource, setAddingSource] = useState(false);
  const [sourceSyncing, setSourceSyncing] = useState<string | null>(null);
  const [sourceDeleting, setSourceDeleting] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const relationRequirements = useMemo<RelationRequirement[]>(
    () => projects.flatMap((project) => project.requirements.map((requirement) => ({
      code: requirement.code,
      title: requirement.title,
      projectName: project.name,
    }))),
    [projects],
  );

  useEffect(() => {
    let cancelled = false;
    void request<DemandPoolItem[]>("/api/v1/demand-pool")
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "需求池读取失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void request<DemandPoolSource[]>("/api/v1/demand-pool/sources")
      .then((data) => {
        if (!cancelled) setSources(data);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "飞书来源读取失败。");
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function openEditor() {
    setSource("");
    setDraft(null);
    setError("");
    setNotice("");
    setEditorOpen(true);
  }

  function closeEditor() {
    if (recognizing || saving) return;
    setEditorOpen(false);
    setSource("");
    setDraft(null);
    setError("");
  }

  function openSourceManager() {
    setSourceUrl("");
    setSourceName("");
    setSourceTables([]);
    setSourceTableId("");
    setError("");
    setNotice("");
    setSourceManagerOpen(true);
  }

  function closeSourceManager() {
    if (inspectingSource || addingSource || sourceSyncing || sourceDeleting) return;
    setSourceManagerOpen(false);
    setError("");
  }

  async function inspectSource() {
    if (!sourceUrl.trim()) {
      setError("请先粘贴飞书多维表格链接。");
      return;
    }
    setInspectingSource(true);
    setError("");
    setSourceTables([]);
    setSourceTableId("");
    try {
      const result = await request<{ baseId: string; tables: DemandPoolSourceTable[] }>("/api/v1/demand-pool/sources", {
        method: "PUT",
        body: JSON.stringify({ url: sourceUrl }),
      });
      setSourceTables(result.tables);
      setSourceTableId(result.tables[0]?.tableId ?? "");
      if (!result.tables.length) setError("这个 Base 下没有可关联的数据表。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "飞书数据表解析失败。");
    } finally {
      setInspectingSource(false);
    }
  }

  async function addSource() {
    if (!sourceUrl.trim() || !sourceTableId) {
      setError("请先解析链接并选择数据表。");
      return;
    }
    setAddingSource(true);
    setError("");
    try {
      const saved = await request<DemandPoolSource>("/api/v1/demand-pool/sources", {
        method: "POST",
        body: JSON.stringify({ name: sourceName, url: sourceUrl, tableId: sourceTableId }),
      });
      setSources((current) => [saved, ...current]);
      setSourceUrl("");
      setSourceName("");
      setSourceTables([]);
      setSourceTableId("");
      setNotice("已关联飞书数据表，可以单独同步或全部同步。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "飞书来源保存失败。");
    } finally {
      setAddingSource(false);
    }
  }

  function syncSummaryText(summary: DemandPoolSyncSummary) {
    return "同步完成：新增 " + summary.created + " 条，更新 " + summary.updated + " 条，未变化 " + summary.unchanged + " 条，失败 " + summary.failed + " 条。";
  }

  async function syncSource(sourceId: string) {
    setSourceSyncing(sourceId);
    setError("");
    try {
      const result = await request<{ source: DemandPoolSource; summary: DemandPoolSyncSummary }>("/api/v1/demand-pool/sources/" + encodeURIComponent(sourceId), { method: "POST" });
      setSources((current) => current.map((source) => source.id === sourceId ? result.source : source));
      setItems(await request<DemandPoolItem[]>("/api/v1/demand-pool"));
      setNotice(syncSummaryText(result.summary));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "飞书同步失败。");
    } finally {
      setSourceSyncing(null);
    }
  }

  async function syncAllSources() {
    const enabledSources = sources.filter((source) => source.enabled);
    if (!enabledSources.length) {
      setNotice("还没有可同步的飞书数据表。");
      return;
    }
    setSourceSyncing("all");
    setError("");
    const total: DemandPoolSyncSummary = { created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };
    try {
      for (const sourceItem of enabledSources) {
        try {
          const result = await request<{ source: DemandPoolSource; summary: DemandPoolSyncSummary }>("/api/v1/demand-pool/sources/" + encodeURIComponent(sourceItem.id), { method: "POST" });
          setSources((current) => current.map((source) => source.id === sourceItem.id ? result.source : source));
          total.created += result.summary.created;
          total.updated += result.summary.updated;
          total.unchanged += result.summary.unchanged;
          total.failed += result.summary.failed;
        } catch (reason) {
          total.failed += 1;
          total.errors?.push(reason instanceof Error ? reason.message : "来源同步失败");
        }
      }
      setItems(await request<DemandPoolItem[]>("/api/v1/demand-pool"));
      setNotice(syncSummaryText(total));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "飞书同步失败。");
    } finally {
      setSourceSyncing(null);
    }
  }

  async function deleteSource(sourceId: string) {
    if (!window.confirm("删除这个飞书来源？已同步到需求池的记录不会被删除。")) return;
    setSourceDeleting(sourceId);
    setError("");
    try {
      await request<{ ok: true }>("/api/v1/demand-pool/sources/" + encodeURIComponent(sourceId), { method: "DELETE" });
      setSources((current) => current.filter((source) => source.id !== sourceId));
      setNotice("飞书来源已删除，已同步的需求池记录保留不变。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "飞书来源删除失败。");
    } finally {
      setSourceDeleting(null);
    }
  }

  async function recognize() {
    if (!source.trim()) {
      setError("请先粘贴一段需求内容。");
      return;
    }
    setRecognizing(true);
    setError("");
    setNotice("");
    try {
      const recognized = await request<DemandPoolDraft>("/api/v1/demand-pool/recognize", {
        method: "POST",
        body: JSON.stringify({ rawContent: source }),
      });
      setDraft(recognized);
      setNotice("已生成识别草稿，请确认后再保存。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "需求识别失败。");
    } finally {
      setRecognizing(false);
    }
  }

  async function save() {
    if (!draft || !source.trim()) {
      setError("请先粘贴内容并完成识别。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await request<DemandPoolItem>("/api/v1/demand-pool", {
        method: "POST",
        body: JSON.stringify({ ...draft, rawContent: source }),
      });
      setItems((current) => [saved, ...current]);
      setNotice("已保存到需求池。它不会自动创建正式需求。");
      setSource("");
      setDraft(null);
      setEditorOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "需求池保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(id: string, input: { status?: DemandPoolStatus; relatedRequirementCodes?: string[] }) {
    setBusyItemId(id);
    setError("");
    try {
      const updated = await request<DemandPoolItem>("/api/v1/demand-pool/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      setItems((current) => current.map((item) => item.id === id ? updated : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "需求池更新失败。");
    } finally {
      setBusyItemId(null);
    }
  }

  function updateDraft<K extends keyof DemandPoolDraft>(key: K, value: DemandPoolDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  return <section className="demand-pool-page" aria-label="需求池">
    <header className="demand-pool-header">
      <div>
        <h1 className="demand-pool-title">需求池</h1>
        <p>先收集市场需求，确认后再进入正式需求流程。</p>
      </div>
    {canEdit ? <div className="demand-pool-header-actions"><button className="secondary-button" onClick={openSourceManager}><Icon name="link" />关联飞书文档</button><button className="publish-button" onClick={openEditor}><Icon name="plus" />快速收集</button></div> : null}
    </header>

    {!editorOpen && !sourceManagerOpen && error ? <p className="demand-pool-message is-error" role="alert">{error}</p> : null}
    {!editorOpen && !sourceManagerOpen && notice ? <p className="demand-pool-message is-success" role="status">{notice}</p> : null}

    {sourceManagerOpen ? <div className="demand-pool-modal-layer" role="presentation">
      <section className="demand-pool-modal demand-pool-source-manager" role="dialog" aria-modal="true" aria-labelledby="demand-pool-source-title">
        <header>
          <div><h2 id="demand-pool-source-title">关联飞书文档</h2><span>支持关联多个飞书多维表格，首次同步后按记录增量更新。</span></div>
          <button className="icon-button" onClick={closeSourceManager} title="关闭" aria-label="关闭"><Icon name="close" /></button>
        </header>
        <div className="demand-pool-modal-body">
          {error ? <p className="demand-pool-message is-error" role="alert">{error}</p> : null}
          {notice ? <p className="demand-pool-message is-success" role="status">{notice}</p> : null}
          <div className="demand-pool-source-connect">
            <label className="demand-pool-field is-wide"><span>飞书 Base 链接</span><input value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setSourceTables([]); setSourceTableId(""); }} placeholder="粘贴 https://xxx.feishu.cn/base/... 链接" /></label>
            <div className="demand-pool-source-connect-actions"><button className="secondary-button" onClick={() => void inspectSource()} disabled={inspectingSource || addingSource}>{inspectingSource ? "解析中…" : "解析数据表"}</button></div>
            {sourceTables.length ? <>
              <label className="demand-pool-field is-wide"><span>选择数据表</span><select value={sourceTableId} onChange={(event) => setSourceTableId(event.target.value)}>{sourceTables.map((table) => <option key={table.tableId} value={table.tableId}>{table.name}</option>)}</select></label>
              <label className="demand-pool-field is-wide"><span>来源名称（可选）</span><input value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="默认使用数据表名称" maxLength={120} /></label>
              <button className="publish-button demand-pool-add-source" onClick={() => void addSource()} disabled={addingSource}>{addingSource ? "保存中…" : "保存这个来源"}</button>
            </> : null}
          </div>
          <div className="demand-pool-source-list-head"><strong>已关联来源</strong><button className="secondary-button" onClick={() => void syncAllSources()} disabled={sourceSyncing !== null || sourcesLoading || !sources.length}><Icon name="refresh" />{sourceSyncing === "all" ? "同步中…" : "全部同步"}</button></div>
          {sourcesLoading ? <p className="demand-pool-empty">正在读取来源…</p> : sources.length ? <div className="demand-pool-source-list">
            {sources.map((sourceItem) => <article className="demand-pool-source-item" key={sourceItem.id}>
              <div className="demand-pool-source-item-main"><strong>{sourceItem.name}</strong><span>{sourceItem.tableName}</span><small>{sourceItem.lastSyncedAt ? "上次同步 " + formatDate(sourceItem.lastSyncedAt) : "尚未同步"}{sourceItem.lastSyncSummary ? " · 新增 " + sourceItem.lastSyncSummary.created + " · 更新 " + sourceItem.lastSyncSummary.updated : ""}</small></div>
              <div className="demand-pool-source-item-actions"><button className="icon-text-button" onClick={() => void syncSource(sourceItem.id)} disabled={sourceSyncing !== null || sourceDeleting !== null} title="同步这个来源"><Icon name="refresh" />{sourceSyncing === sourceItem.id ? "同步中…" : "同步"}</button><button className="icon-button" onClick={() => void deleteSource(sourceItem.id)} disabled={sourceSyncing !== null || sourceDeleting !== null} title="删除来源" aria-label="删除来源"><Icon name="trash" /></button></div>
            </article>)}
          </div> : <p className="demand-pool-empty">还没有关联飞书数据表。</p>}
        </div>
      </section>
    </div> : null}

    {editorOpen ? <div className="demand-pool-modal-layer" role="presentation">
      <section className="demand-pool-modal demand-pool-editor" role="dialog" aria-modal="true" aria-labelledby="demand-pool-editor-title">
      <header>
        <div><h2 id="demand-pool-editor-title">快速收集</h2><span>粘贴飞书文档、Excel 或聊天文本，识别结果保存前仍可修改。</span></div>
        <button className="icon-button" onClick={closeEditor} title="关闭" aria-label="关闭"><Icon name="close" /></button>
      </header>
      {error ? <p className="demand-pool-message is-error demand-pool-modal-message" role="alert">{error}</p> : null}
      {notice ? <p className="demand-pool-message is-success demand-pool-modal-message" role="status">{notice}</p> : null}
      <div className="demand-pool-source-row">
        <label className="demand-pool-source-label" htmlFor="demand-pool-source">原始内容</label>
        <textarea id="demand-pool-source" value={source} onChange={(event) => {
          setSource(event.target.value);
          if (draft) {
            setDraft(null);
            setNotice("");
          }
        }} placeholder="把需求原文粘贴到这里" maxLength={100000} />
        <div className="demand-pool-editor-actions">
          <small>{source.length.toLocaleString()} / 100,000</small>
          <button className="publish-button" onClick={() => void recognize()} disabled={recognizing || saving || !source.trim()}><Icon name="sparkles" />{recognizing ? "识别中…" : "识别需求"}</button>
        </div>
      </div>
      {draft ? <div className="demand-pool-draft">
        <div className="demand-pool-draft-head"><div><h3>识别草稿</h3><span>确认保存后才会进入需求池，不会创建正式需求。</span></div><span className="demand-pool-draft-state">待确认</span></div>
        <div className="demand-pool-fields">
          <FieldLabel label="需求标题"><input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} maxLength={160} /></FieldLabel>
          <FieldLabel label="分类"><select value={draft.category} onChange={(event) => updateDraft("category", event.target.value as DemandPoolCategory)}>{CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{CATEGORY_LABELS[option]}</option>)}</select></FieldLabel>
          <FieldLabel label="所属项目"><select value={draft.projectId ?? ""} onChange={(event) => updateDraft("projectId", event.target.value || undefined)}><option value="">暂不关联</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></FieldLabel>
          <FieldLabel label="价值"><select value={draft.value} onChange={(event) => updateDraft("value", event.target.value as DemandPoolValue)}>{VALUE_OPTIONS.map((option) => <option key={option} value={option}>{VALUE_LABELS[option]}</option>)}</select></FieldLabel>
          <FieldLabel label="提出人"><input value={draft.proposer ?? ""} onChange={(event) => updateDraft("proposer", event.target.value || undefined)} maxLength={80} /></FieldLabel>
          <label className="demand-pool-field is-wide"><span>需求详情</span><textarea value={draft.detail} onChange={(event) => updateDraft("detail", event.target.value)} maxLength={20000} /></label>
        </div>
        <footer className="demand-pool-draft-actions"><button className="project-dialog-cancel" onClick={closeEditor} disabled={saving}>取消</button><button className="publish-button" onClick={() => void save()} disabled={saving}><Icon name="check" />{saving ? "保存中…" : "确认并保存"}</button></footer>
      </div> : null}
      </section>
    </div> : null}

    <section className="demand-pool-list-section">
      <header className="demand-pool-list-header"><div><h2>需求记录</h2><span>{items.length} 条</span></div><small>需求池记录与正式需求分开维护</small></header>
      {loading ? <p className="demand-pool-empty">正在读取需求池…</p> : items.length === 0 ? <p className="demand-pool-empty">暂无需求，点击“快速收集”开始。</p> : <div className="demand-pool-table" role="table" aria-label="需求池记录">
        <div className="demand-pool-table-head" role="row"><span>需求</span><span>分类</span><span>项目</span><span>价值</span><span>提出人</span><span>关联需求</span><span>状态</span><span>创建时间</span></div>
        {items.map((item) => <article className="demand-pool-row" key={item.id} role="row">
          <div className="demand-pool-main-cell"><strong title={item.title}>{item.title}</strong><small title={item.detail}>{item.detail || "暂无详情"}</small><details><summary>查看原始内容</summary><pre>{item.rawContent}</pre></details></div>
          <span className="demand-pool-cell" data-label="分类">{CATEGORY_LABELS[item.category]}</span>
          <span className="demand-pool-cell" data-label="项目">{projectName(projects, item.projectId)}</span>
          <span className="demand-pool-cell demand-pool-value" data-label="价值">{VALUE_LABELS[item.value]}</span>
          <span className="demand-pool-cell" data-label="提出人">{item.proposer || "未填写"}</span>
          <details className="demand-pool-relations">
            <summary>{item.relatedRequirementCodes.length ? "已关联 " + item.relatedRequirementCodes.length + " 条" : "关联需求"}</summary>
            <div className="demand-pool-relation-popover">
              {relationRequirements.length ? relationRequirements.map((requirement) => <label key={requirement.code}><input type="checkbox" checked={item.relatedRequirementCodes.includes(requirement.code)} disabled={!canEdit || busyItemId === item.id} onChange={(event) => {
                const next = event.target.checked ? [...item.relatedRequirementCodes, requirement.code] : item.relatedRequirementCodes.filter((code) => code !== requirement.code);
                void updateItem(item.id, { relatedRequirementCodes: [...new Set(next)] });
              }} /><span><b>{requirement.code}</b><small>{requirement.title} · {requirement.projectName}</small></span></label>) : <p>暂无可关联的正式需求</p>}
            </div>
          </details>
          <label className="demand-pool-status-control"><span className="sr-only">修改状态</span><select value={item.status} disabled={!canEdit || busyItemId === item.id} onChange={(event) => void updateItem(item.id, { status: event.target.value as DemandPoolStatus })}>{STATUS_OPTIONS.map((option) => <option key={option} value={option}>{STATUS_LABELS[option]}</option>)}</select></label>
          <time className="demand-pool-cell" dateTime={item.createdAt} data-label="创建时间">{formatDate(item.createdAt)}</time>
        </article>)}
      </div>}
    </section>
  </section>;
}
