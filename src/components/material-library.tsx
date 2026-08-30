"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { Project } from "@/lib/types";

type MaterialScope = "project" | "public";
type MaterialOrigin = "manual" | "system_generated";
type Material = { id: string; scope: MaterialScope; projectId?: string; directoryId?: string; title: string; fileName?: string; content: string; origin: MaterialOrigin; sourceRequirementCodes: string[]; createdAt: string; updatedAt: string };
type Directory = { id: string; name: string; createdAt: string; updatedAt: string };
type ApiResponse<T> = { data: T; error?: never } | { data?: never; error: string };
type Target = { scope: MaterialScope; projectId?: string; directoryId?: string; label: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : "请求失败。");
  return body.data;
}

function formatTime(value: string) {
  const normalized = value.replace("-", "/").replace("-", "/");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "今天";
  return value.slice(5, 10);
}

function titleForFile(name: string) {
  return name.replace(/\.(?:md|txt)$/i, "").trim() || "未命名资料";
}

export function MaterialLibrary({ projects, canEdit }: { projects: Project[]; canEdit?: boolean }) {
  const [directories, setDirectories] = useState<Directory[]>([]);
  const [target, setTarget] = useState<Target>(() => projects[0] ? { scope: "project", projectId: projects[0].id, label: projects[0].name } : { scope: "public", label: "公共资料" });
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selected, setSelected] = useState<Material | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadDirectories() {
    setDirectories(await request<Directory[]>("/api/v1/materials/directories"));
  }

  async function loadMaterials(next = target) {
    if (next.scope === "project" && !next.projectId) { setMaterials([]); setSelected(null); return; }
    const params = new URLSearchParams({ scope: next.scope });
    if (next.projectId) params.set("project_id", next.projectId);
    if (next.directoryId) params.set("directory_id", next.directoryId);
    const result = await request<Material[]>(`/api/v1/materials?${params}`);
    setMaterials(result);
    setSelected((current) => result.find((item) => item.id === current?.id) ?? result[0] ?? null);
  }

  useEffect(() => {
    let active = true;
    void request<Directory[]>("/api/v1/materials/directories").then((result) => { if (active) setDirectories(result); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取资料目录。"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ scope: target.scope });
    if (target.projectId) params.set("project_id", target.projectId);
    if (target.directoryId) params.set("directory_id", target.directoryId);
    void request<Material[]>(`/api/v1/materials?${params}`).then((result) => {
      if (!active) return;
      setMaterials(result);
      setSelected((current) => result.find((item) => item.id === current?.id) ?? result[0] ?? null);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取资料。"); });
    return () => { active = false; };
  }, [target.scope, target.projectId, target.directoryId]);

  function selectMaterial(next: Material | null) { setSelected(next); setEditing(false); setTitle(next?.title ?? ""); setContent(next?.content ?? ""); }
  function choose(next: Target) { setError(""); setEditing(false); setTarget(next); }
  function startNew() { setSelected(null); setTitle(""); setContent(""); setEditing(true); }
  function startEdit() { if (selected) { setTitle(selected.title); setContent(selected.content); setEditing(true); } }

  async function save() {
    if (!canEdit || saving) return;
    setSaving(true); setError("");
    try {
      const payload = { scope: target.scope, projectId: target.projectId, directoryId: target.directoryId, title, content };
      const saved = selected && editing
        ? await request<Material>(`/api/v1/materials/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await request<Material>("/api/v1/materials", { method: "POST", body: JSON.stringify(payload) });
      await loadMaterials();
      selectMaterial(saved);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存资料失败。"); } finally { setSaving(false); }
  }

  async function remove() {
    if (!selected || !canEdit || !window.confirm(`删除资料“${selected.title}”？`)) return;
    try { await request(`/api/v1/materials/${encodeURIComponent(selected.id)}`, { method: "DELETE" }); await loadMaterials(); } catch (reason) { setError(reason instanceof Error ? reason.message : "删除资料失败。"); }
  }

  async function move() {
    if (!selected || !canEdit || selected.origin === "system_generated") return;
    if (selected.scope === "project") {
      const candidates = projects.filter((project) => project.id !== selected.projectId);
      const answer = window.prompt(`移动到项目（输入项目名称）：\n${candidates.map((project) => project.name).join("、")}`);
      const project = candidates.find((item) => item.name === answer?.trim());
      if (!project) { if (answer?.trim()) setError("未找到目标项目。"); return; }
      try { const updated = await request<Material>(`/api/v1/materials/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify({ scope: "project", projectId: project.id }) }); choose({ scope: "project", projectId: project.id, label: project.name }); setSelected(updated); } catch (reason) { setError(reason instanceof Error ? reason.message : "移动资料失败。"); }
      return;
    }
    const answer = window.prompt(`移动到公共目录（输入目录名称）：\n${directories.map((directory) => directory.name).join("、")}`);
    const directory = directories.find((item) => item.name === answer?.trim());
    if (!directory) { if (answer?.trim()) setError("未找到目标目录。"); return; }
    try { const updated = await request<Material>(`/api/v1/materials/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify({ scope: "public", directoryId: directory.id }) }); choose({ scope: "public", directoryId: directory.id, label: directory.name }); setSelected(updated); } catch (reason) { setError(reason instanceof Error ? reason.message : "移动资料失败。"); }
  }

  async function createDirectory() {
    const name = window.prompt("公共资料目录名称");
    if (!name?.trim()) return;
    try { const created = await request<Directory>("/api/v1/materials/directories", { method: "POST", body: JSON.stringify({ name }) }); await loadDirectories(); choose({ scope: "public", directoryId: created.id, label: created.name }); } catch (reason) { setError(reason instanceof Error ? reason.message : "新建目录失败。"); }
  }

  async function upload(file: File) {
    if (!canEdit) return;
    if (!/\.(?:md|txt)$/i.test(file.name)) { setError("一期只支持 .md 和 .txt 文件。"); return; }
    if (file.size > 800_000) { setError("资料文件不能超过 800KB。"); return; }
    try {
      const value = await file.text();
      const saved = await request<Material>("/api/v1/materials", { method: "POST", body: JSON.stringify({ scope: target.scope, projectId: target.projectId, directoryId: target.directoryId, title: titleForFile(file.name), content: value, fileName: file.name }) });
      await loadMaterials(); selectMaterial(saved);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "上传资料失败。"); }
  }

  return <section className="material-library">
    <header className="material-library-head"><div><h1>资料库</h1><p>项目资料与公共资料会自动作为需求智能体的补充知识。</p></div></header>
    {error ? <p className="material-error" role="alert">{error}</p> : null}
    <div className="material-library-layout">
      <aside className="material-tree">
        <small>项目资料</small>
        <div className="material-tree-list">{projects.map((project) => <button key={project.id} className={target.scope === "project" && target.projectId === project.id ? "is-selected" : ""} onClick={() => choose({ scope: "project", projectId: project.id, label: project.name })}><Icon name="folder" /><span>{project.name}</span></button>)}</div>
        <small>公共资料</small>
        <div className="material-tree-list">{directories.map((directory) => <button key={directory.id} className={target.scope === "public" && target.directoryId === directory.id ? "is-selected" : ""} onClick={() => choose({ scope: "public", directoryId: directory.id, label: directory.name })}><Icon name="folder" /><span>{directory.name}</span></button>)}</div>
        {canEdit ? <button className="material-new-directory" onClick={() => void createDirectory()}><Icon name="plus" /> 新建目录</button> : null}
      </aside>
      <section className="material-content">
        <header className="material-content-head"><div><small>{target.scope === "project" ? "项目资料" : "公共资料"}</small><h2>{target.label}</h2></div>{canEdit ? <div><input ref={fileInput} type="file" accept=".md,.txt,text/markdown,text/plain" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /><button className="directory-add-button" onClick={() => fileInput.current?.click()} title="上传 Markdown 或文本" aria-label="上传文件"><Icon name="file" /></button><button className="publish-button" onClick={startNew}><Icon name="plus" /> 新建文本</button></div> : null}</header>
        <div className="material-content-body">
          <div className="material-list"><div className="material-list-head"><span>名称</span><span>更新时间</span></div>{materials.length ? materials.map((item) => <button key={item.id} className={selected?.id === item.id ? "is-selected" : ""} onClick={() => selectMaterial(item)}><span><b>{item.title}</b>{item.origin === "system_generated" ? <em>系统整理</em> : null}</span><small>{formatTime(item.updatedAt)}</small></button>) : <p>当前没有资料</p>}</div>
          <article className="material-preview">{editing ? <><label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="资料标题" maxLength={120} /></label><label>内容<textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="可直接粘贴 Markdown 或文本内容" maxLength={400000} /></label><footer><button className="project-dialog-cancel" onClick={() => { setEditing(false); setTitle(selected?.title ?? ""); setContent(selected?.content ?? ""); }}>取消</button><button className="publish-button" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存"}</button></footer></> : selected ? <><header><div><h3>{selected.title}</h3>{selected.origin === "system_generated" ? <small>系统根据已上线需求自动整理{selected.sourceRequirementCodes.length ? ` · 来源 ${selected.sourceRequirementCodes.join("、")}` : ""}</small> : <small>{selected.fileName ?? "人工维护"}</small>}</div>{canEdit ? <div>{selected.origin === "manual" ? <button className="icon-button" onClick={() => void move()} title="移动资料" aria-label="移动资料"><Icon name="folder" /></button> : null}<button className="icon-button" onClick={startEdit} title="编辑资料" aria-label="编辑资料"><Icon name="edit" /></button><button className="icon-button material-delete" onClick={() => void remove()} title="删除资料" aria-label="删除资料"><Icon name="trash" /></button></div> : null}</header><pre>{selected.content}</pre></> : <div className="material-preview-empty"><Icon name="file" /><p>选择资料后可在这里查看内容</p></div>}</article>
        </div>
      </section>
    </div>
  </section>;
}
