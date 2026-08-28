"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import type { Requirement, RequirementSummary } from "@/lib/types";
export type UpdateRequirementReleaseStatusInput = { status: "offline" | "online"; releaseVersion?: string; releaseDate?: string };

type StatusValue = "offline" | "online";
type RequirementWithRelease = Pick<Requirement, "status" | "releaseVersion" | "releaseDate"> | Pick<RequirementSummary, "status" | "releaseVersion" | "releaseDate">;

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function RequirementReleaseStatus({
  requirement,
  canEdit,
  compact = false,
  onChange,
}: {
  requirement: RequirementWithRelease;
  canEdit?: boolean;
  compact?: boolean;
  onChange: (input: UpdateRequirementReleaseStatusInput) => Promise<void>;
}) {
  const status: StatusValue = requirement.status === "online" ? "online" : "offline";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [releaseVersion, setReleaseVersion] = useState(requirement.releaseVersion ?? "");
  const [releaseDate, setReleaseDate] = useState(requirement.releaseDate ?? today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function selectStatus(next: StatusValue) {
    if (!canEdit || saving || next === status) return;
    if (next === "offline") {
      setError("");
      setSaving(true);
      try {
        await onChange({ status: "offline" });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "保存需求状态失败。");
      } finally {
        setSaving(false);
      }
      return;
    }
    setError("");
    setReleaseVersion(requirement.releaseVersion ?? "");
    setReleaseDate(requirement.releaseDate ?? today());
    setDialogOpen(true);
  }

  async function confirmOnline() {
    const version = releaseVersion.trim();
    const date = releaseDate.trim();
    if (!version || !date || saving) {
      setError("请填写上线版本和上线时间。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onChange({ status: "online", releaseVersion: version, releaseDate: date });
      setDialogOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存上线信息失败。");
    } finally {
      setSaving(false);
    }
  }

  return <span className={`release-status ${compact ? "is-compact" : ""} ${status === "online" ? "is-online" : "is-offline"}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    {canEdit ? <span className="release-status-control"><select className="release-status-select" value={status} disabled={saving} onChange={(event) => void selectStatus(event.target.value as StatusValue)} aria-label="需求上线状态">
      <option value="offline">未上线</option>
      <option value="online">已上线</option>
    </select><span className="release-status-chevron" aria-hidden="true">⌄</span></span> : <span className="release-status-readonly">{status === "online" ? "已上线" : "未上线"}</span>}
    {status === "online" && (requirement.releaseVersion || requirement.releaseDate) ? <small className="release-status-meta">{[requirement.releaseVersion, requirement.releaseDate].filter(Boolean).join(" · ")}</small> : null}
    {dialogOpen && typeof document !== "undefined" ? createPortal(<div className="release-status-dialog-layer" onClick={() => !saving && setDialogOpen(false)}><button className="release-status-dialog-backdrop" aria-label="关闭上线信息" /><div className="release-status-dialog" role="dialog" aria-modal="true" aria-labelledby="release-status-dialog-title" onClick={(event) => event.stopPropagation()}>
      <header><div><h2 id="release-status-dialog-title">设置上线信息</h2></div><button type="button" className="release-status-close" onClick={() => setDialogOpen(false)} aria-label="关闭"><Icon name="close" /></button></header>
      <div className="release-status-dialog-body"><label>上线版本<input value={releaseVersion} onChange={(event) => setReleaseVersion(event.target.value)} placeholder="例如 V3.8.2" maxLength={80} autoFocus /></label><label>上线时间<input type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} /></label>{error ? <p className="release-status-error">{error}</p> : null}</div>
      <footer><button type="button" className="release-status-cancel" onClick={() => setDialogOpen(false)}>取消</button><button type="button" className="release-status-confirm" onClick={() => void confirmOnline()} disabled={saving}>{saving ? "保存中…" : "确认上线"}</button></footer>
    </div></div>, document.body) : null}
    {error && !dialogOpen ? <span className="release-status-inline-error" role="alert">{error}</span> : null}
  </span>;
}
