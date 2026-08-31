"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import type { NotificationTarget, ReleaseNotificationDraft, ReleaseNotificationPreference } from "@/lib/release-notification";
import type { Requirement, RequirementSummary } from "@/lib/types";

export type RequirementStatusValue = "offline" | "scheduled" | "online";
export type UpdateRequirementReleaseStatusInput = {
  status: RequirementStatusValue;
  scheduleVersion?: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
  releaseVersion?: string;
  releaseDate?: string;
};
type RequirementWithStatus = Pick<Requirement, "status" | "scheduleVersion" | "scheduledGrayDate" | "scheduledFullDate" | "releaseVersion" | "releaseDate"> | Pick<RequirementSummary, "status" | "scheduleVersion" | "scheduledGrayDate" | "scheduledFullDate" | "releaseVersion" | "releaseDate">;
type NotificationTargetCatalog = { targets: NotificationTarget[]; warnings: string[] };

function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function keyOf(target: NotificationTarget) { return `${target.kind}:${target.id}`; }
function statusLabel(status: RequirementStatusValue) { return status === "online" ? "已上线" : status === "scheduled" ? "已排期" : "未上线"; }
function actionLabel(kind: "online" | "scheduled") { return kind === "online" ? "上线" : "排期"; }

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error || "请求失败，请稍后重试。");
  return payload.data as T;
}

function targetKindLabel(target: NotificationTarget) {
  return target.kind === "user" ? "个人" : target.kind === "chat" ? "群聊" : target.kind === "department" ? "部门" : "全员";
}

function matchesTarget(target: NotificationTarget, query: string) {
  const value = query.trim().toLocaleLowerCase();
  return !value || `${target.name} ${targetKindLabel(target)}`.toLocaleLowerCase().includes(value);
}

function TargetSelectionDialog({ targets, options, onConfirm, onClose }: { targets: NotificationTarget[]; options: NotificationTarget[]; onConfirm: (targets: NotificationTarget[]) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(targets);
  const candidates = options.filter((target) => matchesTarget(target, query));
  function toggle(target: NotificationTarget) {
    setSelected((current) => current.some((item) => keyOf(item) === keyOf(target))
      ? current.filter((item) => keyOf(item) !== keyOf(target))
      : [...current, target]);
  }
  return createPortal(<div className="release-status-dialog-layer target-picker-dialog-layer" onClick={onClose}>
    <button className="release-status-dialog-backdrop" aria-label="关闭选择联系人" />
    <section className="target-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="target-picker-title" onClick={(event) => event.stopPropagation()}>
      <header><h2 id="target-picker-title">选择联系人</h2><button type="button" className="release-status-close" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>
      <div className="target-picker-dialog-body">
        <section className="target-picker-candidates">
          <label className="target-picker-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户、群组、部门或全员" autoFocus /></label>
          <small>可选对象</small>
          <div className="target-picker-option-list">{candidates.length ? candidates.map((target) => {
            const checked = selected.some((item) => keyOf(item) === keyOf(target));
            return <button type="button" className={checked ? "is-selected" : ""} key={keyOf(target)} onClick={() => toggle(target)}><span className={`target-picker-option-icon is-${target.kind}`}><Icon name={target.kind === "chat" ? "message" : "users"} /></span><span><b>{target.name}</b><small>{targetKindLabel(target)}</small></span><i>{checked ? "✓" : "+"}</i></button>;
          }) : <p>没有匹配的通知对象</p>}</div>
        </section>
        <section className="target-picker-selected"><b>已选：{selected.length} 个</b>{selected.length ? <div>{selected.map((target) => <span className="release-notification-chip" key={keyOf(target)}><small>{targetKindLabel(target)}</small>{target.name}<button type="button" onClick={() => toggle(target)} aria-label={`移除 ${target.name}`}>×</button></span>)}</div> : <p>从左侧搜索并选择通知对象</p>}</section>
      </div>
      <footer><button type="button" className="release-status-cancel" onClick={onClose}>取消</button><button type="button" className="release-status-confirm" onClick={() => { onConfirm(selected); onClose(); }}>确认</button></footer>
    </section>
  </div>, document.body);
}

function TargetPicker({ targets, options, disabled, onChange }: { targets: NotificationTarget[]; options: NotificationTarget[]; disabled?: boolean; onChange: (next: NotificationTarget[]) => void }) {
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const available = options.filter((option) => !targets.some((target) => keyOf(target) === keyOf(option)));
  const matches = available.filter((target) => matchesTarget(target, query)).slice(0, 8);
  function add(target: NotificationTarget) { onChange([...targets, target]); setQuery(""); }
  return <div className="release-notification-targets">
    <div className="release-notification-chips">{targets.length ? targets.map((target) => <span className="release-notification-chip" key={keyOf(target)}><small>{targetKindLabel(target)}</small>{target.name}<button type="button" disabled={disabled} onClick={() => onChange(targets.filter((item) => keyOf(item) !== keyOf(target)))} aria-label={`移除 ${target.name}`}>×</button></span>) : <span className="release-notification-empty">尚未选择通知对象</span>}</div>
    <div className="release-notification-target-search"><Icon name="search" /><input value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && matches.length === 1) { event.preventDefault(); add(matches[0]); } }} placeholder="搜索用户、群聊、部门或全员" aria-label="搜索通知对象" /><button type="button" disabled={disabled} onClick={() => setPickerOpen(true)} aria-label="打开通知对象选择器" title="选择通知对象"><Icon name="plus" /></button></div>
    {query.trim() ? <div className="release-notification-target-results" role="listbox">{matches.length ? matches.map((target) => <button type="button" role="option" aria-selected={false} key={keyOf(target)} onClick={() => add(target)}><span><b>{target.name}</b><small>{targetKindLabel(target)}</small></span><Icon name="plus" /></button>) : <p>没有匹配的通知对象</p>}</div> : null}
    {pickerOpen ? <TargetSelectionDialog targets={targets} options={options} onConfirm={onChange} onClose={() => setPickerOpen(false)} /> : null}
  </div>;
}

