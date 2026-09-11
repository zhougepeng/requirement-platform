"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import type { Project } from "@/lib/types";

type ApiPayload<T> = { data?: T; error?: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as ApiPayload<T>;
  if (!response.ok || payload.data === undefined) throw new Error(payload.error || "工作搭子配置保存失败。");
  return payload.data;
}

export function WorkbuddyProjectSettingsDialog({
  open,
  project,
  onClose,
  onSaved,
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [url, setUrl] = useState(project?.workbuddyUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open || !project) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!project) return;
    const selectedProject = project;
    setSaving(true);
    setError("");
    try {
      const saved = await request<Project>(`/api/v1/projects/${encodeURIComponent(selectedProject.id)}/workbuddy`, {
        method: "PATCH",
        body: JSON.stringify({ url }),
      });
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "工作搭子配置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="project-dialog-layer">
      <button className="project-dialog-backdrop" onClick={onClose} aria-label="关闭工作搭子配置" />
      <form className="project-dialog feature-ingress-dialog" onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="workbuddy-project-settings-title">
        <header>
          <div>
            <span className="project-dialog-kicker">项目配置 · {project.name}</span>
            <h2 id="workbuddy-project-settings-title">工作搭子配置</h2>
            <p>管理员配置一次后，项目成员可以直接使用；每个人仍使用自己的登录身份。</p>
          </div>
          <button type="button" className="project-dialog-close" onClick={onClose} aria-label="关闭工作搭子配置"><Icon name="close" /></button>
        </header>
        <div className="project-dialog-body">
          <label>
            工作搭子网址
            <input value={url} onChange={(event) => { setUrl(event.target.value); setError(""); }} placeholder="https://workbuddy.example.com" autoFocus />
          </label>
          <p className="project-dialog-hint">只保存项目入口地址，不保存个人会话、访问令牌或飞书凭证。清空后，项目成员将不能从需求库进入工作搭子。</p>
          {error ? <p className="project-dialog-error" role="alert">{error}</p> : null}
        </div>
        <footer>
          <button type="button" className="project-dialog-cancel" onClick={onClose}>取消</button>
          <button type="submit" className="project-dialog-save" disabled={saving}>{saving ? "保存中…" : "保存配置"}</button>
        </footer>
      </form>
    </div>
  );
}
