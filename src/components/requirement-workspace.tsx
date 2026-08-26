"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DemoFrame } from "@/components/demo-frame";
import { ModelManager } from "@/components/model-manager";
import { EmployeeManager } from "@/components/employee-manager";
import { RequirementAssistant } from "@/components/requirement-assistant";
import { PublishPanel } from "@/components/publish-panel";
import { ProjectDialog } from "@/components/project-dialog";
import { Icon } from "@/components/icons";
import type { Project, RequirementComment, RequirementDetail, RequirementSummary, RequirementVersion } from "@/lib/types";

type Tab = "demo" | "prd" | "split";
type View = "detail" | "projects" | "requirements";
type ApiResponse<T> = { data: T; error?: never } | { data?: never; error: string };
type CurrentUser = { name: string; initial: string; mode: "local" | "feishu"; enabled?: boolean; pendingApproval?: boolean; canPublish?: boolean; isAdmin?: boolean };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : "请求失败。");
  return body.data;
}

async function fetchRequirementData(requirementCode: string) {
  const code = encodeURIComponent(requirementCode);
  const [detail, versions, comments] = await Promise.all([
    request<RequirementDetail>(`/api/v1/requirements/${code}`),
    request<RequirementVersion[]>(`/api/v1/requirements/${code}/versions`),
    request<RequirementComment[]>(`/api/v1/requirements/${code}/comments`),
  ]);
  return { detail, versions, comments };
}

function VersionDiscussion({ versionId, versionNo, label, comments, onAdd }: { versionId: string; versionNo: number; label: string; comments: RequirementComment[]; onAdd: (content: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const versionComments = comments.filter((comment) => comment.versionId === versionId);
  async function submit() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await onAdd(value);
      setText("");
    } finally {
      setSending(false);
    }
  }
  return <section className="discussion" aria-label="本版本留言">
    <button className="comment-tag" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls="version-comments"><Icon name="message" /><span>{label}</span>{versionComments.length ? <b>{versionComments.length}</b> : null}</button>
    {open ? <><button className="comment-dismiss" aria-label="关闭留言" onClick={() => setOpen(false)} /><div className="comment-popover" id="version-comments" role="dialog" aria-label="本版本留言">
      <div className="comment-popover-head"><span>{label}</span><small>{versionComments.length ? `${versionComments.length} 条` : "暂无评论"}</small><button className="comment-close" onClick={() => setOpen(false)} aria-label="关闭留言">×</button></div>
      <div className="comment-list">{versionComments.length ? versionComments.map((comment) => <article className="comment-card" key={comment.id}><div className="comment-card-head"><span className="comment-card-source">当前版本 · V{versionNo}</span><time>{comment.createdAt}</time></div><p>{comment.content}</p><div className="comment-card-footer"><span className={`avatar avatar-${comment.tone}`}>{comment.initials}</span><b>{comment.author}</b></div></article>) : <p className="comment-empty">还没有评论。</p>}</div>
      <div className="comment-composer"><span className="comment-composer-context">当前版本 · V{versionNo}</span><textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} rows={2} placeholder="写下评论，回车仅记录" aria-label="发表评论" /><button className="send-button" onClick={() => void submit()} disabled={!text.trim() || sending} aria-label="发送评论"><Icon name="send" /></button></div>
    </div></> : null}
  </section>;
}

