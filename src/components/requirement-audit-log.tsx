"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import type { RequirementAuditAction, RequirementAuditLog } from "@/lib/types";

const ACTIONS: Array<[RequirementAuditAction, string]> = [
  ["login_platform", "登录需求库"],
  ["view_requirement", "查看需求"], ["update_release_status", "更新上线状态"],
  ["archive_requirement", "作废需求"], ["restore_requirement", "恢复需求"],
  ["publish_requirement", "发布需求"], ["publish_version", "发布新版本"],
  ["create_comment", "发表评论"], ["update_comment", "编辑评论"], ["delete_comment", "删除评论"],
  ["create_discussion", "发起讨论"], ["update_discussion", "编辑讨论"], ["delete_discussion", "删除讨论"],
  ["process_discussion", "处理讨论"],
];

type Props = { requirementCode?: string; requirementTitle?: string; open?: boolean; onClose?: () => void };
type AuditLogPage = { items: RequirementAuditLog[]; nextCursor?: string };
const AUDIT_LOG_PAGE_SIZE = 50;

function useAuditLogs(requirementCode?: string, open = true) {
  const [logs, setLogs] = useState<RequirementAuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState<RequirementAuditAction | "">("");
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (requirementCode) params.set("requirement_code", requirementCode);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (actor.trim()) params.set("actor", actor.trim());
    if (action) params.set("action", action);
    return params.toString();
  }, [action, actor, from, requirementCode, to]);
  const loadPage = useCallback(async (cursor?: string, append = false) => {
    if (!open) return;
    if (append) setLoadingMore(true);
    else { setLoading(true); setNextCursor(undefined); }
    setError("");
    try {
      const params = new URLSearchParams(query);
      params.set("limit", String(AUDIT_LOG_PAGE_SIZE));
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/v1/audit-logs?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as { data?: AuditLogPage; error?: string };
      if (!response.ok || body.error) throw new Error(body.error || "日志读取失败。");
      const page = body.data ?? { items: [] };
      setLogs((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "日志读取失败。");
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [open, query]);
  const load = useCallback(() => loadPage(), [loadPage]);
  const loadMore = useCallback(() => {
    if (!nextCursor || loading || loadingMore) return;
    void loadPage(nextCursor, true);
  }, [loadPage, loading, loadingMore, nextCursor]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  return { logs, loading, loadingMore, nextCursor, error, from, setFrom, to, setTo, actor, setActor, action, setAction, load, loadMore };
}

function AuditFilters({ state }: { state: ReturnType<typeof useAuditLogs> }) {
  return <div className="audit-log-toolbar">
    <label><span>开始日期</span><input type="date" value={state.from} onChange={(event) => state.setFrom(event.target.value)} /></label>
    <label><span>结束日期</span><input type="date" value={state.to} onChange={(event) => state.setTo(event.target.value)} /></label>
    <label><span>姓名</span><input value={state.actor} onChange={(event) => state.setActor(event.target.value)} placeholder="输入姓名" /></label>
    <label><span>操作类型</span><select value={state.action} onChange={(event) => state.setAction(event.target.value as RequirementAuditAction | "")}><option value="">全部操作</option>{ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <button className="primary-button" onClick={() => void state.load()}>查询</button>
    <button className="secondary-button" onClick={() => { state.setFrom(""); state.setTo(""); state.setActor(""); state.setAction(""); }}>重置</button>
  </div>;
}

function AuditRows({ logs, loading, loadingMore, nextCursor, error, onLoadMore }: { logs: RequirementAuditLog[]; loading: boolean; loadingMore: boolean; nextCursor?: string; error: string; onLoadMore?: () => void }) {
  if (loading) return <div className="audit-log-empty">正在读取日志…</div>;
  if (error) return <div className="audit-log-empty audit-log-error">{error}</div>;
  if (!logs.length) return <div className="audit-log-empty">暂无匹配日志</div>;
  return <>
    <div className="audit-log-list">{logs.map((log) => <article className="audit-log-row" key={log.id}>
    <div className="audit-log-avatar">{log.actorName.slice(0, 1)}</div>
    <div className="audit-log-main"><div><strong>{log.actorName}</strong><span className="audit-log-action">{log.actionLabel}</span><b>{log.requirementTitle}</b>{log.requirementCode ? <code>{log.requirementCode}</code> : null}</div><small>{log.projectName}{log.detail ? ` · ${log.detail}` : ""}</small></div>
    <time>{log.createdAt}</time>
    </article>)}</div>
    {nextCursor && onLoadMore ? <div className="audit-log-pagination"><button className="secondary-button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更多"}</button></div> : null}
  </>;
}

export function RequirementAuditLogPage() {
  const state = useAuditLogs();
  return <section className="audit-log-page"><header className="page-section-header"><div><span className="page-kicker">审计追踪</span><h1>系统日志</h1><p>记录登录、需求查看、状态更新、评论、讨论和发布等操作。</p></div><Icon name="messages" /></header><AuditFilters state={state} /><AuditRows logs={state.logs} loading={state.loading} loadingMore={state.loadingMore} nextCursor={state.nextCursor} onLoadMore={state.loadMore} error={state.error} /></section>;
}

export function RequirementAuditLogDrawer({ open, onClose, requirementCode, requirementTitle }: Props) {
  const state = useAuditLogs(requirementCode, open);
  if (!open) return null;
  return <div className="audit-log-drawer-layer"><button className="audit-log-drawer-backdrop" onClick={onClose} aria-label="关闭需求日志" /><aside className="audit-log-drawer" role="dialog" aria-modal="true" aria-labelledby="audit-log-drawer-title"><header><div><span className="page-kicker">审计追踪</span><h2 id="audit-log-drawer-title">需求日志</h2><p>{requirementTitle || requirementCode}</p></div><button className="icon-button" onClick={onClose} aria-label="关闭需求日志"><Icon name="close" /></button></header><div className="audit-log-drawer-body"><AuditRows logs={state.logs} loading={state.loading} loadingMore={state.loadingMore} nextCursor={state.nextCursor} onLoadMore={state.loadMore} error={state.error} /></div></aside></div>;
}
