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

function TargetPicker({ targets, options, disabled, onChange }: { targets: NotificationTarget[]; options: NotificationTarget[]; disabled?: boolean; onChange: (next: NotificationTarget[]) => void }) {
  const [selected, setSelected] = useState("");
  const available = options.filter((option) => !targets.some((target) => keyOf(target) === keyOf(option)));
  function add(value: string) { setSelected(""); const option = options.find((item) => keyOf(item) === value); if (option) onChange([...targets, option]); }
  return <div className="release-notification-targets"><div className="release-notification-chips">{targets.length ? targets.map((target) => <span className="release-notification-chip" key={keyOf(target)}><small>{target.kind === "user" ? "个人" : target.kind === "chat" ? "群" : target.kind === "department" ? "部门" : "全员"}</small>{target.name}<button type="button" disabled={disabled} onClick={() => onChange(targets.filter((item) => keyOf(item) !== keyOf(target)))} aria-label={`移除 ${target.name}`}>×</button></span>) : <span className="release-notification-empty">尚未选择通知对象</span>}</div><select className="release-notification-target-select" value={selected} disabled={disabled || !available.length} onChange={(event) => add(event.target.value)} aria-label="新增通知对象"><option value="">+ 添加个人、群、部门或全员</option>{available.map((option) => <option key={keyOf(option)} value={keyOf(option)}>{option.kind === "user" ? "个人" : option.kind === "chat" ? "群" : option.kind === "department" ? "部门" : "全员"} · {option.name}</option>)}</select></div>;
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

  async function loadNotificationSetup() {
    try {
      const [preference, catalog] = await Promise.all([
        apiRequest<ReleaseNotificationPreference>(`/api/v1/projects/${encodeURIComponent(projectId)}/release-notification-preference`),
        apiRequest<NotificationTargetCatalog>("/api/v1/release-notifications/targets"),
      ]);
      setNotifyEnabled(preference.enabled); setTargets(preference.targets); setTargetOptions(catalog.targets); setTargetWarning(catalog.warnings.join(" "));
    } catch (reason) { setError(reason instanceof Error ? `通知对象读取失败：${reason.message}` : "通知对象读取失败。"); }
  }

  function openStatusDialog(kind: "online" | "scheduled") {
    setError(""); setNotice(""); setTargetWarning(""); setNotifyEnabled(true); setTargets([]); setTargetOptions([]);
    setReleaseVersion(requirement.releaseVersion ?? ""); setReleaseDate(requirement.releaseDate ?? today());
    setScheduleVersion(requirement.scheduleVersion ?? ""); setScheduledGrayDate(requirement.scheduledGrayDate ?? today()); setScheduledFullDate(requirement.scheduledFullDate ?? today());
    setDialogKind(kind); void loadNotificationSetup();
  }

  async function selectStatus(next: RequirementStatusValue) {
    if (!canEdit || saving || next === status) return;
    if (next === "online" || next === "scheduled") { openStatusDialog(next); return; }
    setError(""); setNotice(""); setSaving(true);
    try { await onChange({ status: "offline" }); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存需求状态失败。"); } finally { setSaving(false); }
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
    if (notifyEnabled && !targets.length) { setError("请至少选择一个飞书通知对象，或取消发送通知。"); return; }
    setSaving(true); setError("");
    try {
      await onChange(payload(dialogKind));
      void apiRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/release-notification-preference`, { method: "PATCH", body: JSON.stringify({ enabled: notifyEnabled, targets }) }).catch(() => undefined);
      const kind = dialogKind;
      setDialogKind(null);
      if (notifyEnabled) { setNotificationKind(kind); void buildDraft(kind); }
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
  return <span className={`release-status ${compact ? "is-compact" : ""} is-${status}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{canEdit ? <span className="release-status-control"><select className="release-status-select" value={status} disabled={saving} onChange={(event) => void selectStatus(event.target.value as RequirementStatusValue)} aria-label="需求状态"><option value="offline">未上线</option><option value="scheduled">已排期</option><option value="online">已上线</option></select><span className="release-status-chevron" aria-hidden="true">⌄</span></span> : <span className="release-status-readonly">{statusLabel(status)}</span>}{meta ? <small className="release-status-meta">{meta}</small> : null}{notice ? <span className="release-status-inline-success" role="status">{notice}</span> : null}{error && !dialogKind && !notificationKind ? <span className="release-status-inline-error" role="alert">{error}</span> : null}{statusDialog}{notificationDialog}</span>;
}
