"use client";

import { useState } from "react";

export function SnapshotPublishDialog({ requirementCode, open, onClose, onPublished }: { requirementCode: string; open: boolean; onClose: () => void; onPublished: () => void }) {
  const [archive, setArchive] = useState<File | null>(null);
  const [summary, setSummary] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!open) return null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!archive || !summary.trim()) { setError("请选择需求资产 ZIP，并填写版本说明。"); return; }
    setSaving(true); setError("");
    try {
      const data = new FormData(); data.set("archive", archive); data.set("change_summary", summary.trim()); if (name.trim()) data.set("version_name", name.trim());
      const response = await fetch(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/versions`, { method: "POST", body: data });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "发布失败。");
      onPublished(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "发布失败。"); } finally { setSaving(false); }
  }
  return <div className="project-dialog-layer"><button className="project-dialog-backdrop" onClick={onClose} aria-label="关闭发布版本" /><form className="project-dialog" onSubmit={submit}><header><div><span className="project-dialog-kicker">需求资产仓库</span><h2>发布新版本</h2><p>ZIP 需包含 PRD.md 或 prd/ 下的 Markdown 文件，以及 demo/ 下的 HTML 文件；图片、脚本和附件会一并保存。</p></div><button className="project-dialog-close" type="button" onClick={onClose}>×</button></header><div className="project-dialog-body"><label>需求资产 ZIP<input type="file" accept=".zip,application/zip" onChange={(event) => setArchive(event.target.files?.[0] ?? null)} /></label><label>版本说明<input value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1000} placeholder="说明本次变更" /></label><label>版本名称 <span className="project-dialog-optional">可选</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="例如：飞书登录完善" /></label>{error ? <p className="project-dialog-error">{error}</p> : null}</div><footer><button type="button" className="project-dialog-cancel" onClick={onClose}>取消</button><button className="project-dialog-save" disabled={saving}>{saving ? "发布中…" : "发布版本"}</button></footer></form></div>;
}