function ProjectDirectory({ projects, activeProjectId, favoriteProjectIds, canManageProjects, onOpenProject, onToggleFavorite, onOpenPublish, onEditProject }: { projects: Project[]; activeProjectId: string; favoriteProjectIds: string[]; canManageProjects?: boolean; onOpenProject: (project: Project) => void; onToggleFavorite: (projectId: string) => void; onOpenPublish: () => void; onEditProject: (project: Project) => void }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProjects = projects.filter((project) => !normalizedQuery || `${project.name} ${project.description} ${project.requirements.map((item) => item.title).join(" ")}`.toLowerCase().includes(normalizedQuery));
  return <div className="directory-page"><div className="page-title"><div><h1>项目目录</h1><p>选择项目后，在右侧查看其需求与版本</p></div><div className="directory-actions"><label className="search-field"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目或需求" /></label><button className="publish-button" onClick={onOpenPublish}><Icon name="plus" />发布需求</button></div></div><div className="directory-table-head project-table-head"><span>项目</span><span>创建时间</span><span>更新时间</span><span>负责人</span><span>需求数</span></div><div className="project-list">{visibleProjects.map((project) => <div className={`project-row ${project.id === activeProjectId ? "is-active" : ""}`} key={project.id}><button className="project-row-open" onClick={() => onOpenProject(project)}><span><b>{project.name}</b><small>{project.description}</small></span><small>{project.createdAt ?? "--"}</small><small>{project.updatedAt}</small><small>{project.owner ?? "--"}</small><span className="project-row-meta"><small>{project.requirements.length} 个需求</small><Icon name="chevron" /></span></button>{canManageProjects ? <button className="project-edit-button" onClick={() => onEditProject(project)} aria-label={`编辑 ${project.name}`} title="编辑项目"><Icon name="edit" /></button> : null}<button className={`favorite-button ${favoriteProjectIds.includes(project.id) ? "is-favorite" : ""}`} onClick={() => onToggleFavorite(project.id)} aria-label={favoriteProjectIds.includes(project.id) ? `取消关注 ${project.name}` : `关注 ${project.name}`} title={favoriteProjectIds.includes(project.id) ? "取消关注" : "关注项目"}><Icon name="star" /></button></div>)}</div></div>;
}

