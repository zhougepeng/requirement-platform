"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoFrame } from "@/components/demo-frame";
import { ModelManager } from "@/components/model-manager";
import { DifyKnowledgeSettings } from "@/components/dify-knowledge-settings";
import { MaterialLibrary } from "@/components/material-library";
import { EmployeeManager } from "@/components/employee-manager";
import { GithubUpdateManager } from "@/components/github-update-manager";
import { PersonalAccessTokenManager } from "@/components/personal-access-token-manager";
import { RequirementAssistant } from "@/components/requirement-assistant";
import { PublishPanel } from "@/components/publish-panel";
import { ProjectDialog } from "@/components/project-dialog";
import { SnapshotPublishDialog } from "@/components/snapshot-publish-dialog";
import { VersionAssetsPanel } from "@/components/version-assets-panel";
import { Icon } from "@/components/icons";
import { RequirementMarkdown } from "@/components/requirement-markdown";
import { RequirementGapsPanel } from "@/components/requirement-gaps-panel";
import { TestCasesPanel } from "@/components/test-cases-panel";
import { VersionDocumentDirectory } from "@/components/version-document-directory";
import { WaitingAuthorization } from "@/components/waiting-authorization";
import {
  RequirementReleaseStatus,
  type UpdateRequirementReleaseStatusInput,
} from "@/components/requirement-release-status";
import type {
  Project,
  RequirementComment,
  RequirementDetail,
  RequirementDocument,
  RequirementSummary,
  RequirementVersion,
} from "@/lib/types";

type Tab = "demo" | "prd" | "split" | "test-cases" | "versions";
type View = "board" | "detail" | "projects" | "requirements" | "materials";
type ApiResponse<T> =
  { data: T; error?: never } | { data?: never; error: string };
type CurrentUser = {
  name: string;
  initial: string;
  mode: "local" | "feishu";
  enabled?: boolean;
  pendingApproval?: boolean;
  canPublish?: boolean;
  isAdmin?: boolean;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || "error" in body)
    throw new Error("error" in body ? body.error : "请求失败。");
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

