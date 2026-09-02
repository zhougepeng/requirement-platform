"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import type { NotificationTarget } from "@/lib/release-notification";

type NotificationTargetCatalog = {
  targets: NotificationTarget[];
  warnings: string[];
};

function keyOf(target: NotificationTarget) {
  return `${target.kind}:${target.id}`;
}

function kindLabel(target: NotificationTarget) {
  return target.kind === "user" ? "人员" : target.kind === "chat" ? "群聊" : target.kind === "department" ? "部门" : "全员";
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error || "请求失败，请稍后重试。");
  return payload.data as T;
}

export function RequirementShareDialog({
  open,
  requirementCode,
  requirementTitle,
  onClose,
  onSent,
}: {
  open: boolean;
  requirementCode: string;
  requirementTitle: string;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [targets, setTargets] = useState<NotificationTarget[]>([]);
  const [options, setOptions] = useState<NotificationTarget[]>([]);
  const [query, setQuery] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    void request<NotificationTargetCatalog>("/api/v1/release-notifications/targets")
      .then((catalog) => {
        if (!active) return;
        setOptions(catalog.targets);
        setWarnings(catalog.warnings);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "无法读取可选对象。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const candidates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return options
      .filter((target) => !targets.some((item) => keyOf(item) === keyOf(target)))
      .filter((target) => !normalized || `${target.name} ${kindLabel(target)}`.toLocaleLowerCase().includes(normalized))
      .slice(0, 12);
  }, [options, query, targets]);

  if (!open || typeof document === "undefined") return null;
  const requirementUrl = `${window.location.origin}/r/${encodeURIComponent(requirementCode)}`;

  function add(target: NotificationTarget) {
    setTargets((current) => [...current, target]);
    setQuery("");
  }

  function remove(target: NotificationTarget) {
    setTargets((current) => current.filter((item) => keyOf(item) !== keyOf(target)));
  }

  async function send() {
    if (!targets.length || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await request<{ deliveredCount: number }>(
        `/api/v1/requirements/${encodeURIComponent(requirementCode)}/share`,
        { method: "POST", body: JSON.stringify({ targets }) },
      );
      onSent(`已分享给 ${result.deliveredCount} 个接收对象。`);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分享发送失败，请稍后重试。");
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="release-status-dialog-layer" onClick={() => !sending && onClose()}>
      <button className="release-status-dialog-backdrop" aria-label="关闭分享需求" />
      <section className="release-status-dialog requirement-share-dialog" role="dialog" aria-modal="true" aria-labelledby="requirement-share-title" onClick={(event) => event.stopPropagation()}>
        <header><div><h2 id="requirement-share-title">分享需求</h2><small>选择人员、群聊、部门或全员后发送当前需求链接。</small></div><button type="button" className="release-status-close" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>
        <div className="release-status-dialog-body">
          <div className="requirement-share-preview"><Icon name="file" /><div><b>{requirementTitle}</b><small>{requirementUrl}</small></div></div>
          <label className="release-notification-label">接收对象
            <div className="release-notification-chips">{targets.length ? targets.map((target) => <span className="release-notification-chip" key={keyOf(target)}><small>{kindLabel(target)}</small>{target.name}<button type="button" onClick={() => remove(target)} aria-label={`移除 ${target.name}`}>×</button></span>) : <span className="release-notification-empty">尚未选择接收对象</span>}</div>
          </label>
          <label className="release-notification-target-search"><Icon name="search" /><input value={query} disabled={loading || sending} onChange={(event) => setQuery(event.target.value)} placeholder="输入姓名、群聊、部门或全员" autoFocus /><span aria-hidden="true"><Icon name="plus" /></span></label>
          <div className="release-notification-target-results requirement-share-results">{loading ? <p>正在读取可选对象…</p> : candidates.length ? candidates.map((target) => <button type="button" key={keyOf(target)} onClick={() => add(target)} disabled={sending}><span><b>{target.name}</b><small>{kindLabel(target)}</small></span><Icon name="plus" /></button>) : <p>{query.trim() ? "没有匹配的接收对象" : "暂无可选对象"}</p>}</div>
          {warnings.map((warning) => <p className="release-notification-help is-warning" key={warning}>{warning}</p>)}
          {error ? <p className="release-status-error">{error}</p> : null}
        </div>
        <footer><button type="button" className="release-status-cancel" disabled={sending} onClick={onClose}>取消</button><button type="button" className="release-status-confirm" disabled={sending || !targets.length} onClick={() => void send()}>{sending ? "发送中…" : "发送分享"}</button></footer>
      </section>
    </div>,
    document.body,
  );
}
