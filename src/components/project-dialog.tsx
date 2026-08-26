"use client";

import { FormEvent, useState } from "react";
import { Icon } from "@/components/icons";
import type { Project } from "@/lib/types";

type ProjectForm = { code: string; name: string; description: string; owner: string };
type ApiPayload<T> = { data?: T; error?: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json() as ApiPayload<T>;
  if (!response.ok || !payload.data) throw new Error(payload.error || "项目保存失败。");
  return payload.data;
}

export function ProjectDialog({ open, project, onClose, onSaved }: { open: boolean; project: Project | null; onClose: () => void; onSaved: (project: Project) => void }) {
  const [form, setForm] = useState<ProjectForm>(() => ({ code: project?.id ?? "", name: project?.name ?? "", description: project?.description ?? "", owner: project?.owner ?? "" }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = project
        ? await request<Project>(`/api/v1/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", body: JSON.stringify({ name: form.name, description: form.description, owner: form.owner }) })
        : await request<Project>("/api/v1/projects", { method: "POST", body: JSON.stringify({ code: form.code, name: form.name, description: form.description, owner: form.owner }) });
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return <div className="project-dialog-layer"><button className="project-dialog-backdrop" onClick={onClose} aria-label="关闭项目编辑" /><form className="project-dialog" onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
    <header><div><span className="project-dialog-kicker">项目目录</span><h2 id="project-dialog-title">{project ? "编辑项目" : "新增项目"}</h2><p>{project ? "修改项目名称、描述和负责人。" : "创建一个项目后，再从项目下发布需求。"}</p></div><button type="button" className="project-dialog-close" onClick={onClose} aria-label="关闭项目编辑"><Icon name="close" /></button></header>
    <div className="project-dialog-body">
      <label>项目编码<input value={form.code} onChange={(event) => setForm((value) => ({ ...value, code: event.target.value }))} readOnly={Boolean(project)} required maxLength={80} placeholder="例如：ERP" /></label>
      <label>项目名称<input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} required maxLength={120} placeholder="输入项目名称" /></label>
      <label>项目描述 <span className="project-dialog-optional">可选</span><textarea value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} maxLength={500} rows={3} placeholder="说明这个项目的范围或用途" /></label>
      <label>负责人 <span className="project-dialog-optional">可选</span><input value={form.owner} onChange={(event) => setForm((value) => ({ ...value, owner: event.target.value }))} maxLength={80} placeholder="输入负责人姓名" /></label>
      {error ? <p className="project-dialog-error">{error}</p> : null}
    </div>
    <footer><button type="button" className="project-dialog-cancel" onClick={onClose}>取消</button><button className="project-dialog-save" disabled={saving}>{saving ? "保存中…" : project ? "保存修改" : "创建项目"}</button></footer>
  </form></div>;
}