export function RequirementReleaseStatus({ requirement, requirementCode, projectId, canEdit, compact = false, onChange }: { requirement: RequirementWithStatus; requirementCode: string; projectId: string; canEdit?: boolean; compact?: boolean; onChange: (input: UpdateRequirementReleaseStatusInput) => Promise<void> }) {
  const status: RequirementStatusValue = requirement.status === "online" || requirement.status === "scheduled" ? requirement.status : "offline";
  const [dialogKind, setDialogKind] = useState<"online" | "scheduled" | null>(null);
  const [notificationKind, setNotificationKind] = useState<"online" | "scheduled" | null>(null);
  const [releaseVersion, setReleaseVersion] = useState(requirement.releaseVersion ?? "");
  const [releaseDate, setReleaseDate] = useState(requirement.releaseDate ?? today());
  const [scheduleVersion, setScheduleVersion] = useState(requirement.scheduleVersion ?? "");
  const [scheduledGrayDate, setScheduledGrayDate] = useState(requirement.scheduledGrayDate ?? today());
  const [scheduledFullDate, setScheduledFullDate] = useState(requirement.scheduledFullDate ?? today());
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [targets, setTargets] = useState<NotificationTarget[]>([]);
  const [targetOptions, setTargetOptions] = useState<NotificationTarget[]>([]);
  const [targetWarning, setTargetWarning] = useState("");
  const [draft, setDraft] = useState("");
  const [draftHint, setDraftHint] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingStatus, setEditingStatus] = useState(false);

  async function loadNotificationSetup() {
    try {
      const [preference, catalog] = await Promise.all([
        apiRequest<ReleaseNotificationPreference>(`/api/v1/projects/${encodeURIComponent(projectId)}/release-notification-preference`),
        apiRequest<NotificationTargetCatalog>("/api/v1/release-notifications/targets"),
      ]);
      setNotifyEnabled(preference.enabled); setTargets(preference.targets); setTargetOptions(catalog.targets); setTargetWarning(catalog.warnings.join(" "));
    } catch (reason) { setError(reason instanceof Error ? `通知对象读取失败：${reason.message}` : "通知对象读取失败。"); }
  }

  function openStatusDialog(kind: "online" | "scheduled", correction = false) {
    setError(""); setNotice(""); setTargetWarning(""); setEditingStatus(correction); setNotifyEnabled(!correction); setTargets([]); setTargetOptions([]);
    setReleaseVersion(requirement.releaseVersion ?? ""); setReleaseDate(requirement.releaseDate ?? today());
    setScheduleVersion(requirement.scheduleVersion ?? ""); setScheduledGrayDate(requirement.scheduledGrayDate ?? today()); setScheduledFullDate(requirement.scheduledFullDate ?? today());
    setDialogKind(kind); if (!correction) void loadNotificationSetup();
  }

  async function selectStatus(next: RequirementStatusValue) {
    if (!canEdit || saving || next === status) return;
    if (next === "online" || next === "scheduled") { openStatusDialog(next); return; }
    setError(""); setNotice(""); setSaving(true);
    try { await onChange({ status: "offline" }); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存需求状态失败。"); } finally { setSaving(false); }
  }

  function editCurrentStatus() {
    if (!canEdit || saving || (status !== "online" && status !== "scheduled")) return;
    openStatusDialog(status, true);
  }

  function valid(kind: "online" | "scheduled") {
    if (kind === "online") return Boolean(releaseVersion.trim() && releaseDate.trim());
    return Boolean(scheduleVersion.trim() && scheduledGrayDate.trim() && scheduledFullDate.trim());
  }

  function payload(kind: "online" | "scheduled"): UpdateRequirementReleaseStatusInput {
    return kind === "online"
      ? { status: "online", releaseVersion: releaseVersion.trim(), releaseDate: releaseDate.trim() }
      : { status: "scheduled", scheduleVersion: scheduleVersion.trim(), scheduledGrayDate: scheduledGrayDate.trim(), scheduledFullDate: scheduledFullDate.trim() };
  }

  async function buildDraft(kind: "online" | "scheduled") {
    setDraftLoading(true); setDraftHint("");
    try {
      const result = await apiRequest<ReleaseNotificationDraft>(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/release-notification/draft`, { method: "POST", body: JSON.stringify({ kind, ...payload(kind) }) });
      setDraft(result.content); setDraftHint(result.generationError ?? "");
    } catch (reason) { setDraft(""); setDraftHint(reason instanceof Error ? reason.message : "AI 通知文案生成失败。"); } finally { setDraftLoading(false); }
  }

  async function confirmStatus() {
    if (!dialogKind || saving) return;
    if (!valid(dialogKind)) { setError(dialogKind === "online" ? "请填写上线版本和上线时间。" : "请填写排期版本、预计灰度时间和预计全量时间。"); return; }
    setSaving(true); setError("");
    try {
      const correction = editingStatus;
      await onChange(payload(dialogKind));
      if (!correction) void apiRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/release-notification-preference`, { method: "PATCH", body: JSON.stringify({ enabled: notifyEnabled, targets }) }).catch(() => undefined);
      const kind = dialogKind;
      setDialogKind(null);
      setEditingStatus(false);
      if (correction) setNotice(`${actionLabel(kind)}信息已更新。`);
      else if (notifyEnabled && targets.length) { setNotificationKind(kind); void buildDraft(kind); }
      else if (notifyEnabled) setNotice(`${actionLabel(kind)}已保存，暂未发送通知：暂无可用通知对象。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : `保存${actionLabel(dialogKind)}信息失败。`); } finally { setSaving(false); }
  }

  async function sendNotification() {
    if (!notificationKind) return;
    if (!targets.length) { setError("请至少选择一个飞书通知对象。"); return; }
    if (!draft.trim()) { setError("通知内容不能为空。"); return; }
    setSending(true); setError("");
    try {
      await apiRequest(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/release-notification/send`, { method: "POST", body: JSON.stringify({ targets, content: draft }) });
      setNotificationKind(null); setNotice(`${actionLabel(notificationKind)}通知已发送`);
    } catch (reason) { setError(`需求已${actionLabel(notificationKind)}，但飞书通知发送失败：${reason instanceof Error ? reason.message : "请稍后重试。"}`); } finally { setSending(false); }
  }

  const statusDialog = dialogKind && typeof document !== "undefined" ? createPortal(<div className="release-status-dialog-layer" onClick={() => !saving && setDialogKind(null)}><button className="release-status-dialog-backdrop" aria-label="关闭状态设置" /><div className="release-status-dialog release-notification-dialog" role="dialog" aria-modal="true" aria-labelledby="release-status-dialog-title" onClick={(event) => event.stopPropagation()}><header><h2 id="release-status-dialog-title">{dialogKind === "online" ? "设置上线信息" : "设置排期信息"}</h2><button type="button" className="release-status-close" onClick={() => setDialogKind(null)} aria-label="关闭"><Icon name="close" /></button></header><div className="release-status-dialog-body">{dialogKind === "online" ? <><label>上线版本<input value={releaseVersion} onChange={(event) => setReleaseVersion(event.target.value)} placeholder="例如 V3.8.2" maxLength={80} autoFocus /></label><label>上线时间<input type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} /></label></> : <><label>排期版本<input value={scheduleVersion} onChange={(event) => setScheduleVersion(event.target.value)} placeholder="例如 V3.9.0" maxLength={80} autoFocus /></label><label>预计上线灰度时间<input type="date" value={scheduledGrayDate} onChange={(event) => setScheduledGrayDate(event.target.value)} /></label><label>预计上线全量时间<input type="date" value={scheduledFullDate} onChange={(event) => setScheduledFullDate(event.target.value)} /></label></>}<label className="release-notification-switch"><input type="checkbox" checked={notifyEnabled} onChange={(event) => setNotifyEnabled(event.target.checked)} /><span>{dialogKind === "online" ? "上线后发送飞书通知" : "排期后发送飞书通知"}</span></label>{notifyEnabled ? <label className="release-notification-label">通知对象<TargetPicker targets={targets} options={targetOptions} disabled={saving} onChange={setTargets} /></label> : null}{targetWarning ? <p className="release-notification-help is-warning">{targetWarning}</p> : null}{error ? <p className="release-status-error">{error}</p> : null}</div><footer><button type="button" className="release-status-cancel" onClick={() => setDialogKind(null)}>取消</button><button type="button" className="release-status-confirm" onClick={() => void confirmStatus()} disabled={saving}>{saving ? "保存中…" : `确认${actionLabel(dialogKind)}`}</button></footer></div></div>, document.body) : null;
  const notificationDialog = notificationKind && typeof document !== "undefined" ? createPortal(<div className="release-status-dialog-layer" onClick={() => !sending && setNotificationKind(null)}><button className="release-status-dialog-backdrop" aria-label="关闭通知确认" /><div className="release-status-dialog release-notification-dialog release-notification-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="release-notification-dialog-title" onClick={(event) => event.stopPropagation()}><header><div><h2 id="release-notification-dialog-title">确认{actionLabel(notificationKind)}通知</h2><small>发送前可修改通知对象和内容</small></div><button type="button" className="release-status-close" onClick={() => setNotificationKind(null)} aria-label="关闭"><Icon name="close" /></button></header><div className="release-status-dialog-body"><label className="release-notification-label">通知对象<TargetPicker targets={targets} options={targetOptions} disabled={sending} onChange={setTargets} /></label>{targetWarning ? <p className="release-notification-help is-warning">{targetWarning}</p> : null}<label className="release-notification-label">通知内容<textarea value={draft} disabled={draftLoading || sending} onChange={(event) => setDraft(event.target.value)} placeholder={draftLoading ? `正在根据当前需求生成${actionLabel(notificationKind)}通知…` : "请输入通知内容"} /></label>{draftLoading ? <p className="release-notification-help">正在根据当前需求的 PRD、Demo 和测试用例生成初稿…</p> : null}{draftHint ? <p className="release-notification-help is-warning">{draftHint}</p> : null}{error ? <p className="release-status-error">{error}</p> : null}</div><footer><button type="button" className="release-status-cancel" disabled={sending} onClick={() => setNotificationKind(null)}>暂不发送</button><button type="button" className="release-status-confirm" disabled={sending || draftLoading} onClick={() => void sendNotification()}>{sending ? "发送中…" : error ? "重新发送" : "发送通知"}</button></footer></div></div>, document.body) : null;

  const meta = status === "online" ? [requirement.releaseVersion, requirement.releaseDate].filter(Boolean).join(" · ") : status === "scheduled" ? [requirement.scheduleVersion, requirement.scheduledGrayDate && `灰度 ${requirement.scheduledGrayDate}`, requirement.scheduledFullDate && `全量 ${requirement.scheduledFullDate}`].filter(Boolean).join(" · ") : "";
  return <span className={`release-status ${compact ? "is-compact" : ""} is-${status}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{canEdit ? <span className="release-status-control"><select className="release-status-select" value={status} disabled={saving} onChange={(event) => void selectStatus(event.target.value as RequirementStatusValue)} aria-label="需求状态"><option value="offline">未上线</option><option value="scheduled">已排期</option><option value="online">已上线</option></select><span className="release-status-chevron" aria-hidden="true">⌄</span></span> : <span className="release-status-readonly">{statusLabel(status)}</span>}{canEdit && !compact && (status === "online" || status === "scheduled") ? <button type="button" className="release-status-edit" onClick={editCurrentStatus} disabled={saving} title={`修改${statusLabel(status)}信息`} aria-label={`修改${statusLabel(status)}信息`}><Icon name="edit" /></button> : null}{meta ? <small className="release-status-meta">{meta}</small> : null}{notice ? <span className="release-status-inline-success" role="status">{notice}</span> : null}{error && !dialogKind && !notificationKind ? <span className="release-status-inline-error" role="alert">{error}</span> : null}{statusDialog}{notificationDialog}</span>;
}