function RequirementList({ project, requirements, onOpenRequirement }: { project: Project; requirements: RequirementSummary[]; onOpenRequirement: (requirement: RequirementSummary) => void }) {
  const [query, setQuery] = useState("");
  const visibleRequirements = requirements.filter((item) => `${item.code} ${item.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="directory-page"><div className="page-title"><div><h1>{project.name}</h1><p>{project.description}</p></div><label className="search-field"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索需求" /></label></div><div className="directory-table-head requirement-table-head"><span>需求名称</span><span>创建时间</span><span>更新时间</span><span>负责人</span><span>最新版本</span></div><div className="requirement-list">{visibleRequirements.map((item) => <button key={item.code} onClick={() => onOpenRequirement(item)}><span><small>{item.code}</small><b>{item.title}</b></span><small>{item.createdAt ?? "--"}</small><small>{item.updatedAt ?? "--"}</small><small>{item.owner ?? "--"}</small><span>V{item.latestVersion}<Icon name="chevron" /></span></button>)}</div></div>;
}

export function RequirementWorkspace({ initialRequirementCode = "ERP-001", initialVersionNumber, startInDetail = false }: { initialRequirementCode?: string; initialVersionNumber?: number; startInDetail?: boolean }) {
  const [view, setView] = useState<View>(startInDetail ? "detail" : "requirements");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectRequirements, setProjectRequirements] = useState<RequirementSummary[]>([]);
  const [favoriteProjectIds, setFavoriteProjectIds] = useState<string[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [detail, setDetail] = useState<RequirementDetail | null>(null);
  const [versions, setVersions] = useState<RequirementVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [comments, setComments] = useState<RequirementComment[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser>({ name: "本地开发身份", initial: "用", mode: "local" });
  const [tab, setTab] = useState<Tab>("demo");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [splitRatio, setSplitRatio] = useState(0.8);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectDialogSession, setProjectDialogSession] = useState(0);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  const selectedVersion = useMemo(() => versions.find((version) => version.id === selectedVersionId) ?? versions[0], [selectedVersionId, versions]);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? detail?.project ?? projects[0];

  const splitRatioKey = detail ? `requirement-platform:split-ratio:v2:${detail.requirement.code}` : "";

  useEffect(() => {
    if (!splitRatioKey) return;
    const storedValue = window.localStorage.getItem(splitRatioKey);
    const stored = storedValue === null ? Number.NaN : Number(storedValue);
    const nextRatio = Number.isFinite(stored) ? Math.min(0.9, Math.max(0.2, stored)) : 0.8;
    const timer = window.setTimeout(() => setSplitRatio(nextRatio), 0);
    return () => window.clearTimeout(timer);
  }, [splitRatioKey]);

  useEffect(() => {
    const key = `requirement-platform:favorite-projects:${currentUser.mode === "feishu" ? currentUser.name : "local"}`;
    const stored = window.localStorage.getItem(key);
    const timer = window.setTimeout(() => {
      try {
        setFavoriteProjectIds(stored ? (JSON.parse(stored) as string[]).filter((id) => typeof id === "string") : []);
      } catch {
        setFavoriteProjectIds([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUser.mode, currentUser.name]);

  useEffect(() => {
    if (!activeProjectId) return;
    void request<RequirementSummary[]>(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/requirements`)
      .then(setProjectRequirements)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取项目需求。"));
  }, [activeProjectId]);

  useEffect(() => {
    if (!draggingSplit) return;
    function onPointerMove(event: PointerEvent) {
      const container = splitContainerRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const nextRatio = Math.min(0.9, Math.max(0.2, (event.clientX - bounds.left) / bounds.width));
      setSplitRatio(nextRatio);
      if (splitRatioKey) window.localStorage.setItem(splitRatioKey, String(nextRatio));
    }
    function onPointerUp() { setDraggingSplit(false); }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [draggingSplit, splitRatioKey]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }, []);

  const loadRequirement = useCallback(async (requirementCode: string, versionNumber?: number) => {
    try {
      const { detail: nextDetail, versions: nextVersions, comments: nextComments } = await fetchRequirementData(requirementCode);
      setDetail(nextDetail);
      setVersions(nextVersions);
      setComments(nextComments);
      setSelectedVersionId(nextVersions.find((version) => version.number === versionNumber)?.id ?? nextDetail.currentVersion.id);
      setActiveProjectId(nextDetail.project.id);
      setView("detail");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取需求数据。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void request<CurrentUser>("/api/v1/auth/me")
      .then(async (user) => {
        setCurrentUser(user);
        if (user.pendingApproval) {
          setError("当前飞书账号尚未获准使用需求平台，请联系管理员开通。");
          setLoading(false);
          return;
        }
        const [nextProjects, result] = await Promise.all([request<Project[]>("/api/v1/projects"), fetchRequirementData(initialRequirementCode)]);
        setProjects(nextProjects);
        setDetail(result.detail);
        setVersions(result.versions);
        setComments(result.comments);
        setActiveProjectId(result.detail.project.id);
        setSelectedVersionId(result.versions.find((version) => version.number === initialVersionNumber)?.id ?? result.detail.currentVersion.id);
        setLoading(false);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "无法读取项目数据。");
        setLoading(false);
      });
  }, [initialRequirementCode, initialVersionNumber]);

  async function addComment(content: string) {
    if (!detail || !selectedVersion) return;
    const comment = await request<RequirementComment>(`/api/v1/requirements/${encodeURIComponent(detail.requirement.code)}/comments`, {
      method: "POST",
      body: JSON.stringify({ version_id: selectedVersion.id, content }),
    });
    setComments((current) => [...current, comment]);
  }

  async function copyLink() {
    if (!detail || !selectedVersion) return;
    const url = `${window.location.origin}/r/${detail.requirement.code}${selectedVersion.id === detail.currentVersion.id ? "" : `?v=${selectedVersion.number}`}`;
    await navigator.clipboard?.writeText(url);
    showNotice("已复制当前版本链接。");
  }

  async function handlePublished(result: { requirement: { code: string; title: string }; version: { number: number }; url: string }) {
    try {
      setProjects(await request<Project[]>("/api/v1/projects"));
      await loadRequirement(result.requirement.code);
      showNotice(`已发布 ${result.requirement.title} V${result.version.number}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布后刷新需求失败。");
    }
  }

  function openCreateProject() {
    setEditingProject(null);
    setProjectDialogSession((current) => current + 1);
    setProjectDialogOpen(true);
  }

  function openEditProject(project: Project) {
    setEditingProject(project);
    setProjectDialogSession((current) => current + 1);
    setProjectDialogOpen(true);
  }

  function handleProjectSaved(project: Project) {
    setProjects((current) => current.some((item) => item.id === project.id) ? current.map((item) => item.id === project.id ? project : item) : [...current, project]);
    if (detail?.project.id === project.id) setDetail((current) => current ? { ...current, project } : current);
    setActiveProjectId(project.id);
    setProjectDialogOpen(false);
    showNotice(editingProject ? "项目已更新。" : "项目已创建。");
  }

  function toggleFavorite(projectId: string) {
    const key = `requirement-platform:favorite-projects:${currentUser.mode === "feishu" ? currentUser.name : "local"}`;
    setFavoriteProjectIds((current) => {
      const next = current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId];
      window.localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }

  if (loading && !detail) return <main className="main-panel"><p className="loading-copy">正在读取需求版本…</p></main>;
  if (error && !detail) return <main className="main-panel"><div className="error-state"><b>{error.includes("尚未获准") ? "等待管理员授权" : "无法打开需求"}</b><span>{error}</span><button onClick={() => window.location.reload()}>重试</button></div></main>;
  if (!detail || !activeProject || !selectedVersion) return null;

  const favoriteProjects = projects.filter((project) => favoriteProjectIds.includes(project.id));
  return <div className={`workspace ${view === "detail" ? "is-detail" : ""}`}>{view !== "detail" ? <aside className="sidebar"><div className="sidebar-brand-row"><button className="brand" onClick={() => setView("projects")}><span className="brand-mark"><Icon name="book" /></span><span>需求库</span></button></div><nav className="sidebar-nav"><div className="nav-caption nav-caption-with-action"><span>我的项目</span></div>{favoriteProjects.length ? favoriteProjects.map((project) => <button className={`project-nav ${project.id === activeProject.id && view === "requirements" ? "is-selected" : ""}`} key={project.id} onClick={() => { setActiveProjectId(project.id); setView("requirements"); }}><Icon name="folder" /><span>{project.name}</span><Icon name="star" className="sidebar-star" /></button>) : <p className="sidebar-empty">关注的项目会显示在这里</p>}<div className="nav-caption nav-caption-with-action"><span>项目目录</span>{currentUser.canPublish ? <button className="sidebar-section-add" onClick={openCreateProject} title="新增项目" aria-label="新增项目"><Icon name="plus" /></button> : null}</div>{projects.map((project) => <button className={`project-nav ${project.id === activeProject.id && view === "requirements" ? "is-selected" : ""}`} key={project.id} onClick={() => { setActiveProjectId(project.id); setView("requirements"); }}><Icon name="folder" /><span>{project.name}</span></button>)}</nav><div className="sidebar-footer">{currentUser.isAdmin ? <EmployeeManager /> : null}{currentUser.isAdmin ? <ModelManager /> : null}<button className="sidebar-publish" onClick={() => setPublishOpen(true)} title="发布需求" aria-label="发布需求"><Icon name="plus" /></button><div className="profile-menu"><button className="profile" title={currentUser.mode === "feishu" ? "已通过飞书登录" : "本地开发身份"} aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((current) => !current)}><span className="avatar avatar-blue">{currentUser.initial}</span><span>{currentUser.name}</span><Icon name="chevron" /></button>{profileMenuOpen ? <><button className="profile-menu-dismiss" aria-label="关闭用户菜单" onClick={() => setProfileMenuOpen(false)} /><div className="profile-popover" role="menu"><div className="profile-popover-caption">{currentUser.mode === "feishu" ? "飞书账号" : "开发环境"}</div>{currentUser.mode === "local" ? <a role="menuitem" href="/auth/login">飞书登录</a> : <a role="menuitem" href="/auth/logout">退出登录</a>}</div></> : null}</div></div></aside> : null}
       <main className={`main-panel ${view === "detail" && tab === "demo" ? "is-demo-view" : ""}`}>{view === "projects" ? <ProjectDirectory projects={projects} activeProjectId={activeProject.id} favoriteProjectIds={favoriteProjectIds} canManageProjects={currentUser.canPublish} onToggleFavorite={toggleFavorite} onOpenPublish={() => setPublishOpen(true)} onEditProject={openEditProject} onOpenProject={(project) => { setActiveProjectId(project.id); setView("requirements"); }} /> : view === "requirements" ? <RequirementList project={activeProject} requirements={projectRequirements} onOpenRequirement={(requirement) => void loadRequirement(requirement.code)} /> : <><header className="requirement-header"><div className="title-row"><div className="title-leading"><button className="breadcrumb" onClick={() => setView("requirements")} title={`返回 ${activeProject.name}`} aria-label={`返回 ${activeProject.name}`}><Icon name="arrow" /><span className="sr-only">返回 {activeProject.name}</span></button><h1>{detail.requirement.title}</h1></div><div className="inline-tabs" role="tablist" aria-label="需求内容"><button className={tab === "demo" ? "is-active" : ""} onClick={() => setTab("demo")} role="tab" aria-selected={tab === "demo"}>Demo</button><button className={tab === "prd" ? "is-active" : ""} onClick={() => setTab("prd")} role="tab" aria-selected={tab === "prd"}>PRD</button><button className={tab === "split" ? "is-active" : ""} onClick={() => setTab("split")} role="tab" aria-selected={tab === "split"}>Demo+PRD</button></div><div className="header-actions"><RequirementAssistant requirementCode={detail.requirement.code} versionNo={selectedVersion.number} />{currentUser.canPublish ? <button className="publish-button publish-update-button" onClick={() => setPublishOpen(true)}><Icon name="plus" />发布更新</button> : null}<label className="version-select"><span className="sr-only">选择版本</span><select value={selectedVersion.id} onChange={(event) => setSelectedVersionId(event.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>V{version.number}</option>)}</select></label><button className="icon-button" onClick={() => void copyLink()} title="复制当前需求链接"><Icon name="link" /></button></div></div></header>
      {notice && <div className="notice"><Icon name="check" />{notice}</div>}
      {error && <div className="notice error-notice">{error}</div>}
      {tab === "split" ? <section ref={splitContainerRef} className={`content-surface is-split ${draggingSplit ? "is-resizing" : ""}`} style={{ gridTemplateColumns: `${splitRatio}fr 8px ${1 - splitRatio}fr` }}><div className="split-demo-pane"><DemoFrame viewport="desktop" src={selectedVersion.demoEntryUrl} /></div><div className="split-divider" role="separator" aria-label="调整 Demo 与 PRD 的宽度" aria-valuemin={20} aria-valuemax={90} aria-valuenow={Math.round(splitRatio * 100)} tabIndex={0} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDraggingSplit(true); }} onKeyDown={(event) => { const step = event.shiftKey ? 0.1 : 0.05; const nextRatio = Math.min(0.9, Math.max(0.2, splitRatio + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0))); if (nextRatio !== splitRatio) { setSplitRatio(nextRatio); if (splitRatioKey) window.localStorage.setItem(splitRatioKey, String(nextRatio)); } }} /><article className="split-prd-pane markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedVersion.prd}</ReactMarkdown></article></section> : <section className={`content-surface ${tab === "demo" ? "is-demo" : ""}`}>{tab === "demo" ? <DemoFrame viewport="desktop" src={selectedVersion.demoEntryUrl} /> : <article className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedVersion.prd}</ReactMarkdown></article>}</section>}
        {tab === "prd" ? <div className="version-facts"><div><span>发布于</span><b>{selectedVersion.publishedAt}</b></div><div><span>发布人</span><b>{selectedVersion.publisher}</b></div><div><span>版本说明</span><b>{selectedVersion.changeSummary}</b></div></div> : null}<VersionDiscussion versionId={selectedVersion.id} versionNo={selectedVersion.number} label={tab === "prd" ? "PRD 评论" : "版本留言"} comments={comments} onAdd={addComment} /></>}{view !== "detail" ? <RequirementAssistant mode="knowledge-base" onOpenRequirement={(requirementCode) => void loadRequirement(requirementCode)} /> : null}</main><PublishPanel key={`${detail.requirement.code}-${publishOpen ? "open" : "closed"}`} projects={projects} open={publishOpen} initialProjectId={activeProject.id} initialRequirementCode={detail.requirement.code} initialTitle={detail.requirement.title} onClose={() => setPublishOpen(false)} onPublished={(result) => void handlePublished(result)} /><ProjectDialog key={`${editingProject?.id ?? "new"}-${projectDialogSession}`} project={editingProject} open={projectDialogOpen} onClose={() => setProjectDialogOpen(false)} onSaved={handleProjectSaved} /></div>;
}