function VersionDiscussion({
  versionId,
  versionNo,
  label,
  comments,
  onAdd,
}: {
  versionId: string;
  versionNo: number;
  label: string;
  comments: RequirementComment[];
  onAdd: (content: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const versionComments = comments.filter(
    (comment) => comment.versionId === versionId,
  );
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
  return (
    <section className="discussion" aria-label="本版本留言">
      <button
        className="comment-tag"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="version-comments"
      >
        <Icon name="message" />
        <span>{label}</span>
        {versionComments.length ? <b>{versionComments.length}</b> : null}
      </button>
      {open ? (
        <>
          <button
            className="comment-dismiss"
            aria-label="关闭留言"
            onClick={() => setOpen(false)}
          />
          <div
            className="comment-popover"
            id="version-comments"
            role="dialog"
            aria-label="本版本留言"
          >
            <div className="comment-popover-head">
              <span>{label}</span>
              <small>
                {versionComments.length
                  ? `${versionComments.length} 条`
                  : "暂无评论"}
              </small>
              <button
                className="comment-close"
                onClick={() => setOpen(false)}
                aria-label="关闭留言"
              >
                ×
              </button>
            </div>
            <div className="comment-list">
              {versionComments.length ? (
                versionComments.map((comment) => (
                  <article className="comment-card" key={comment.id}>
                    <div className="comment-card-head">
                      <span className="comment-card-source">
                        当前版本 · V{versionNo}
                      </span>
                      <time>{comment.createdAt}</time>
                    </div>
                    <p>{comment.content}</p>
                    <div className="comment-card-footer">
                      <span className={`avatar avatar-${comment.tone}`}>
                        {comment.initials}
                      </span>
                      <b>{comment.author}</b>
                    </div>
                  </article>
                ))
              ) : (
                <p className="comment-empty">还没有评论。</p>
              )}
            </div>
            <div className="comment-composer">
              <span className="comment-composer-context">
                当前版本 · V{versionNo}
              </span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                rows={2}
                placeholder="写下评论，回车仅记录"
                aria-label="发表评论"
              />
              <button
                className="send-button"
                onClick={() => void submit()}
                disabled={!text.trim() || sending}
                aria-label="发送评论"
              >
                <Icon name="send" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function ProjectDirectory({
  projects,
  activeProjectId,
  favoriteProjectIds,
  canManageProjects,
  onOpenProject,
  onToggleFavorite,
  onOpenPublish,
  onEditProject,
  onToggleArchive,
}: {
  projects: Project[];
  activeProjectId: string;
  favoriteProjectIds: string[];
  canManageProjects?: boolean;
  onOpenProject: (project: Project) => void;
  onToggleFavorite: (projectId: string) => void;
  onOpenPublish: () => void;
  onEditProject: (project: Project) => void;
  onToggleArchive: (project: Project) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProjects = projects.filter(
    (project) =>
      !normalizedQuery ||
      `${project.name} ${project.description} ${project.requirements.map((item) => item.title).join(" ")}`
        .toLowerCase()
        .includes(normalizedQuery),
  );
  return (
    <div className="directory-page">
      <div className="page-title">
        <div>
          <h1>项目目录</h1>
          <p>选择项目后，在右侧查看其需求与版本</p>
        </div>
        <div className="directory-actions">
          <label className="search-field">
            <Icon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目或需求"
            />
          </label>
          {canManageProjects ? (
            <button className="publish-button" onClick={onOpenPublish}>
              <Icon name="plus" />
              发布需求
            </button>
          ) : null}
        </div>
      </div>
      {visibleProjects.length ? (
        <>
          <div className="directory-table-head project-table-head">
            <span>项目</span>
            <span>创建时间</span>
            <span>更新时间</span>
            <span>负责人</span>
            <span>需求数</span>
          </div>
          <div className="project-list">
            {visibleProjects.map((project) => (
              <div
                className={`project-row ${project.id === activeProjectId ? "is-active" : ""} ${project.archivedAt ? "is-archived" : ""}`}
                key={project.id}
              >
                <button
                  className="project-row-open"
                  onClick={() => onOpenProject(project)}
                >
                  <span>
                    <b>
                      {project.name}
                      {project.archivedAt ? (
                        <em className="archive-badge">已作废</em>
                      ) : null}
                    </b>
                    <small>{project.description}</small>
                  </span>
                  <small>{project.createdAt ?? "--"}</small>
                  <small>{project.updatedAt}</small>
                  <small>{project.owner ?? "--"}</small>
                  <span className="project-row-meta">
                    <small>{project.requirements.length} 个需求</small>
                    <Icon name="chevron" />
                  </span>
                </button>
                {canManageProjects ? (
                  <>
                    <button
                      className="project-edit-button"
                      onClick={() => onEditProject(project)}
                      aria-label={`编辑 ${project.name}`}
                      title="编辑项目"
                    >
                      <Icon name="edit" />
                    </button>
                    <button
                      className={`project-archive-button ${project.archivedAt ? "is-restore" : ""}`}
                      onClick={() => onToggleArchive(project)}
                      aria-label={
                        project.archivedAt
                          ? `恢复 ${project.name}`
                          : `作废 ${project.name}`
                      }
                      title={project.archivedAt ? "恢复项目" : "作废项目"}
                    >
                      <Icon name={project.archivedAt ? "refresh" : "trash"} />
                    </button>
                  </>
                ) : null}
                <button
                  className={`favorite-button ${favoriteProjectIds.includes(project.id) ? "is-favorite" : ""}`}
                  onClick={() => onToggleFavorite(project.id)}
                  aria-label={
                    favoriteProjectIds.includes(project.id)
                      ? `取消关注 ${project.name}`
                      : `关注 ${project.name}`
                  }
                  title={
                    favoriteProjectIds.includes(project.id)
                      ? "取消关注"
                      : "关注项目"
                  }
                >
                  <Icon name="star" />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="directory-empty">
          <b>{normalizedQuery ? "没有匹配的项目" : "暂无项目"}</b>
          {canManageProjects && !normalizedQuery ? (
            <button className="publish-button" onClick={onOpenPublish}>
              <Icon name="plus" />
              发布第一个需求
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function RequirementBoard({
  projects,
  onOpenProject,
}: {
  projects: Project[];
  onOpenProject: (project: Project) => void;
}) {
  const overview = useMemo(() => {
    const requirements = projects.flatMap((project) => project.requirements);
    const online = requirements.filter(
      (requirement) => requirement.status === "online",
    ).length;
    const scheduled = requirements.filter(
      (requirement) => requirement.status === "scheduled",
    ).length;
    const ongoingProjects = projects.filter((project) =>
      project.requirements.some((requirement) => requirement.status !== "online"),
    ).length;
    return {
      projects: projects.length,
      ongoingProjects,
      requirements: requirements.length,
      online,
      scheduled,
      offline: requirements.length - online - scheduled,
    };
  }, [projects]);
  const ownerRows = useMemo(() => {
    const rows = new Map<string, { total: number; online: number; scheduled: number }>();
    for (const project of projects) {
      for (const requirement of project.requirements) {
        const owner = requirement.owner ?? project.owner ?? "未分配";
        const current = rows.get(owner) ?? { total: 0, online: 0, scheduled: 0 };
        current.total += 1;
        if (requirement.status === "online") current.online += 1;
        if (requirement.status === "scheduled") current.scheduled += 1;
        rows.set(owner, current);
      }
    }
    return Array.from(rows, ([owner, counts]) => ({
      owner,
      ...counts,
      offline: counts.total - counts.online - counts.scheduled,
    })).toSorted((a, b) => b.total - a.total || a.owner.localeCompare(b.owner));
  }, [projects]);
  const monthlyReleases = useMemo(() => {
    const currentDate = new Date();
    const buckets = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() - (11 - index),
        1,
      );
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      return {
        key,
        label: `${date.getMonth() + 1}月`,
        items: [] as Array<{ projectName: string; requirementName: string }>,
      };
    });
    const byMonth = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    for (const project of projects) {
      for (const requirement of project.requirements) {
        const month = requirement.releaseDate?.slice(0, 7);
        if (requirement.status !== "online" || !month) continue;
        byMonth.get(month)?.items.push({
          projectName: project.name,
          requirementName: requirement.title,
        });
      }
    }
    return buckets;
  }, [projects]);

  return (
    <div className="requirement-board">
      <div className="board-overview">
        <div className="board-metric is-projects">
          <span className="board-metric-icon"><Icon name="folder" /></span>
          <div><small>项目总数</small><b>{overview.projects}</b></div>
        </div>
        <div className="board-metric is-ongoing">
          <span className="board-metric-icon"><Icon name="file" /></span>
          <div><small>进行中项目</small><b>{overview.ongoingProjects}</b></div>
        </div>
        <div className="board-metric is-requirements">
          <span className="board-metric-icon"><Icon name="file" /></span>
          <div><small>需求总数</small><b>{overview.requirements}</b></div>
        </div>
        <div className="board-metric is-online">
          <span className="board-metric-icon"><Icon name="check" /></span>
          <div><small>已上线</small><b>{overview.online}</b></div>
        </div>
        <div className="board-metric is-scheduled">
          <span className="board-metric-icon"><Icon name="file" /></span>
          <div><small>已排期</small><b>{overview.scheduled}</b></div>
        </div>
        <div className="board-metric is-offline">
          <span className="board-metric-icon"><Icon name="file" /></span>
          <div><small>未上线</small><b>{overview.offline}</b></div>
        </div>
      </div>
      <MonthlyReleaseChart months={monthlyReleases} />
      <div className="board-project-grid">
        {projects.map((project) => {
          const total = project.requirements.length;
          const online = project.requirements.filter(
            (requirement) => requirement.status === "online",
          ).length;
          const scheduled = project.requirements.filter(
            (requirement) => requirement.status === "scheduled",
          ).length;
          const offline = total - online - scheduled;
          const ongoing = scheduled > 0 || offline > 0;
          return (
            <button
              key={project.id}
              className="board-project-card"
              onClick={() => onOpenProject(project)}
            >
              <span className="board-project-icon"><Icon name="folder" /></span>
              <span className="board-project-title">
                <b>{project.name}</b>
                <small><em className={`board-project-status ${ongoing ? "is-ongoing" : "is-complete"}`}>{ongoing ? "进行中" : "已全部上线"}</em></small>
              </span>
              <span className="board-project-counts">
                <span><small>需求数</small><b>{total}</b></span>
                <span><small>已上线</small><b className="is-online">{online}</b></span>
                <span><small>已排期</small><b className="is-scheduled">{scheduled}</b></span>
                <span><small>未上线</small><b className="is-offline">{offline}</b></span>
              </span>
              <Icon name="chevron" />
            </button>
          );
        })}
      </div>
      <BoardOwnerTable rows={ownerRows} />
    </div>
  );
}

function MonthlyReleaseChart({
  months,
}: {
  months: Array<{
    key: string;
    label: string;
    items: Array<{ projectName: string; requirementName: string }>;
  }>;
}) {
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const maxCount = Math.max(1, ...months.map((month) => month.items.length));
  return (
    <section className="monthly-release-chart">
      <header>
        <div><Icon name="file" /><b>近 12 个月上线情况</b></div>
        <small>悬停柱状图查看上线需求</small>
      </header>
      <div className="monthly-release-bars">
        {months.map((month) => {
          const count = month.items.length;
          const groupedItems = new Map<
            string,
            Array<{ projectName: string; requirementName: string }>
          >();
          for (const item of month.items) {
            const items = groupedItems.get(item.projectName) ?? [];
            items.push(item);
            groupedItems.set(item.projectName, items);
          }
          return (
            <div className="monthly-release-column" key={month.key}>
              <div className="monthly-release-track">
                <button
                  className={`monthly-release-bar ${count ? "has-data" : ""}`}
                  style={{ height: `${Math.max(4, (count / maxCount) * 100)}%` }}
                  onMouseEnter={() => setActiveMonth(month.key)}
                  onMouseLeave={() => setActiveMonth(null)}
                  onFocus={() => setActiveMonth(month.key)}
                  onBlur={() => setActiveMonth(null)}
                  aria-label={`${month.key} 已上线 ${count} 个需求`}
                >
                  {count ? <span>{count}</span> : null}
                </button>
                {activeMonth === month.key ? (
                  <div className="monthly-release-tooltip" role="tooltip">
                    <b>{month.key} · 已上线 {count} 个需求</b>
                    {count ? (
                      Array.from(groupedItems, ([projectName, items]) => (
                        <div key={projectName}>
                          <strong>{projectName}</strong>
                          <ul>{items.map((item) => <li key={`${projectName}-${item.requirementName}`}>{item.requirementName}</li>)}</ul>
                        </div>
                      ))
                    ) : <span>当月暂无上线需求</span>}
                  </div>
                ) : null}
              </div>
              <small>{month.label}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BoardOwnerTable({
  rows,
}: {
  rows: Array<{ owner: string; total: number; online: number; scheduled: number; offline: number }>;
}) {
  return (
    <section className="board-owner-table">
      <header>
        <div><Icon name="users" /><b>负责人汇总</b></div>
      </header>
      {rows.length ? (
        <div className="board-owner-grid">
          <div className="board-owner-row board-owner-head"><span>负责人</span><span>需求数</span><span>已上线</span><span>已排期</span><span>未上线</span></div>
          {rows.map((row) => (
            <div className="board-owner-row" key={row.owner}>
              <span><i>{row.owner.slice(0, 1)}</i>{row.owner}</span>
              <b>{row.total}</b>
              <b className="is-online">{row.online}</b>
              <b className="is-scheduled">{row.scheduled}</b>
              <b className="is-offline">{row.offline}</b>
            </div>
          ))}
        </div>
      ) : <p>暂无负责人数据</p>}
    </section>
  );
}

function RequirementList({
  project,
  requirements,
  canManageRequirements,
  onOpenRequirement,
  onToggleArchive,
  onUpdateReleaseStatus,
}: {
  project: Project;
  requirements: RequirementSummary[];
  canManageRequirements?: boolean;
  onOpenRequirement: (requirement: RequirementSummary) => void;
  onToggleArchive: (requirement: RequirementSummary) => void;
  onUpdateReleaseStatus: (
    requirement: RequirementSummary,
    input: UpdateRequirementReleaseStatusInput,
  ) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [releaseFilter, setReleaseFilter] = useState<
    "all" | "offline" | "scheduled" | "online"
  >("all");
  const visibleRequirements = requirements.filter(
    (item) =>
      `${item.code} ${item.title}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (releaseFilter === "all" || (item.status ?? "offline") === releaseFilter),
  );
  return (
    <div className="directory-page">
      <div className="page-title">
        <div>
          <h1>
            {project.name}
            {project.archivedAt ? (
              <em className="archive-badge">已作废</em>
            ) : null}
          </h1>
          <p>
            {project.archivedAt
              ? "项目已作废；恢复项目后可继续维护其中的需求。"
              : project.description}
          </p>
        </div>
        <div className="directory-actions">
          <label className="search-field">
            <Icon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索需求"
            />
          </label>
          <label className="release-filter">
            <span>状态</span>
            <select
              value={releaseFilter}
              onChange={(event) =>
                setReleaseFilter(event.target.value as typeof releaseFilter)
              }
              aria-label="按上线状态筛选"
            >
              <option value="all">全部</option>
              <option value="offline">未上线</option>
              <option value="scheduled">已排期</option>
              <option value="online">已上线</option>
            </select>
          </label>
        </div>
      </div>
      {visibleRequirements.length ? (
        <>
          <div className="directory-table-head requirement-table-head">
            <span>需求名称</span>
            <span>状态</span>
            <span>创建时间</span>
            <span>更新时间</span>
            <span>负责人</span>
            <span>最新版本</span>
          </div>
          <div className="requirement-list">
            {visibleRequirements.map((item) => (
              <div
                className={`requirement-row ${item.archivedAt ? "is-archived" : ""}`}
                key={item.code}
                role="button"
                tabIndex={0}
                onClick={() => onOpenRequirement(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenRequirement(item);
                  }
                }}
              >
                <span>
                  <small>{item.code}</small>
                  <b>
                    {item.title}
                    {item.archivedAt ? (
                      <em className="archive-badge">已作废</em>
                    ) : null}
                  </b>
                </span>
                <span className="requirement-status-cell">
                  <RequirementReleaseStatus
                    requirement={item}
                    requirementCode={item.code}
                    projectId={project.id}
                    canEdit={
                      canManageRequirements &&
                      !project.archivedAt &&
                      !item.archivedAt
                    }
                    compact
                    onChange={(input) => onUpdateReleaseStatus(item, input)}
                  />
                </span>
                <small>{item.createdAt ?? "--"}</small>
                <small>{item.updatedAt ?? "--"}</small>
                <small>{item.owner ?? "--"}</small>
                <span className="requirement-version-cell">
                  V{item.latestVersion}
                  <Icon name="chevron" />
                </span>
                {canManageRequirements && !project.archivedAt ? (
                  <button
                    className={`requirement-archive-button ${item.archivedAt ? "is-restore" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleArchive(item);
                    }}
                    aria-label={
                      item.archivedAt
                        ? `恢复 ${item.title}`
                        : `作废 ${item.title}`
                    }
                    title={item.archivedAt ? "恢复需求" : "作废需求"}
                  >
                    <Icon name={item.archivedAt ? "refresh" : "trash"} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="directory-empty">
          <b>
            {query.trim() || releaseFilter !== "all"
              ? "没有匹配的需求"
              : "暂无需求"}
          </b>
        </div>
      )}
    </div>
  );
}

export function RequirementWorkspace({
  initialRequirementCode,
  initialVersionNumber,
  startInDetail = false,
  forceWaitingAuthorization = false,
}: {
  initialRequirementCode?: string;
  initialVersionNumber?: number;
  startInDetail?: boolean;
  forceWaitingAuthorization?: boolean;
}) {
  const [view, setView] = useState<View>(startInDetail ? "detail" : "board");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectRequirements, setProjectRequirements] = useState<
    RequirementSummary[]
  >([]);
  const [favoriteProjectIds, setFavoriteProjectIds] = useState<string[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [detail, setDetail] = useState<RequirementDetail | null>(null);
  const [versions, setVersions] = useState<RequirementVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedPrdDocumentId, setSelectedPrdDocumentId] = useState("");
  const [selectedDemoDocumentId, setSelectedDemoDocumentId] = useState("");
  const [comments, setComments] = useState<RequirementComment[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser>({
    name: "本地开发身份",
    initial: "用",
    mode: "local",
  });
  const [tab, setTab] = useState<Tab>("demo");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [splitRatio, setSplitRatio] = useState(0.8);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [employeeManagerRequest, setEmployeeManagerRequest] = useState(0);
  const [modelManagerRequest, setModelManagerRequest] = useState(0);
  const [difySettingsRequest, setDifySettingsRequest] = useState(0);
  const [githubUpdateRequest, setGithubUpdateRequest] = useState(0);
  const [personalAccessTokenRequest, setPersonalAccessTokenRequest] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const [snapshotPublishOpen, setSnapshotPublishOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectDialogSession, setProjectDialogSession] = useState(0);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const selectVersion = useCallback((versionId: string) => {
    setSelectedVersionId(versionId);
    setSelectedPrdDocumentId("");
    setSelectedDemoDocumentId("");
  }, []);

  const selectedVersion = useMemo(
    () =>
      versions.find((version) => version.id === selectedVersionId) ??
      versions[0],
    [selectedVersionId, versions],
  );
  const prdDocuments = useMemo<RequirementDocument[]>(() => {
    if (!selectedVersion) return [];
    const documents = (selectedVersion.documents ?? [])
      .filter((document) => document.kind === "prd")
      .toSorted(
        (a, b) => a.order - b.order || a.name.localeCompare(b.name),
      );
    if (documents.length) return documents;
    return [{
      id: `${selectedVersion.id}:legacy-prd`,
      name: "PRD.md",
      path: "PRD.md",
      kind: "prd",
      mimeType: "text/markdown",
      order: 0,
      content: selectedVersion.prd,
    }];
  }, [selectedVersion]);
  const demoDocuments = useMemo<RequirementDocument[]>(() => {
    if (!selectedVersion) return [];
    const documents = (selectedVersion.documents ?? [])
      .filter((document) => document.kind === "demo")
      .toSorted(
        (a, b) => a.order - b.order || a.name.localeCompare(b.name),
      );
    if (documents.length) return documents;
    return [{
      id: `${selectedVersion.id}:legacy-demo`,
      name: "index.html",
      path: "demo/index.html",
      kind: "demo",
      mimeType: "text/html",
      order: 0,
      url: selectedVersion.demoEntryUrl,
    }];
  }, [selectedVersion]);
  const selectedPrdDocument = prdDocuments.find((document) => document.id === selectedPrdDocumentId) ?? prdDocuments[0];
  const selectedDemoDocument = demoDocuments.find((document) => document.id === selectedDemoDocumentId) ?? demoDocuments[0];
  const selectedPrdSource = selectedPrdDocument?.content ?? selectedVersion?.prd ?? "";
  const selectedPrdAssetBaseUrl = selectedPrdDocument?.url;
  const selectedDemoUrl = selectedDemoDocument?.url ?? selectedVersion?.demoEntryUrl ?? "";
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ??
    detail?.project ??
    projects[0];

  const splitRatioKey = detail
    ? `requirement-platform:split-ratio:v2:${detail.requirement.code}`
    : "";
  const showArchivedKey = `requirement-platform:show-archived:${currentUser.mode === "feishu" ? currentUser.name : "local"}`;

  useEffect(() => {
    if (!splitRatioKey) return;
    const storedValue = window.localStorage.getItem(splitRatioKey);
    const stored = storedValue === null ? Number.NaN : Number(storedValue);
    const nextRatio = Number.isFinite(stored)
      ? Math.min(0.9, Math.max(0.2, stored))
      : 0.8;
    const timer = window.setTimeout(() => setSplitRatio(nextRatio), 0);
    return () => window.clearTimeout(timer);
  }, [splitRatioKey]);

  useEffect(() => {
    const key = `requirement-platform:favorite-projects:${currentUser.mode === "feishu" ? currentUser.name : "local"}`;
    const stored = window.localStorage.getItem(key);
    const timer = window.setTimeout(() => {
      try {
        setFavoriteProjectIds(
          stored
            ? (JSON.parse(stored) as string[]).filter(
                (id) => typeof id === "string",
              )
            : [],
        );
      } catch {
        setFavoriteProjectIds([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUser.mode, currentUser.name]);

  useEffect(() => {
    const stored = window.localStorage.getItem(showArchivedKey);
    const timer = window.setTimeout(
      () => setShowArchived(stored === "true"),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [showArchivedKey]);

  useEffect(() => {
    const openTestCases = () => setTab("test-cases");
    window.addEventListener("requirement-open-test-cases", openTestCases);
    return () =>
      window.removeEventListener("requirement-open-test-cases", openTestCases);
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    const suffix = showArchived ? "?include_archived=true" : "";
    void request<RequirementSummary[]>(
      `/api/v1/projects/${encodeURIComponent(activeProjectId)}/requirements${suffix}`,
    )
      .then(setProjectRequirements)
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "无法读取项目需求。",
        ),
      );
  }, [activeProjectId, showArchived]);

  useEffect(() => {
    if (!draggingSplit) return;
    function onPointerMove(event: PointerEvent) {
      const container = splitContainerRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const nextRatio = Math.min(
        0.9,
        Math.max(0.2, (event.clientX - bounds.left) / bounds.width),
      );
      setSplitRatio(nextRatio);
      if (splitRatioKey)
        window.localStorage.setItem(splitRatioKey, String(nextRatio));
    }
    function onPointerUp() {
      setDraggingSplit(false);
    }
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

  const loadRequirement = useCallback(
    async (requirementCode: string, versionNumber?: number) => {
      try {
        const {
          detail: nextDetail,
          versions: nextVersions,
          comments: nextComments,
        } = await fetchRequirementData(requirementCode);
        setDetail(nextDetail);
        setVersions(nextVersions);
        setComments(nextComments);
        selectVersion(
          nextVersions.find((version) => version.number === versionNumber)
            ?.id ?? nextDetail.currentVersion.id,
        );
        setActiveProjectId(nextDetail.project.id);
        setView("detail");
        setError("");
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "无法读取需求数据。",
        );
      } finally {
        setLoading(false);
      }
    },
    [selectVersion],
  );

  useEffect(() => {
    void request<CurrentUser>("/api/v1/auth/me")
      .then(async (user) => {
        setCurrentUser(user);
        if (user.pendingApproval) {
          setError("");
          setLoading(false);
          return;
        }
        const nextProjects = await request<Project[]>("/api/v1/projects");
        setProjects(nextProjects);
        if (startInDetail && initialRequirementCode) {
          const result = await fetchRequirementData(initialRequirementCode);
          setDetail(result.detail);
          setVersions(result.versions);
          setComments(result.comments);
          setActiveProjectId(result.detail.project.id);
          selectVersion(
            result.versions.find(
              (version) => version.number === initialVersionNumber,
            )?.id ?? result.detail.currentVersion.id,
          );
        } else {
          setView("board");
        }
        setLoading(false);
      })
      .catch((reason) => {
        setError(
          reason instanceof Error ? reason.message : "无法读取项目数据。",
        );
        setLoading(false);
      });
  }, [initialRequirementCode, initialVersionNumber, selectVersion, startInDetail]);

  async function addComment(content: string) {
    if (!detail || !selectedVersion) return;
    const comment = await request<RequirementComment>(
      `/api/v1/requirements/${encodeURIComponent(detail.requirement.code)}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ version_id: selectedVersion.id, content }),
      },
    );
    setComments((current) => [...current, comment]);
  }

  async function copyLink() {
    if (!detail || !selectedVersion) return;
    const url = `${window.location.origin}/r/${detail.requirement.code}${selectedVersion.id === detail.currentVersion.id ? "" : `?v=${selectedVersion.number}`}`;
    await navigator.clipboard?.writeText(url);
    showNotice("已复制当前版本链接。");
  }

  async function handlePublished(result: {
    requirement: { code: string; title: string };
    version: { number: number };
    url: string;
  }) {
    try {
      setProjects(
        await request<Project[]>(
          showArchived
            ? "/api/v1/projects?include_archived=true"
            : "/api/v1/projects",
        ),
      );
      await loadRequirement(result.requirement.code);
      showNotice(
        `已发布 ${result.requirement.title} V${result.version.number}`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "发布后刷新需求失败。",
      );
    }
  }

  async function restoreVersion(version: RequirementVersion) {
    if (
      !detail ||
      !window.confirm(
        `将基于 V${version.number} 创建一个新的当前版本，现有版本不会删除。是否继续？`,
      )
    )
      return;
    try {
      const result = await request<{ version: RequirementVersion }>(
        `/api/v1/requirements/${encodeURIComponent(detail.requirement.code)}/versions/${version.number}/restore`,
        { method: "POST", body: JSON.stringify({}) },
      );
      await loadRequirement(detail.requirement.code, result.version.number);
      setTab("versions");
      showNotice(`已从 V${version.number} 创建 V${result.version.number}。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复版本失败。");
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
    setProjects((current) =>
      current.some((item) => item.id === project.id)
        ? current.map((item) => (item.id === project.id ? project : item))
        : [...current, project],
    );
    if (detail?.project.id === project.id)
      setDetail((current) => (current ? { ...current, project } : current));
    setActiveProjectId(project.id);
    setProjectDialogOpen(false);
    showNotice(editingProject ? "项目已更新。" : "项目已创建。");
  }

  const refreshProjects = useCallback(
    async (includeArchived = showArchived) => {
      setProjects(
        await request<Project[]>(
          includeArchived
            ? "/api/v1/projects?include_archived=true"
            : "/api/v1/projects",
        ),
      );
    },
    [showArchived],
  );

  async function refreshActiveProjectRequirements(
    includeArchived = showArchived,
  ) {
    if (!activeProjectId) return;
    const suffix = includeArchived ? "?include_archived=true" : "";
    setProjectRequirements(
      await request<RequirementSummary[]>(
        `/api/v1/projects/${encodeURIComponent(activeProjectId)}/requirements${suffix}`,
      ),
    );
  }

  async function updateReleaseStatus(
    requirementCode: string,
    input: UpdateRequirementReleaseStatusInput,
  ) {
    const updated = await request<RequirementDetail["requirement"]>(
      `/api/v1/requirements/${encodeURIComponent(requirementCode)}/release-status`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
    setDetail((current) =>
      current?.requirement.code === updated.code
        ? { ...current, requirement: updated }
        : current,
    );
    setProjectRequirements((current) =>
      current.map((item) =>
        item.code === updated.code
          ? {
              ...item,
              status: updated.status,
              releaseVersion: updated.releaseVersion,
              releaseDate: updated.releaseDate,
              updatedAt: updated.updatedAt,
            }
          : item,
      ),
    );
    await refreshProjects();
    showNotice("需求状态已更新。");
  }

  async function toggleProjectArchive(project: Project) {
    const action = project.archivedAt ? "恢复" : "作废";
    if (
      !window.confirm(
        `确认${action}项目“${project.name}”？${project.archivedAt ? "恢复后可继续发布和维护需求。" : "作废后默认不展示，也不会被 AI 检索。"}`,
      )
    )
      return;
    try {
      const updated = await request<Project>(
        `/api/v1/projects/${encodeURIComponent(project.id)}/${project.archivedAt ? "restore" : "archive"}`,
        { method: "POST" },
      );
      await refreshProjects();
      if (detail?.project.id === updated.id)
        setDetail((current) =>
          current ? { ...current, project: updated } : current,
        );
      showNotice(`项目已${action}。`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : `项目${action}失败。`,
      );
    }
  }

  async function toggleRequirementArchive(requirement: RequirementSummary) {
    const action = requirement.archivedAt ? "恢复" : "作废";
    if (
      !window.confirm(
        `确认${action}需求“${requirement.title}”？${requirement.archivedAt ? "恢复后可继续发布新版本。" : "作废后默认不展示，也不会被 AI 检索。"}`,
      )
    )
      return;
    try {
      const updated = await request<RequirementDetail["requirement"]>(
        `/api/v1/requirements/${encodeURIComponent(requirement.code)}/${requirement.archivedAt ? "restore" : "archive"}`,
        { method: "POST" },
      );
      await refreshProjects();
      await refreshActiveProjectRequirements();
      if (detail?.requirement.code === updated.code)
        setDetail((current) =>
          current ? { ...current, requirement: updated } : current,
        );
      showNotice(`需求已${action}。`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : `需求${action}失败。`,
      );
    }
  }

  function toggleShowArchived() {
    setShowArchived((current) => {
      const next = !current;
      window.localStorage.setItem(showArchivedKey, String(next));
      return next;
    });
  }

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const endpoint = showArchived
      ? "/api/v1/projects?include_archived=true"
      : "/api/v1/projects";
    void request<Project[]>(endpoint)
      .then((nextProjects) => {
        if (!cancelled) setProjects(nextProjects);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "无法刷新项目目录。",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [loading, showArchived]);

  function toggleFavorite(projectId: string) {
    const key = `requirement-platform:favorite-projects:${currentUser.mode === "feishu" ? currentUser.name : "local"}`;
    setFavoriteProjectIds((current) => {
      const next = current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId];
      window.localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }

  if (loading)
    return (
      <main className="main-panel">
        <p className="loading-copy">正在读取需求库…</p>
      </main>
    );
  if (currentUser.pendingApproval || forceWaitingAuthorization)
    return <WaitingAuthorization name={currentUser.name} />;
  if (error && startInDetail && !detail)
    return (
      <main className="main-panel">
        <div className="error-state">
          <b>
            {error.includes("尚未获准") ? "等待管理员授权" : "无法打开需求"}
          </b>
          <span>{error}</span>
          <button onClick={() => window.location.reload()}>重试</button>
        </div>
      </main>
    );
  if (view === "detail" && (!detail || !activeProject || !selectedVersion))
    return (
      <main className="main-panel">
        <div className="error-state">
          <b>无法打开需求</b>
          <span>{error || "需求数据不完整。"}</span>
          <button onClick={() => setView("board")}>返回需求看板</button>
        </div>
      </main>
    );

  const favoriteProjects = projects.filter((project) =>
    favoriteProjectIds.includes(project.id),
  );
  return (
    <div className={`workspace ${view === "detail" ? "is-detail" : ""}`}>
      {view !== "detail" ? (
        <aside className="sidebar">
          <div className="sidebar-brand-row">
            <button className="brand" onClick={() => setView("board")}>
              <span className="brand-mark">
                <Icon name="book" />
              </span>
              <span>需求库</span>
            </button>
          </div>
          <nav className="sidebar-nav">
            <button
              className={`nav-item ${view === "board" ? "is-selected" : ""}`}
              onClick={() => setView("board")}
            >
              <Icon name="book" />
              <span>需求看板</span>
            </button>
            <button
              className={`nav-item ${view === "materials" ? "is-selected" : ""}`}
              onClick={() => setView("materials")}
            >
              <Icon name="file" />
              <span>资料库</span>
            </button>
            <div className="nav-caption nav-caption-with-action">
              <span>我的项目</span>
            </div>
            {favoriteProjects.length ? (
              favoriteProjects.map((project) => (
                <button
                  className={`project-nav ${project.id === activeProject?.id && view === "requirements" ? "is-selected" : ""}`}
                  key={project.id}
                  onClick={() => {
                    setActiveProjectId(project.id);
                    setView("requirements");
                  }}
                >
                  <Icon name="folder" />
                  <span>{project.name}</span>
                  <Icon name="star" className="sidebar-star" />
                </button>
              ))
            ) : (
              <p className="sidebar-empty">关注的项目会显示在这里</p>
            )}
            <div className="nav-caption nav-caption-with-action">
              <span>项目目录</span>
              {currentUser.canPublish ? (
                <button
                  className="sidebar-section-add"
                  onClick={openCreateProject}
                  title="新增项目"
                  aria-label="新增项目"
                >
                  <Icon name="plus" />
                </button>
              ) : null}
            </div>
            {projects.map((project) => (
              <button
                className={`project-nav ${project.id === activeProject?.id && view === "requirements" ? "is-selected" : ""} ${project.archivedAt ? "is-archived" : ""}`}
                key={project.id}
                onClick={() => {
                  setActiveProjectId(project.id);
                  setView("requirements");
                }}
              >
                <Icon name="folder" />
                <span>{project.name}</span>
                {project.archivedAt ? (
                  <em className="archive-badge">已作废</em>
                ) : null}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            {currentUser.isAdmin ? (
              <EmployeeManager
                key={`employee-${employeeManagerRequest}`}
                hideTrigger
                initialOpen={employeeManagerRequest > 0}
                onClose={() => setEmployeeManagerRequest(0)}
              />
            ) : null}
            {currentUser.isAdmin ? (
              <ModelManager
                key={`model-${modelManagerRequest}`}
                hideTrigger
                initialOpen={modelManagerRequest > 0}
                onClose={() => setModelManagerRequest(0)}
              />
            ) : null}
            {currentUser.isAdmin ? (
              <DifyKnowledgeSettings
                key={`dify-${difySettingsRequest}`}
                initialOpen={difySettingsRequest > 0}
                onClose={() => setDifySettingsRequest(0)}
              />
            ) : null}
            {currentUser.isAdmin ? (
              <GithubUpdateManager
                key={`github-update-${githubUpdateRequest}`}
                hideTrigger
                initialOpen={githubUpdateRequest > 0}
                onClose={() => setGithubUpdateRequest(0)}
              />
            ) : null}
            {currentUser.canPublish ? (
              <PersonalAccessTokenManager
                key={`personal-access-token-${personalAccessTokenRequest}`}
                initialOpen={personalAccessTokenRequest > 0}
                onClose={() => setPersonalAccessTokenRequest(0)}
              />
            ) : null}
            <div className="profile-menu">
              <button
                className="profile"
                title={
                  currentUser.mode === "feishu"
                    ? "已通过飞书登录"
                    : "本地开发身份"
                }
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen((current) => !current)}
              >
                <span className="avatar avatar-blue">
                  {currentUser.initial}
                </span>
                <span>{currentUser.name}</span>
                <Icon name="chevron" />
              </button>
              {profileMenuOpen ? (
                <>
                  <button
                    className="profile-menu-dismiss"
                    aria-label="关闭操作菜单"
                    onClick={() => setProfileMenuOpen(false)}
                  />
                  <div
                    className="profile-popover sidebar-action-popover"
                    role="menu"
                  >
                    {currentUser.canPublish ? (
                      <>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            setPublishOpen(true);
                          }}
                        >
                          发布需求
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            openCreateProject();
                          }}
                        >
                          新建项目
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            setPersonalAccessTokenRequest((current) => current + 1);
                          }}
                        >
                          个人访问令牌
                        </button>
                      </>
                    ) : null}
                    <button
                      className="profile-toggle"
                      role="menuitemcheckbox"
                      aria-checked={showArchived}
                      onClick={toggleShowArchived}
                    >
                      <span>显示已作废项目和需求</span>
                      {showArchived ? <Icon name="check" /> : null}
                    </button>
                    {currentUser.isAdmin ? (
                      <>
                        <span className="sidebar-action-divider" />
                        <button
                          role="menuitem"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            setEmployeeManagerRequest((current) => current + 1);
                          }}
                        >
                          员工与权限
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            setModelManagerRequest((current) => current + 1);
                          }}
                        >
                          模型管理
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            setDifySettingsRequest((current) => current + 1);
                          }}
                        >
                          Dify 知识库
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            setGithubUpdateRequest((current) => current + 1);
                          }}
                        >
                          检查更新
                        </button>
                      </>
                    ) : null}
                    <span className="sidebar-action-divider" />
                    {currentUser.mode === "local" ? (
                      <a role="menuitem" href="/auth/login">
                        飞书登录
                      </a>
                    ) : (
                      <a role="menuitem" href="/auth/logout">
                        退出登录
                      </a>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </aside>
      ) : null}
      <main
        className={`main-panel ${view === "detail" && tab === "demo" ? "is-demo-view" : ""} ${view === "materials" ? "is-materials-view" : ""}`}
      >
        {view === "board" ? (
          <RequirementBoard
            projects={projects}
            onOpenProject={(project) => {
              setActiveProjectId(project.id);
              setView("requirements");
            }}
          />
        ) : view === "materials" ? (
          <MaterialLibrary projects={projects} canEdit={currentUser.canPublish} />
        ) : view === "projects" || (view === "requirements" && !activeProject) ? (
          <ProjectDirectory
            projects={projects}
            activeProjectId={activeProject?.id ?? ""}
            favoriteProjectIds={favoriteProjectIds}
            canManageProjects={currentUser.canPublish}
            onToggleFavorite={toggleFavorite}
            onOpenPublish={() => setPublishOpen(true)}
            onEditProject={openEditProject}
            onToggleArchive={(project) => void toggleProjectArchive(project)}
            onOpenProject={(project) => {
              setActiveProjectId(project.id);
              setView("requirements");
            }}
          />
        ) : view === "requirements" ? (
          <RequirementList
            project={activeProject!}
            requirements={projectRequirements}
            canManageRequirements={currentUser.canPublish}
            onToggleArchive={(requirement) =>
              void toggleRequirementArchive(requirement)
            }
            onUpdateReleaseStatus={(requirement, input) =>
              updateReleaseStatus(requirement.code, input)
            }
            onOpenRequirement={(requirement) =>
              void loadRequirement(requirement.code)
            }
          />
        ) : (
          <>
            <header className="requirement-header">
              <div className="title-row">
                <div className="title-leading">
                  <button
                    className="breadcrumb"
                    onClick={() => setView("requirements")}
                    title={`返回 ${activeProject!.name}`}
                    aria-label={`返回 ${activeProject!.name}`}
                  >
                    <Icon name="arrow" />
                    <span className="sr-only">返回 {activeProject!.name}</span>
                  </button>
                  <h1>
                    {detail!.requirement.title}
                    {detail!.requirement.archivedAt ||
                    detail!.project.archivedAt ? (
                      <em className="archive-badge">已作废</em>
                    ) : null}
                  </h1>
                  <RequirementReleaseStatus
                    requirement={detail!.requirement}
                    requirementCode={detail!.requirement.code}
                    projectId={detail!.project.id}
                    canEdit={
                      currentUser.canPublish &&
                      !detail!.requirement.archivedAt &&
                      !detail!.project.archivedAt
                    }
                    onChange={(input) =>
                      updateReleaseStatus(detail!.requirement.code, input)
                    }
                  />
                </div>
                <div
                  className="inline-tabs"
                  role="tablist"
                  aria-label="需求内容"
                >
                  <button
                    className={tab === "demo" ? "is-active" : ""}
                    onClick={() => setTab("demo")}
                    role="tab"
                    aria-selected={tab === "demo"}
                  >
                    Demo
                  </button>
                  <button
                    className={tab === "prd" ? "is-active" : ""}
                    onClick={() => setTab("prd")}
                    role="tab"
                    aria-selected={tab === "prd"}
                  >
                    PRD
                  </button>
                  <button
                    className={tab === "split" ? "is-active" : ""}
                    onClick={() => setTab("split")}
                    role="tab"
                    aria-selected={tab === "split"}
                  >
                    Demo+PRD
                  </button>
                  <button
                    className={tab === "test-cases" ? "is-active" : ""}
                    onClick={() => setTab("test-cases")}
                    role="tab"
                    aria-selected={tab === "test-cases"}
                  >
                    测试用例
                  </button>
                  <button
                    className={tab === "versions" ? "is-active" : ""}
                    onClick={() => setTab("versions")}
                    role="tab"
                    aria-selected={tab === "versions"}
                  >
                    版本
                  </button>
                </div>
                <div className="header-actions">
                  {currentUser.canPublish && !detail!.project.archivedAt ? (
                    <button
                      className={`icon-button detail-archive-button ${detail!.requirement.archivedAt ? "is-restore" : ""}`}
                      onClick={() =>
                        void toggleRequirementArchive({
                          code: detail!.requirement.code,
                          title: detail!.requirement.title,
                          latestVersion: selectedVersion!.number,
                          archivedAt: detail!.requirement.archivedAt,
                        })
                      }
                      title={
                        detail!.requirement.archivedAt ? "恢复需求" : "作废需求"
                      }
                    >
                      <Icon
                        name={
                          detail!.requirement.archivedAt ? "refresh" : "trash"
                        }
                      />
                    </button>
                  ) : null}
                  {currentUser.canPublish &&
                  !detail!.requirement.archivedAt &&
                  !detail!.project.archivedAt ? (
                    <button
                      className="publish-button publish-update-button"
                      onClick={() => setSnapshotPublishOpen(true)}
                    >
                      <Icon name="plus" />
                      发布新版本
                    </button>
                  ) : null}
                  <label className="version-select">
                    <span className="sr-only">选择版本</span>
                    <select
                      value={selectedVersion!.id}
                      onChange={(event) => selectVersion(event.target.value)}
                    >
                      {versions.map((version) => (
                        <option key={version.id} value={version.id}>
                          V{version.number}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="icon-button"
                    onClick={() => void copyLink()}
                    title="复制当前需求链接"
                  >
                    <Icon name="link" />
                  </button>
                </div>
              </div>
            </header>
            {notice && (
              <div className="notice">
                <Icon name="check" />
                {notice}
              </div>
            )}
            {error && <div className="notice error-notice">{error}</div>}
            {tab === "versions" ? (
              <VersionAssetsPanel
                requirementCode={detail!.requirement.code}
                versions={versions}
                selected={selectedVersion!}
                canPublish={currentUser.canPublish}
                onSelect={selectVersion}
                onRestore={(version) => void restoreVersion(version)}
              />
            ) : tab === "test-cases" ? (
              <TestCasesPanel
                requirementCode={detail!.requirement.code}
                versionNo={selectedVersion!.number}
              />
            ) : tab === "split" ? (
              <section
                ref={splitContainerRef}
                className={`content-surface is-split ${draggingSplit ? "is-resizing" : ""}`}
                style={{
                  gridTemplateColumns: `${splitRatio}fr 8px ${1 - splitRatio}fr`,
                }}
              >
                <div className="split-demo-pane">
                  {demoDocuments.length > 1 ? (
                    <div className="document-browser is-demo is-split-pane">
                      <VersionDocumentDirectory
                        documents={demoDocuments}
                        selectedId={selectedDemoDocument?.id ?? ""}
                        onSelect={setSelectedDemoDocumentId}
                        label="Demo 文件"
                      />
                      <div className="document-browser-content">
                        <DemoFrame viewport="desktop" src={selectedDemoUrl} />
                      </div>
                    </div>
                  ) : (
                    <DemoFrame viewport="desktop" src={selectedDemoUrl} />
                  )}
                </div>
                <div
                  className="split-divider"
                  role="separator"
                  aria-label="调整 Demo 与 PRD 的宽度"
                  aria-valuemin={20}
                  aria-valuemax={90}
                  aria-valuenow={Math.round(splitRatio * 100)}
                  tabIndex={0}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDraggingSplit(true);
                  }}
                />
                {prdDocuments.length > 1 ? (
                  <div className="document-browser is-prd is-split-pane">
                    <VersionDocumentDirectory
                      documents={prdDocuments}
                      selectedId={selectedPrdDocument?.id ?? ""}
                      onSelect={setSelectedPrdDocumentId}
                      label="PRD 文档"
                    />
                    <RequirementMarkdown
                      className="split-prd-pane"
                      source={selectedPrdSource}
                      demoEntryUrl={selectedDemoUrl}
                      assetBaseUrl={selectedPrdAssetBaseUrl}
                    />
                  </div>
                ) : (
                  <RequirementMarkdown
                    className="split-prd-pane"
                    source={selectedPrdSource}
                    demoEntryUrl={selectedDemoUrl}
                    assetBaseUrl={selectedPrdAssetBaseUrl}
                  />
                )}
              </section>
            ) : (
              <section
                className={`content-surface ${tab === "demo" ? "is-demo" : ""}`}
              >
                {tab === "demo" ? (
                  demoDocuments.length > 1 ? (
                    <div className="document-browser is-demo">
                      <VersionDocumentDirectory
                        documents={demoDocuments}
                        selectedId={selectedDemoDocument?.id ?? ""}
                        onSelect={setSelectedDemoDocumentId}
                        label="Demo 文件"
                      />
                      <div className="document-browser-content">
                        <DemoFrame viewport="desktop" src={selectedDemoUrl} />
                      </div>
                    </div>
                  ) : (
                    <DemoFrame viewport="desktop" src={selectedDemoUrl} />
                  )
                ) : (
                  prdDocuments.length > 1 ? (
                    <div className="document-browser is-prd">
                      <VersionDocumentDirectory
                        documents={prdDocuments}
                        selectedId={selectedPrdDocument?.id ?? ""}
                        onSelect={setSelectedPrdDocumentId}
                        label="PRD 文档"
                      />
                      <RequirementMarkdown
                        source={selectedPrdSource}
                        demoEntryUrl={selectedDemoUrl}
                        assetBaseUrl={selectedPrdAssetBaseUrl}
                      />
                    </div>
                  ) : (
                    <RequirementMarkdown
                      source={selectedPrdSource}
                      demoEntryUrl={selectedDemoUrl}
                      assetBaseUrl={selectedPrdAssetBaseUrl}
                    />
                  )
                )}
              </section>
            )}
            {tab === "prd" ? (
              <>
                <div className="version-facts">
                  <div>
                    <span>发布于</span>
                    <b>{selectedVersion!.publishedAt}</b>
                  </div>
                  <div>
                    <span>发布人</span>
                    <b>{selectedVersion!.publisher}</b>
                  </div>
                  <div>
                    <span>版本说明</span>
                    <b>{selectedVersion!.changeSummary}</b>
                  </div>
                </div>
                <RequirementGapsPanel
                  requirementCode={detail!.requirement.code}
                />
              </>
            ) : null}
            {tab !== "versions" && tab !== "test-cases" ? (
              <VersionDiscussion
                versionId={selectedVersion!.id}
                versionNo={selectedVersion!.number}
                label={tab === "prd" ? "PRD 评论" : "版本留言"}
                comments={comments}
                onAdd={addComment}
              />
            ) : null}
          </>
        )}
      </main>
      <RequirementAssistant
        key={
          view === "detail" && detail && selectedVersion
            ? `assistant-requirement-${detail.requirement.code}-${selectedVersion.number}`
            : `assistant-${view}-${activeProject?.id ?? "library"}`
        }
        context={
          view === "detail" && detail && selectedVersion
            ? {
                kind: "requirement",
                projectId: detail.project.id,
                projectName: detail.project.name,
                requirementCode: detail.requirement.code,
                requirementTitle: detail.requirement.title,
                versionNo: selectedVersion.number,
              }
            : view === "requirements" && activeProject
              ? {
                  kind: "project",
                  projectId: activeProject.id,
                  projectName: activeProject.name,
                }
              : { kind: "library" }
        }
        onOpenRequirement={(requirementCode, versionNo) =>
          void loadRequirement(requirementCode, versionNo)
        }
      />
      <PublishPanel
        key={`${detail?.requirement.code ?? "new"}-${publishOpen ? "open" : "closed"}`}
        projects={projects}
        open={publishOpen}
        initialProjectId={activeProject?.id}
        initialRequirementCode={detail?.requirement.code}
        initialTitle={detail?.requirement.title}
        onClose={() => setPublishOpen(false)}
        onPublished={(result) => void handlePublished(result)}
      />
      <SnapshotPublishDialog
        requirementCode={detail?.requirement.code ?? ""}
        open={snapshotPublishOpen}
        onClose={() => setSnapshotPublishOpen(false)}
        onPublished={() => {
          if (detail) void loadRequirement(detail.requirement.code);
        }}
      />
      <ProjectDialog
        key={`${editingProject?.id ?? "new"}-${projectDialogSession}`}
        project={editingProject}
        open={projectDialogOpen}
        onClose={() => setProjectDialogOpen(false)}
        onSaved={handleProjectSaved}
      />
    </div>
  );
}
