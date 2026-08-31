"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import type { Project } from "@/lib/types";

type ApiResponse<T> = { data: T; error?: never } | { data?: never; error: string };
type PublishResult = { requirement: { code: string; title: string }; version: { number: number }; url: string };

async function readResponse<T>(response: Response) {
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : "请求失败。");
  return body.data;
}

export function PublishPanel({ projects, open, initialProjectId, initialRequirementCode = "", initialTitle = "", onClose, onPublished }: { projects: Project[]; open: boolean; initialProjectId?: string; initialRequirementCode?: string; initialTitle?: string; onClose: () => void; onPublished: (result: PublishResult, project?: Project) => void }) {
  const [createdProjects, setCreatedProjects] = useState<Project[]>([]);
  const [projectCode, setProjectCode] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [newProjectCode, setNewProjectCode] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [requirementCode] = useState(initialRequirementCode);
  const [title, setTitle] = useState(initialTitle);
  const [changeSummary, setChangeSummary] = useState("");
  const [prd, setPrd] = useState("");
  const [prdFile, setPrdFile] = useState<File | null>(null);
  const [prdReading, setPrdReading] = useState(false);
  const [demo, setDemo] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [published, setPublished] = useState<PublishResult | null>(null);

  const localProjects = useMemo(() => [...projects, ...createdProjects.filter((created) => !projects.some((project) => project.id === created.id))], [createdProjects, projects]);

  const effectiveProjectCode = projectCode || initialProjectId || projects[0]?.id || "";
  const selectedProject = useMemo(() => localProjects.find((item) => item.id === effectiveProjectCode), [effectiveProjectCode, localProjects]);
  const publishAction = requirementCode ? "更新到需求库" : "发布到需求库";
  if (!open) return null;

  function close() {
    setPublished(null);
    setError("");
    onClose();
  }

  async function submit() {
    setError("");
    if (!effectiveProjectCode) return setError("请选择一个项目。");
    if (!title.trim() || !prd.trim() || !changeSummary.trim()) return setError("需求标题、PRD 文件和版本说明必填。");
    if (!demo) return setError("请上传 Demo ZIP 文件。");
    setSubmitting(true);
    try {
      const targetProject = selectedProject;
      const formData = new FormData();
      formData.append("file", demo);
      const artifact = await readResponse<{ id: string }>(await fetch("/api/v1/artifacts", { method: "POST", body: formData }));
      const result = await readResponse<PublishResult>(await fetch("/api/v1/requirements/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_code: targetProject?.id ?? effectiveProjectCode, requirement_code: requirementCode, title, prd_markdown: prd, artifact_id: artifact.id, change_summary: changeSummary }) }));
      setPublished(result);
      onPublished(result, targetProject);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPublishedLink() {
    if (!published) return;
    await navigator.clipboard?.writeText(`${window.location.origin}${published.url}`);
  }

  function openCreateProject() {
    setNewProjectCode("");
    setNewProjectName("");
    setNewProjectDescription("");
    setError("");
    setCreateProjectOpen(true);
  }

  async function createProject() {
    if (submitting) return;
    if (!newProjectCode.trim() || !newProjectName.trim()) {
      setError("项目编码和项目名称必填。");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const project = await readResponse<Project>(await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newProjectCode, name: newProjectName, description: newProjectDescription }),
      }));
      setCreatedProjects((current) => [...current, project]);
      setProjectCode(project.id);
      setCreateProjectOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目创建失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="publish-layer"><button className="publish-backdrop" onClick={close} aria-label="关闭发布面板" /><section className="publish-panel" role="dialog" aria-modal="true" aria-labelledby="publish-title">
    <header><div><span className="publish-kicker">发布到需求库</span><h2 id="publish-title">{initialTitle || "发布 Demo 与 PRD"}</h2></div><button className="publish-close" onClick={close} aria-label="关闭发布面板"><Icon name="close" /></button></header>
    {published ? <div className="publish-success"><div className="publish-success-icon"><Icon name="check" /></div><h3>已发布 V{published.version.number}</h3><p>{published.requirement.title}</p><div className="publish-link-row"><input readOnly value={`${window.location.origin}${published.url}`} aria-label="需求链接" /><button onClick={() => void copyPublishedLink()}><Icon name="link" />复制链接</button></div><div className="publish-success-actions"><a href={published.url}>打开需求</a><button onClick={close}>完成</button></div></div> : <div className="publish-body">
      <div className="publish-section publish-project-section"><div className="publish-section-heading"><label>项目目录</label><button type="button" className="publish-add-project" onClick={openCreateProject} title="新增项目" aria-label="新增项目"><Icon name="plus" /></button></div><div className="publish-project-list">{localProjects.length ? localProjects.map((project) => <button type="button" key={project.id} className={`publish-project-row ${project.id === effectiveProjectCode ? "is-selected" : ""}`} onClick={() => { setProjectCode(project.id); setError(""); }}><Icon name="folder" /><span><b>{project.name}</b><small>{project.id}</small></span>{project.id === effectiveProjectCode ? <Icon name="check" /> : null}</button>) : <p className="publish-project-empty">暂无项目，请点击右上角 + 新建项目</p>}</div></div>
      <div className="publish-grid"><label>需求编号<span className="publish-generated-code">{requirementCode || `${selectedProject?.id?.toUpperCase() ?? "项目"}-001`}</span></label><label>需求名称{initialTitle ? <span className="publish-current-title">{title}</span> : <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入需求名称" />}</label></div>
      <label className="publish-section">版本说明<input value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} placeholder="本次发布做了什么改变" /></label>
      <label className="publish-upload publish-prd-upload"><span><Icon name="file" /><b>{prdFile ? prdFile.name : "上传 PRD Markdown"}</b><small>{prdReading ? "正在读取 Markdown…" : "支持 .md / .markdown 文件，发布时保存正文内容"}</small></span><input type="file" accept=".md,.markdown,text/markdown" onChange={(event) => { const file = event.target.files?.[0] ?? null; setPrdFile(file); setError(""); if (!file) { setPrd(""); return; } setPrdReading(true); void file.text().then(setPrd).catch(() => setError("PRD 文件读取失败，请重试。")).finally(() => setPrdReading(false)); }} /></label>
      <label className="publish-upload"><span><Icon name="file" /><b>{demo ? demo.name : "上传 Demo ZIP"}</b><small>根目录必须包含 index.html，最大 15MB</small></span><input type="file" accept=".zip,application/zip" onChange={(event) => setDemo(event.target.files?.[0] ?? null)} /></label>
      {error ? <p className="publish-error">{error}</p> : null}
      <footer><button className="publish-cancel" onClick={close}>取消</button><button className="publish-submit" disabled={submitting || prdReading} onClick={() => void submit()}>{submitting ? "正在提交…" : publishAction}</button></footer>
    </div>}
    {createProjectOpen ? <div className="publish-create-layer"><button className="publish-create-backdrop" onClick={() => setCreateProjectOpen(false)} aria-label="关闭新增项目" /><form className="publish-create-dialog" onSubmit={(event) => { event.preventDefault(); void createProject(); }} role="dialog" aria-modal="true" aria-labelledby="publish-create-title"><header><div><span className="publish-kicker">项目目录</span><h3 id="publish-create-title">新增项目</h3><p>创建后会自动选中该项目。</p></div><button type="button" className="publish-close" onClick={() => setCreateProjectOpen(false)} aria-label="关闭新增项目"><Icon name="close" /></button></header><div className="publish-create-body"><label>项目名称<input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} autoFocus required maxLength={120} placeholder="输入项目名称" /></label><label>项目编码<input value={newProjectCode} onChange={(event) => setNewProjectCode(event.target.value)} required maxLength={80} placeholder="例如：ERP" /></label><label>项目描述<span className="publish-optional">可选</span><textarea value={newProjectDescription} onChange={(event) => setNewProjectDescription(event.target.value)} maxLength={500} rows={3} placeholder="说明项目范围或用途" /></label>{error ? <p className="publish-error">{error}</p> : null}</div><footer><button type="button" className="publish-cancel" onClick={() => setCreateProjectOpen(false)}>取消</button><button className="publish-submit" disabled={submitting}>{submitting ? "创建中…" : "创建项目"}</button></footer></form></div> : null}
  </section></div>;
}
