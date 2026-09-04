"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { DemoCommentFrame } from "@/components/demo-comment-frame";
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
import { RequirementShareDialog } from "@/components/requirement-share-dialog";
import { PrdCommentPanel } from "@/components/prd-comment-panel";
import { RequirementDiscussionPanel } from "@/components/requirement-discussion-panel";
import { VersionAssetsPanel } from "@/components/version-assets-panel";
import { Icon } from "@/components/icons";
import { RequirementMarkdown } from "@/components/requirement-markdown";
import { TestCasesPanel } from "@/components/test-cases-panel";
import { VersionDocumentDirectory } from "@/components/version-document-directory";
import { ProductSpecDialog } from "@/components/product-spec-dialog";
import { WaitingAuthorization } from "@/components/waiting-authorization";
import {
  RequirementReleaseStatus,
  type UpdateRequirementReleaseStatusInput,
} from "@/components/requirement-release-status";
import type {
  Project,
  HtmlCommentAnchor,
  PrdCommentAnchor,
  RequirementComment,
  RequirementDetail,
  RequirementDiscussion,
  RequirementDocument,
  RequirementDetailSummary,
  RequirementSummary,
  RequirementTimelineEvent,
  RequirementVersion,
  RequirementVersionSummary,
} from "@/lib/types";

type Tab = "demo" | "prd" | "split" | "test-cases" | "versions";
type View = "board" | "detail" | "projects" | "requirements" | "materials" | "my-requirements";
export type WorkspaceView = Exclude<View, "detail">;
type ApiResponse<T> =
  { data: T; error?: never } | { data?: never; error: string };
type CurrentUser = {
  openId?: string;
  name: string;
  initial: string;
  mode: "local" | "feishu";
  enabled?: boolean;
  pendingApproval?: boolean;
  canPublish?: boolean;
  isAdmin?: boolean;
};
type ProjectContextMenu = {
  project: Project;
  x: number;
  y: number;
} | null;
type RequirementTimelineGroup = {
  key: string;
  label: string;
  items: RequirementTimelineEvent[];
};
type RequirementTimelinePage = {
  view: "month" | "version";
  groups: RequirementTimelineGroup[];
  nextCursor?: string;
};
type MyRequirement = RequirementSummary & {
  projectId: string;
  projectName: string;
};
type MyRequirementTimelineGroup = {
  key: string;
  label: string;
  items: MyRequirement[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || "error" in body)
    throw new Error("error" in body ? body.error : "请求失败。");
  return body.data;
}

async function fetchRequirementData(requirementCode: string) {
  const code = encodeURIComponent(requirementCode);
  const [detail, versions] = await Promise.all([
    request<RequirementDetailSummary>(`/api/v1/requirements/${code}?meta=true`),
    request<RequirementVersionSummary[]>(`/api/v1/requirements/${code}/versions?meta=true`),
  ]);
  return { detail, versions };
}

async function fetchVersionDetail(requirementCode: string, versionNumber: number) {
  return request<RequirementVersion>(
    `/api/v1/requirements/${encodeURIComponent(requirementCode)}/versions/${versionNumber}`,
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // HTTP、本地调试或浏览器拒绝剪贴板权限时，继续使用兼容复制方式。
    }
  }

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  fallback.style.pointerEvents = "none";
  document.body.append(fallback);
  fallback.focus();
  fallback.select();
  fallback.setSelectionRange(0, value.length);
  const copied = document.execCommand("copy");
  fallback.remove();
  if (!copied) throw new Error("复制失败。");
}

function documentDownloadUrl(requirementCode: string, versionNo: number, kind: "prd" | "demo", documentPath?: string) {
  const params = new URLSearchParams({ kind });
  if (documentPath) params.set("path", documentPath);
  return `/api/v1/requirements/${encodeURIComponent(requirementCode)}/versions/${versionNo}/document?${params.toString()}`;
}

function ProjectDirectory({
  projects,
  activeProjectId,
  canManageProjects,
  onOpenProject,
  onOpenPublish,
  onEditProject,
  onToggleArchive,
}: {
  projects: Project[];
  activeProjectId: string;
  canManageProjects?: boolean;
  onOpenProject: (project: Project) => void;
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
  onOpenRequirement,
}: {
  projects: Project[];
  onOpenProject: (project: Project) => void;
  onOpenRequirement: (requirementCode: string) => void;
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
        onlineItems: [] as Array<{ projectName: string; requirementName: string }>,
        scheduledItems: [] as Array<{ projectName: string; requirementName: string }>,
      };
    });
    const byMonth = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    for (const project of projects) {
      for (const requirement of project.requirements) {
        const date = requirement.status === "online"
          ? requirement.releaseDate
          : requirement.status === "scheduled"
            ? requirement.scheduledFullDate ?? requirement.scheduledGrayDate
            : undefined;
        const month = date?.slice(0, 7);
        if (!month) continue;
        const item = {
          projectName: project.name,
          requirementName: requirement.title,
        };
        if (requirement.status === "online") byMonth.get(month)?.onlineItems.push(item);
        if (requirement.status === "scheduled") byMonth.get(month)?.scheduledItems.push(item);
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
        <div className="board-metric is-requirements">
          <span className="board-metric-icon"><Icon name="file" /></span>
          <div><small>需求总数</small><b>{overview.requirements}</b></div>
        </div>
        <div className="board-metric is-online">
          <span className="board-metric-icon"><Icon name="check" /></span>
          <div><small>已上线</small><b>{overview.online}</b></div>
        </div>
        <div className="board-metric is-ongoing">
          <span className="board-metric-icon"><Icon name="file" /></span>
          <div><small>进行中项目</small><b>{overview.ongoingProjects}</b></div>
        </div>
        <div className="board-metric is-offline">
          <span className="board-metric-icon"><Icon name="file" /></span>
          <div><small>未上线</small><b>{overview.offline}</b></div>
        </div>
        <div className="board-metric is-scheduled">
          <span className="board-metric-icon"><Icon name="file" /></span>
          <div><small>已排期</small><b>{overview.scheduled}</b></div>
        </div>
      </div>
      <MonthlyReleaseChart months={monthlyReleases} />
      <div className="board-project-list">
        <div className="board-project-list-head" aria-hidden="true">
          <span className="board-project-list-project">项目</span>
          <span>需求数</span>
          <span>已上线</span>
          <span>已排期</span>
          <span>未上线</span>
          <span />
        </div>
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
              className="board-project-row"
              onClick={() => onOpenProject(project)}
            >
              <span className="board-project-icon"><Icon name="folder" /></span>
              <span className="board-project-title">
                <b>{project.name}</b>
                <em className={`board-project-status ${ongoing ? "is-ongoing" : "is-complete"}`}>{ongoing ? "进行中" : "已全部上线"}</em>
              </span>
              <b className="board-project-value">{total}</b>
              <b className="board-project-value is-online">{online}</b>
              <b className="board-project-value is-scheduled">{scheduled}</b>
              <b className="board-project-value is-offline">{offline}</b>
              <Icon name="chevron" />
            </button>
          );
        })}
      </div>
      <BoardOwnerTable rows={ownerRows} />
      <RequirementTimeline onOpenRequirement={onOpenRequirement} />
    </div>
  );
}

function RequirementTimeline({ onOpenRequirement }: { onOpenRequirement: (requirementCode: string) => void }) {
  const [view, setView] = useState<"month" | "version">("month");
  const [groups, setGroups] = useState<RequirementTimelineGroup[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void request<RequirementTimelinePage>(`/api/v1/requirements/timeline?view=${view}`)
      .then((page) => {
        if (!active) return;
        setGroups(page.groups);
        setNextCursor(page.nextCursor);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "无法读取需求时间线。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [view]);

  const changeView = (nextView: "month" | "version") => {
    if (nextView === view) return;
    setLoading(true);
    setError("");
    setGroups([]);
    setNextCursor(undefined);
    setView(nextView);
  };

  const loadMore = useCallback(async () => {
    if (loading || !nextCursor) return;
    setLoading(true);
    try {
      const page = await request<RequirementTimelinePage>(`/api/v1/requirements/timeline?view=${view}&cursor=${encodeURIComponent(nextCursor)}`);
      setGroups((current) => [...current, ...page.groups]);
      setNextCursor(page.nextCursor);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取更多历史需求。");
    } finally {
      setLoading(false);
    }
  }, [loading, nextCursor, view]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !nextCursor) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, nextCursor]);

  return (
    <section className="requirement-timeline">
      <header>
        <div><Icon name="file" /><b>需求详细时间线</b><small>按业务日期展示已上线与已排期需求</small></div>
        <div className="timeline-view-switch" role="group" aria-label="时间线查看方式">
          <button className={view === "month" ? "is-active" : ""} onClick={() => changeView("month")}>按月份查看</button>
          <button className={view === "version" ? "is-active" : ""} onClick={() => changeView("version")}>按版本查看</button>
        </div>
      </header>
      {groups.map((group) => {
        const online = group.items.filter((item) => item.status === "online");
        const scheduled = group.items.filter((item) => item.status === "scheduled");
        return <article className="timeline-group" key={group.key}>
          <aside>
            <b>{group.label}</b>
            {view === "month" ? <small>{group.key.slice(0, 4)}年</small> : <small>按时间倒序</small>}
          </aside>
          <div className="timeline-group-content">
            {([online, scheduled] as const).map((items, index) => items.length ? <div className="timeline-status-group" key={index === 0 ? "online" : "scheduled"}>
              <b className={index === 0 ? "is-online" : "is-scheduled"}>{index === 0 ? "已上线" : "已排期"}<small>{items.length}</small></b>
              {items.map((item) => <button className="timeline-item" key={item.id} onClick={() => onOpenRequirement(item.requirementCode)}>
                <time>{item.eventDate.slice(8, 10)}日</time>
                <span>
                  <strong>{item.requirementName}</strong>
                  <small>{item.projectName}</small>
                </span>
                <span className="timeline-item-meta">
                  <b>{index === 0 ? `上线版本 ${item.version}` : `排期版本 ${item.version}`}</b>
                  <small>{index === 0 ? `上线时间 ${item.releaseDate ?? item.eventDate}` : `预计上线 ${item.scheduledFullDate ?? item.eventDate}`}</small>
                </span>
                <Icon name="chevron" />
              </button>)}
            </div> : null)}
          </div>
        </article>;
      })}
      {loading ? <p className="timeline-loading">正在加载…</p> : null}
      {!loading && !groups.length && !error ? <p className="timeline-empty">暂无带明确排期或上线日期的需求记录。</p> : null}
      {error ? <p className="timeline-error">{error}</p> : null}
      <div ref={loadMoreRef} className="timeline-load-more">{!loading && nextCursor ? "向下滚动加载更早记录" : !loading && groups.length ? "已加载全部历史记录" : null}</div>
    </section>
  );
}

function myRequirementEventDate(requirement: MyRequirement, status: "scheduled" | "online") {
  return status === "scheduled"
    ? requirement.scheduledFullDate ?? requirement.scheduledGrayDate
    : requirement.releaseDate;
}

function groupMyRequirementsByMonth(requirements: MyRequirement[], status: "scheduled" | "online"): MyRequirementTimelineGroup[] {
  const groups = new Map<string, MyRequirementTimelineGroup>();
  for (const requirement of requirements) {
    const eventDate = myRequirementEventDate(requirement, status);
    if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) continue;
    const key = eventDate.slice(0, 7);
    const month = Number(eventDate.slice(5, 7));
    const group = groups.get(key) ?? {
      key,
      label: status === "scheduled" ? `${month}月` : `${key.slice(0, 4)}年${month}月`,
      items: [],
    };
    group.items.push(requirement);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.toSorted((left, right) => {
        const leftDate = myRequirementEventDate(left, status) ?? "";
        const rightDate = myRequirementEventDate(right, status) ?? "";
        return rightDate.localeCompare(leftDate) || (right.createdAt ?? "").localeCompare(left.createdAt ?? "");
      }),
    }))
    .toSorted((left, right) => right.key.localeCompare(left.key));
}

function MyRequirementTimeline({
  title,
  status,
  requirements,
  onOpenRequirement,
}: {
  title: "已排期" | "已上线";
  status: "scheduled" | "online";
  requirements: MyRequirement[];
  onOpenRequirement: (requirementCode: string) => void;
}) {
  const groups = useMemo(() => groupMyRequirementsByMonth(requirements, status), [requirements, status]);
  const dateLabel = status === "scheduled" ? "预计全量" : "上线时间";
  const versionLabel = status === "scheduled" ? "排期版本" : "上线版本";
  return <section className="my-requirements-section my-requirements-timeline" aria-label={`${title}需求时间线`}>
    <header>
      <div><Icon name="file" /><b>{title}</b><small>{requirements.length}</small></div>
      <span>按月份查看</span>
    </header>
    {groups.length ? groups.map((group) => <article className="timeline-group" key={group.key}>
      <aside><b>{group.label}</b><small>{group.items.length} 个需求</small></aside>
      <div className="timeline-group-content">
        {group.items.map((requirement) => {
          const eventDate = myRequirementEventDate(requirement, status)!;
          const version = status === "scheduled" ? requirement.scheduleVersion : requirement.releaseVersion;
          return <button className="timeline-item" key={requirement.code} onClick={() => onOpenRequirement(requirement.code)}>
            <time>{eventDate.slice(8, 10)}日</time>
            <span><strong>{requirement.title}</strong><small>{requirement.projectName}</small></span>
            <span className="timeline-item-meta"><b>{versionLabel} {version || "--"}</b><small>{dateLabel} {eventDate}</small></span>
            <Icon name="chevron" />
          </button>;
        })}
      </div>
    </article>) : <p className="my-requirements-empty">暂无带明确{status === "scheduled" ? "预计全量" : "上线"}时间的需求。</p>}
  </section>;
}

function MonthlyReleaseChart({
  months,
}: {
  months: Array<{
    key: string;
    label: string;
    onlineItems: Array<{ projectName: string; requirementName: string }>;
    scheduledItems: Array<{ projectName: string; requirementName: string }>;
  }>;
}) {
  const [activeBar, setActiveBar] = useState<string | null>(null);
  const maxCount = Math.max(
    1,
    ...months.flatMap((month) => [month.onlineItems.length, month.scheduledItems.length]),
  );
  return (
    <section className="monthly-release-chart">
      <header>
        <div><Icon name="file" /><b>近 12 个月排期与上线情况</b></div>
        <small>橙色：已排期 · 蓝色：已上线 · 悬停查看需求</small>
      </header>
      {months.length ? <div className="monthly-release-bars" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
        {months.map((month) => <div className="monthly-release-column" key={month.key}>
          <div className="monthly-release-track">
            {([
              { kind: "scheduled", label: "已排期", items: month.scheduledItems },
              { kind: "online", label: "已上线", items: month.onlineItems },
            ] as const).map((bar) => {
              const count = bar.items.length;
              const barId = `${month.key}-${bar.kind}`;
              const groupedItems = new Map<string, Array<{ projectName: string; requirementName: string }>>();
              for (const item of bar.items) {
                const items = groupedItems.get(item.projectName) ?? [];
                items.push(item);
                groupedItems.set(item.projectName, items);
              }
              return <button
                className={`monthly-release-bar is-${bar.kind} ${count ? "has-data" : ""}`}
                key={bar.kind}
                style={{ height: `${Math.max(4, (count / maxCount) * 100)}%` }}
                onMouseEnter={() => setActiveBar(barId)}
                onMouseLeave={() => setActiveBar(null)}
                onFocus={() => setActiveBar(barId)}
                onBlur={() => setActiveBar(null)}
                aria-label={`${month.key} ${bar.label} ${count} 个需求`}
              >
                {count ? <span>{count}</span> : null}
                {activeBar === barId ? <div className="monthly-release-tooltip" role="tooltip">
                  <b>{month.key} · {bar.label} {count} 个需求</b>
                  {count ? Array.from(groupedItems, ([projectName, items]) => <div key={projectName}>
                    <strong>{projectName}</strong>
                    <ul>{items.map((item) => <li key={`${projectName}-${item.requirementName}`}>{item.requirementName}</li>)}</ul>
                  </div>) : <span>当月暂无{bar.label}需求</span>}
                </div> : null}
              </button>;
            })}
          </div>
          <small>{month.label}</small>
        </div>)}
      </div> : <p className="monthly-release-empty">近 12 个月暂无已排期或已上线的需求。</p>}
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

function MyRequirements({
  onOpenRequirement,
}: {
  onOpenRequirement: (requirementCode: string) => void;
}) {
  const [myRequirements, setMyRequirements] = useState<MyRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void request<MyRequirement[]>("/api/v1/requirements/mine")
      .then((requirements) => {
        if (cancelled) return;
        setMyRequirements(requirements);
        setLoadError("");
      })
      .catch((reason) => {
        if (cancelled) return;
        setLoadError(reason instanceof Error ? reason.message : "无法读取我的需求。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const offlineRequirements = useMemo(
    () => myRequirements.filter((requirement) => (requirement.status ?? "offline") === "offline"),
    [myRequirements],
  );
  const scheduledRequirements = useMemo(
    () => myRequirements.filter((requirement) => requirement.status === "scheduled"),
    [myRequirements],
  );
  const onlineRequirements = useMemo(
    () => myRequirements.filter((requirement) => requirement.status === "online"),
    [myRequirements],
  );
  const ongoingProjects = useMemo(
    () => new Set([...offlineRequirements, ...scheduledRequirements].map((requirement) => requirement.projectId)).size,
    [offlineRequirements, scheduledRequirements],
  );
  return (
    <section className="my-requirements-page" aria-label="我的需求">
      <header>
        <h1>我的需求</h1>
        <div className="my-requirements-overview">
          <div className="board-metric is-ongoing"><span className="board-metric-icon"><Icon name="folder" /></span><div><small>进行中项目</small><b>{ongoingProjects}</b></div></div>
          <div className="board-metric is-offline"><span className="board-metric-icon"><Icon name="file" /></span><div><small>未上线</small><b>{offlineRequirements.length}</b></div></div>
          <div className="board-metric is-scheduled"><span className="board-metric-icon"><Icon name="file" /></span><div><small>已排期</small><b>{scheduledRequirements.length}</b></div></div>
        </div>
      </header>
      {loading ? <p className="my-requirements-empty">正在加载我的需求...</p> : loadError ? (
        <p className="my-requirements-empty is-error">{loadError}</p>
      ) : <>
        <section className="my-requirements-section" aria-label="未上线需求">
          <header><div><Icon name="file" /><b>未上线</b><small>{offlineRequirements.length}</small></div></header>
          {offlineRequirements.length ? <div className="my-requirements-list">
            <div className="my-requirements-head"><span>需求名称</span><span>所属项目</span><span>创建时间</span></div>
            {offlineRequirements.map((requirement) => <button key={requirement.code} type="button" onClick={() => onOpenRequirement(requirement.code)}>
              <span><small>{requirement.code}</small><b title={requirement.title}>{requirement.title}</b></span>
              <span title={requirement.projectName}>{requirement.projectName}</span>
              <time>{requirement.createdAt ?? "--"}</time>
            </button>)}
          </div> : <p className="my-requirements-empty">暂无未上线需求。</p>}
        </section>
        <MyRequirementTimeline title="已排期" status="scheduled" requirements={scheduledRequirements} onOpenRequirement={onOpenRequirement} />
        <MyRequirementTimeline title="已上线" status="online" requirements={onlineRequirements} onOpenRequirement={onOpenRequirement} />
      </>}
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
  initialReturnTo,
  initialView,
  initialProjectId,
  startInDetail = false,
  forceWaitingAuthorization = false,
}: {
  initialRequirementCode?: string;
  initialVersionNumber?: number;
  initialReturnTo?: string;
  initialView?: WorkspaceView;
  initialProjectId?: string;
  startInDetail?: boolean;
  forceWaitingAuthorization?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(startInDetail ? "detail" : initialView ?? "board");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectRequirements, setProjectRequirements] = useState<
    RequirementSummary[]
  >([]);
  const [activeProjectId, setActiveProjectId] = useState(initialProjectId ?? "");
  const [detail, setDetail] = useState<RequirementDetail | RequirementDetailSummary | null>(null);
  const [versions, setVersions] = useState<RequirementVersion[]>([]);
  const [loadedVersionDetails, setLoadedVersionDetails] = useState<Record<string, RequirementVersion>>({});
  const [loadingVersionId, setLoadingVersionId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedPrdDocumentId, setSelectedPrdDocumentId] = useState("");
  const [selectedDemoDocumentId, setSelectedDemoDocumentId] = useState("");
  const [prdComments, setPrdComments] = useState<RequirementComment[]>([]);
  const [prdCommentPositions, setPrdCommentPositions] = useState<Record<string, number>>({});
  const [prdCommentsOpen, setPrdCommentsOpen] = useState(false);
  const [activePrdCommentId, setActivePrdCommentId] = useState<string | null>(null);
  const [prdCommentMode, setPrdCommentMode] = useState(false);
  const [htmlComments, setHtmlComments] = useState<RequirementComment[]>([]);
  const [htmlCommentMode, setHtmlCommentMode] = useState(false);
  const [discussions, setDiscussions] = useState<RequirementDiscussion[]>([]);
  const [discussionsOpen, setDiscussionsOpen] = useState(false);
  const [documentRefreshKey, setDocumentRefreshKey] = useState(0);
  const [refreshingRequirement, setRefreshingRequirement] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser>({
    name: "本地开发身份",
    initial: "用",
    mode: "local",
  });
  const [tab, setTab] = useState<Tab>("demo");
  const [notice, setNotice] = useState("");
  const [commentModeNotice, setCommentModeNotice] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
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
  const [productSpecOpen, setProductSpecOpen] = useState(false);
  const [revealedPersonalAccessToken, setRevealedPersonalAccessToken] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [snapshotPublishOpen, setSnapshotPublishOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSession, setShareSession] = useState(0);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectDialogSession, setProjectDialogSession] = useState(0);
  const [projectContextMenu, setProjectContextMenu] =
    useState<ProjectContextMenu>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const selectVersion = useCallback((versionId: string) => {
    setSelectedVersionId(versionId);
    setSelectedPrdDocumentId("");
    setSelectedDemoDocumentId("");
  }, []);

  const selectedVersion = useMemo(
    () =>
      loadedVersionDetails[selectedVersionId] ??
      versions.find((version) => version.id === selectedVersionId) ??
      versions[0],
    [loadedVersionDetails, selectedVersionId, versions],
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
  const selectedVersionLoaded = Boolean(selectedVersion && loadedVersionDetails[selectedVersion.id]);
  const prdThreadCount = prdComments.filter((comment) => !comment.parentId).length;
  const openDiscussionCount = discussions.filter((item) => !item.parentId && item.status !== "closed").length;
  const canProcessDiscussions = Boolean(
    currentUser.canPublish ||
    currentUser.isAdmin ||
    (detail?.requirement.ownerId && detail.requirement.ownerId === currentUser.openId) ||
    (detail?.requirement.owner && detail.requirement.owner === currentUser.name),
  );
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ??
    detail?.project ??
    projects[0];

  const loadSelectedVersionDetail = useCallback(async () => {
    if (!detail || !selectedVersion || loadedVersionDetails[selectedVersion.id] || loadingVersionId === selectedVersion.id) return;
    setLoadingVersionId(selectedVersion.id);
    try {
      const loaded = await fetchVersionDetail(detail.requirement.code, selectedVersion.number);
      setLoadedVersionDetails((current) => ({ ...current, [loaded.id]: loaded }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取当前版本内容。");
    } finally {
      setLoadingVersionId((current) => current === selectedVersion.id ? null : current);
    }
  }, [detail, loadedVersionDetails, loadingVersionId, selectedVersion]);

  const selectTab = useCallback((nextTab: Tab) => {
    setTab(nextTab);
    if (nextTab === "prd" || nextTab === "split" || nextTab === "versions") void loadSelectedVersionDetail();
  }, [loadSelectedVersionDetail]);

  const handleSelectVersion = useCallback((versionId: string) => {
    selectVersion(versionId);
    const nextVersion = versions.find((version) => version.id === versionId);
    const requirementCode = detail?.requirement.code;
    if (!nextVersion || !requirementCode || loadedVersionDetails[nextVersion.id] || (tab !== "prd" && tab !== "split" && tab !== "versions")) return;
    setLoadingVersionId(nextVersion.id);
    void fetchVersionDetail(requirementCode, nextVersion.number)
      .then((loaded) => {
        setLoadedVersionDetails((current) => ({ ...current, [loaded.id]: loaded }));
        setError("");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取当前版本内容。"))
      .finally(() => setLoadingVersionId((current) => current === nextVersion.id ? null : current));
  }, [detail?.requirement.code, loadedVersionDetails, selectVersion, tab, versions]);

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
    const stored = window.localStorage.getItem(showArchivedKey);
    const timer = window.setTimeout(
      () => setShowArchived(stored === "true"),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [showArchivedKey]);

  useEffect(() => {
    const requirementCode = detail?.requirement.code;
    const versionId = selectedVersion?.id;
    const documentId = selectedPrdDocument?.id;
    if (tab !== "prd" && tab !== "split") return;
    if (!requirementCode || !versionId || !documentId || !selectedPrdSource) return;
    let active = true;
    void request<RequirementComment[]>(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/comments?version_id=${encodeURIComponent(versionId)}&document_id=${encodeURIComponent(documentId)}`)
      .then((comments) => { if (active) { setPrdComments(comments); setActivePrdCommentId(null); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取 PRD 评论。"); });
    return () => { active = false; };
  }, [detail?.requirement.code, selectedPrdDocument?.id, selectedVersion?.id, selectedPrdSource, tab]);

  useEffect(() => {
    const requirementCode = detail?.requirement.code;
    const versionId = selectedVersion?.id;
    const documentId = selectedDemoDocument?.id;
    if (!requirementCode || !versionId || !documentId) return;
    let active = true;
    void request<RequirementComment[]>(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/comments?version_id=${encodeURIComponent(versionId)}&document_id=${encodeURIComponent(documentId)}&kind=html`)
      .then((comments) => { if (active) setHtmlComments(comments); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取 HTML 评论。"); });
    return () => { active = false; };
  }, [detail?.requirement.code, selectedDemoDocument?.id, selectedVersion?.id]);

  // This discussion stream is intentionally scoped only by requirement code:
  // switching Demo, PRD, or a historical version must not change it.
  useEffect(() => {
    const requirementCode = detail?.requirement.code;
    if (!requirementCode) return;
    let active = true;
    void request<RequirementDiscussion[]>(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/discussions`)
      .then((items) => {
        if (!active) return;
        setDiscussions(items);
        // Keep a manually opened empty panel open while the first data request
        // settles; existing discussions still open the panel by default.
        setDiscussionsOpen((open) => open || items.some((item) => !item.parentId));
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "无法读取需求讨论。");
      });
    return () => { active = false; };
  }, [detail?.requirement.code]);

  useEffect(() => {
    const openTestCases = () => setTab("test-cases");
    window.addEventListener("requirement-open-test-cases", openTestCases);
    return () =>
      window.removeEventListener("requirement-open-test-cases", openTestCases);
  }, []);

  useEffect(() => {
    if (!projectContextMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectContextMenu(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [projectContextMenu]);

  useEffect(() => {
    // The detail shell already has the requirement and project metadata. Load
    // the full project requirement list only when the list view is visible.
    if (!activeProjectId || view !== "requirements") return;
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
  }, [activeProjectId, showArchived, view]);

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

  const showCommentModeNotice = useCallback(() => {
    setCommentModeNotice(true);
    window.setTimeout(() => setCommentModeNotice(false), 2200);
  }, []);

  const loadRequirement = useCallback(
    async (requirementCode: string, versionNumber?: number) => {
      try {
        const { detail: nextDetail, versions: nextVersions } = await fetchRequirementData(requirementCode);
        setDetail(nextDetail);
        setVersions(nextVersions);
        setLoadedVersionDetails({});
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

  const refreshCurrentRequirement = useCallback(async () => {
    if (!detail || !selectedVersion || refreshingRequirement) return;
    const versionNumber = selectedVersion.number;
    const prdDocumentId = selectedPrdDocumentId;
    const demoDocumentId = selectedDemoDocumentId;
    setRefreshingRequirement(true);
    try {
      const [{ detail: nextDetail, versions: nextVersions }, refreshedVersion] = await Promise.all([
        fetchRequirementData(detail.requirement.code),
        fetchVersionDetail(detail.requirement.code, versionNumber),
      ]);
      const nextVersion = nextVersions.find((version) => version.number === versionNumber) ?? nextDetail.currentVersion;
      setDetail(nextDetail);
      setVersions(nextVersions);
      setLoadedVersionDetails({ [refreshedVersion.id]: refreshedVersion });
      setSelectedVersionId(nextVersion.id);
      setSelectedPrdDocumentId(prdDocumentId);
      setSelectedDemoDocumentId(demoDocumentId);
      setDocumentRefreshKey((current) => current + 1);
      setError("");
      showNotice("已刷新当前版本的 Demo 和 PRD 内容");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "刷新当前需求失败。");
    } finally {
      setRefreshingRequirement(false);
    }
  }, [detail, refreshingRequirement, selectedDemoDocumentId, selectedPrdDocumentId, selectedVersion, showNotice]);

  const openRequirement = useCallback(
    (requirementCode: string, versionNumber?: number) => {
      const returnQuery = new URLSearchParams();
      if (view !== "board") returnQuery.set("view", view);
      if (view === "requirements" && activeProjectId) returnQuery.set("project", activeProjectId);
      const returnTo = `/${returnQuery.toString() ? `?${returnQuery.toString()}` : ""}`;
      const query = new URLSearchParams({ returnTo });
      if (versionNumber !== undefined) query.set("v", String(versionNumber));
      router.push(`/r/${encodeURIComponent(requirementCode)}?${query.toString()}`);
    },
    [activeProjectId, router, view],
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
        const projectsPromise = request<Project[]>("/api/v1/projects");
        if (startInDetail && initialRequirementCode) {
          const result = await fetchRequirementData(initialRequirementCode);
          setDetail(result.detail);
          setVersions(result.versions);
          setLoadedVersionDetails({});
          setActiveProjectId(result.detail.project.id);
          selectVersion(
            result.versions.find(
              (version) => version.number === initialVersionNumber,
            )?.id ?? result.detail.currentVersion.id,
          );
          setLoading(false);
          void projectsPromise
            .then(setProjects)
            .catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取项目目录。"));
          return;
        } else {
          const nextProjects = await projectsPromise;
          setProjects(nextProjects);
          setActiveProjectId(initialProjectId ?? "");
          setView(initialView ?? "board");
        }
        setLoading(false);
      })
      .catch((reason) => {
        setError(
          reason instanceof Error ? reason.message : "无法读取项目数据。",
        );
        setLoading(false);
      });
  }, [initialProjectId, initialRequirementCode, initialVersionNumber, initialView, selectVersion, startInDetail]);

  async function copyLink() {
    if (!detail || !selectedVersion) return;
    const url = `${window.location.origin}/r/${detail.requirement.code}${selectedVersion.id === detail.currentVersion.id ? "" : `?v=${selectedVersion.number}`}`;
    try {
      await copyText(url);
      setCopyNotice("链接已复制");
      window.setTimeout(() => setCopyNotice(""), 2200);
    } catch {
      setError("无法自动复制链接，请手动复制浏览器地址。");
    }
  }

  async function createPrdComment(content: string, anchor: PrdCommentAnchor) {
    if (!detail || !selectedVersion || !selectedPrdDocument) throw new Error("当前 PRD 不可用。");
    const comment = await request<RequirementComment>(`/api/v1/requirements/${encodeURIComponent(detail.requirement.code)}/comments`, { method: "POST", body: JSON.stringify({ version_id: selectedVersion.id, document_id: selectedPrdDocument.id, content, anchor }) });
    setPrdComments((current) => [...current, comment]);
    return comment;
  }

  async function replyPrdComment(threadId: string, content: string) {
    if (!detail || !selectedVersion || !selectedPrdDocument) throw new Error("当前 PRD 不可用。");
    const comment = await request<RequirementComment>(`/api/v1/requirements/${encodeURIComponent(detail.requirement.code)}/comments`, { method: "POST", body: JSON.stringify({ version_id: selectedVersion.id, document_id: selectedPrdDocument.id, parent_id: threadId, content }) });
    setPrdComments((current) => [...current, comment]);
    return comment;
  }

  async function createHtmlComment(content: string, anchor: HtmlCommentAnchor) {
    if (!detail || !selectedVersion || !selectedDemoDocument) throw new Error("当前 HTML Demo 不可用。");
    const comment = await request<RequirementComment>(`/api/v1/requirements/${encodeURIComponent(detail.requirement.code)}/comments`, { method: "POST", body: JSON.stringify({ version_id: selectedVersion.id, document_id: selectedDemoDocument.id, kind: "html", content, anchor: { ...anchor, documentId: selectedDemoDocument.id, documentPath: selectedDemoDocument.path } }) });
    setHtmlComments((current) => [...current, comment]);
    return comment;
  }

  async function replyHtmlComment(threadId: string, content: string) {
    if (!detail || !selectedVersion || !selectedDemoDocument) throw new Error("当前 HTML Demo 不可用。");
    const comment = await request<RequirementComment>(`/api/v1/requirements/${encodeURIComponent(detail.requirement.code)}/comments`, { method: "POST", body: JSON.stringify({ version_id: selectedVersion.id, document_id: selectedDemoDocument.id, kind: "html", parent_id: threadId, content }) });
    setHtmlComments((current) => [...current, comment]);
    return comment;
  }

  async function updateRequirementComment(comment: RequirementComment, content: string) {
    const updated = await request<RequirementComment>(`/api/v1/requirements/${encodeURIComponent(comment.requirementCode)}/comments/${encodeURIComponent(comment.id)}`, { method: "PATCH", body: JSON.stringify({ content }) });
    if (updated.kind === "html") setHtmlComments((current) => current.map((item) => item.id === updated.id ? updated : item));
    else setPrdComments((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function deleteRequirementComment(comment: RequirementComment) {
    const updated = await request<RequirementComment>(`/api/v1/requirements/${encodeURIComponent(comment.requirementCode)}/comments/${encodeURIComponent(comment.id)}`, { method: "DELETE" });
    if (updated.kind === "html") setHtmlComments((current) => current.map((item) => item.id === updated.id ? updated : item));
    else setPrdComments((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function createRequirementDiscussion(content: string) {
    if (!detail) throw new Error("当前需求不可用。");
    const discussion = await request<RequirementDiscussion>(`/api/v1/requirements/${encodeURIComponent(detail.requirement.code)}/discussions`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    setDiscussions((current) => [...current, discussion]);
    setDiscussionsOpen(true);
  }

  async function replyRequirementDiscussion(threadId: string, content: string) {
    if (!detail) throw new Error("当前需求不可用。");
    const reply = await request<RequirementDiscussion>(`/api/v1/requirements/${encodeURIComponent(detail.requirement.code)}/discussions`, {
      method: "POST",
      body: JSON.stringify({ parent_id: threadId, content }),
    });
    setDiscussions((current) => [...current, reply]);
  }

  async function processRequirementDiscussion(threadId: string, resolution: "resolved" | "rejected" | "related_requirement", note: string, relatedRequirementCode?: string) {
    if (!detail) throw new Error("当前需求不可用。");
    const updated = await request<RequirementDiscussion>(`/api/v1/requirements/${encodeURIComponent(detail.requirement.code)}/discussions/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "process", resolution, note, related_requirement_code: relatedRequirementCode }),
    });
    setDiscussions((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function updateRequirementDiscussion(item: RequirementDiscussion, content: string) {
    const updated = await request<RequirementDiscussion>(`/api/v1/requirements/${encodeURIComponent(item.requirementCode)}/discussions/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
    setDiscussions((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
  }

  async function deleteRequirementDiscussion(item: RequirementDiscussion) {
    const updated = await request<RequirementDiscussion>(`/api/v1/requirements/${encodeURIComponent(item.requirementCode)}/discussions/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    setDiscussions((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
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
      selectTab("versions");
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

  function openProjectContextMenu(
    event: MouseEvent<HTMLButtonElement>,
    project: Project,
  ) {
    if (!currentUser.canPublish) return;
    event.preventDefault();
    const menuWidth = 168;
    const menuHeight = project.archivedAt ? 92 : 124;
    setProjectContextMenu({
      project,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    });
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
            {currentUser.canPublish ? (
              <button
                className={`nav-item ${view === "my-requirements" ? "is-selected" : ""}`}
                onClick={() => setView("my-requirements")}
              >
                <Icon name="file" />
                <span>我的需求</span>
              </button>
            ) : null}
            <button
              className={`nav-item ${view === "materials" ? "is-selected" : ""}`}
              onClick={() => setView("materials")}
            >
              <Icon name="file" />
              <span>资料库</span>
            </button>
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
                onContextMenu={(event) => openProjectContextMenu(event, project)}
                onClick={() => {
                  setProjectContextMenu(null);
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
          {projectContextMenu ? (
            <>
              <button
                className="project-context-menu-dismiss"
                aria-label="关闭项目操作菜单"
                onClick={() => setProjectContextMenu(null)}
              />
              <div
                className="project-context-menu"
                style={{ left: projectContextMenu.x, top: projectContextMenu.y }}
                role="menu"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    const project = projectContextMenu.project;
                    setProjectContextMenu(null);
                    openEditProject(project);
                  }}
                >
                  <Icon name="edit" />
                  <span>重命名</span>
                </button>
                <button
                  className={projectContextMenu.project.archivedAt ? "" : "is-danger"}
                  role="menuitem"
                  onClick={() => {
                    const project = projectContextMenu.project;
                    setProjectContextMenu(null);
                    void toggleProjectArchive(project);
                  }}
                >
                  <Icon name={projectContextMenu.project.archivedAt ? "refresh" : "trash"} />
                  <span>{projectContextMenu.project.archivedAt ? "恢复项目" : "作废项目"}</span>
                </button>
              </div>
            </>
          ) : null}
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
                revealedToken={revealedPersonalAccessToken}
                onRevealToken={setRevealedPersonalAccessToken}
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
        className={`main-panel ${view === "detail" && tab === "demo" ? "is-demo-view" : ""} ${view === "materials" ? "is-materials-view" : ""} ${prdCommentsOpen && (tab === "prd" || tab === "split") ? "has-prd-comments-panel" : ""}`}
      >
        {view === "board" ? (
          <RequirementBoard
            projects={projects}
            onOpenProject={(project) => {
              setActiveProjectId(project.id);
              setView("requirements");
            }}
            onOpenRequirement={openRequirement}
          />
        ) : view === "my-requirements" && currentUser.canPublish ? (
          <MyRequirements
            onOpenRequirement={openRequirement}
          />
        ) : view === "materials" ? (
          <MaterialLibrary projects={projects} canEdit={currentUser.canPublish} />
        ) : view === "projects" || (view === "requirements" && !activeProject) ? (
          <ProjectDirectory
            projects={projects}
            activeProjectId={activeProject?.id ?? ""}
            canManageProjects={currentUser.canPublish}
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
            onOpenRequirement={(requirement) => openRequirement(requirement.code)}
          />
        ) : (
          <>
            <header className="requirement-header">
              <div className="title-row">
                <div className="title-leading">
                  <button
                    className="breadcrumb"
                    onClick={() => {
                      if (startInDetail) {
                        if (initialReturnTo) router.push(initialReturnTo);
                        else if (window.history.length > 1) router.back();
                        else router.push("/");
                      }
                      else setView("requirements");
                    }}
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
                    onClick={() => selectTab("demo")}
                    role="tab"
                    aria-selected={tab === "demo"}
                  >
                    Demo
                  </button>
                  <button
                    className={tab === "prd" ? "is-active" : ""}
                    onClick={() => selectTab("prd")}
                    role="tab"
                    aria-selected={tab === "prd"}
                  >
                    PRD
                  </button>
                  <button
                    className={tab === "split" ? "is-active" : ""}
                    onClick={() => selectTab("split")}
                    role="tab"
                    aria-selected={tab === "split"}
                  >
                    Demo+PRD
                  </button>
                  <button
                    className={tab === "test-cases" ? "is-active" : ""}
                    onClick={() => selectTab("test-cases")}
                    role="tab"
                    aria-selected={tab === "test-cases"}
                  >
                    测试用例
                  </button>
                  <button
                    className={tab === "versions" ? "is-active" : ""}
                    onClick={() => selectTab("versions")}
                    role="tab"
                    aria-selected={tab === "versions"}
                  >
                    版本
                  </button>
                </div>
                <div className="header-actions">
                  <button className={`icon-button${discussionsOpen ? " is-active" : ""}`} onClick={() => setDiscussionsOpen((open) => !open)} title={`需求讨论${openDiscussionCount ? `（待处理 ${openDiscussionCount}）` : ""}`} aria-label="打开需求讨论"><Icon name="messages" />{openDiscussionCount ? <b className="prd-comment-count">{openDiscussionCount}</b> : null}</button>
                  {currentUser.canPublish ? <button className="icon-button product-spec-trigger" onClick={() => setProductSpecOpen(true)} title="提取产品规范" aria-label="提取产品规范"><Icon name="sparkles" /></button> : null}
                  {tab === "prd" || tab === "split" ? <button className={`icon-button${prdCommentMode ? " is-active" : ""}`} onClick={() => { const next = !prdCommentMode; setPrdCommentMode(next); if (next) showCommentModeNotice(); }} title={`PRD 评论${prdThreadCount ? `（${prdThreadCount}）` : ""}`} aria-label="进入 PRD 评论态"><Icon name="message" />{prdThreadCount ? <b className="prd-comment-count">{prdThreadCount}</b> : null}</button> : null}
                  {tab === "demo" || tab === "split" ? (
                    <a
                      className="icon-button"
                      href={documentDownloadUrl(detail!.requirement.code, selectedVersion!.number, "demo", selectedDemoDocument?.path)}
                      title="下载当前 Demo 文件"
                      aria-label="下载当前 Demo 文件"
                    >
                      <Icon name="download" />
                    </a>
                  ) : null}
                  {tab === "prd" || tab === "split" ? (
                    <a
                      className="icon-button"
                      href={documentDownloadUrl(detail!.requirement.code, selectedVersion!.number, "prd", selectedPrdDocument?.path)}
                      title="下载当前 PRD 文件"
                      aria-label="下载当前 PRD 文件"
                    >
                      <Icon name="download" />
                    </a>
                  ) : null}
                  <button
                    className={`icon-button${refreshingRequirement ? " is-refreshing" : ""}`}
                    onClick={() => void refreshCurrentRequirement()}
                    disabled={refreshingRequirement}
                    title={refreshingRequirement ? "正在刷新当前需求" : "刷新当前需求"}
                    aria-label={refreshingRequirement ? "正在刷新当前需求" : "刷新当前需求"}
                  >
                    <Icon name="refresh" />
                  </button>
                  {currentUser.canPublish ? (
                    <button
                      className="icon-button"
                      onClick={() => {
                        setShareSession((current) => current + 1);
                        setShareOpen(true);
                      }}
                      title="分享需求"
                      aria-label="分享需求"
                    >
                      <Icon name="send" />
                    </button>
                  ) : null}
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
                      className="icon-button publish-update-button"
                      onClick={() => setSnapshotPublishOpen(true)}
                      title="发布新版本"
                      aria-label="发布新版本"
                    >
                      <Icon name="plus" />
                    </button>
                  ) : null}
                  <label className="version-select">
                    <span className="sr-only">选择版本</span>
                    <select
                      value={selectedVersion!.id}
                      onChange={(event) => handleSelectVersion(event.target.value)}
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
              <div className="workspace-toast" role="status">
                <Icon name="check" />
                {notice}
              </div>
            )}
            {commentModeNotice ? <div className="comment-mode-toast" role="status"><Icon name="check" />已进入评论态</div> : null}
            {copyNotice ? (
              <div className="copy-toast" role="status" aria-live="polite">
                <Icon name="check" />
                {copyNotice}
              </div>
            ) : null}
            {error && <div className="workspace-toast is-error" role="alert">{error}</div>}
            {tab === "versions" ? (
              <VersionAssetsPanel
                requirementCode={detail!.requirement.code}
                versions={versions}
                selected={selectedVersion!}
                canPublish={currentUser.canPublish}
                onSelect={handleSelectVersion}
                onRestore={(version) => void restoreVersion(version)}
              />
            ) : tab === "test-cases" ? (
              <TestCasesPanel
                requirementCode={detail!.requirement.code}
                versionNo={selectedVersion!.number}
              />
            ) : (tab === "prd" || tab === "split") && !selectedVersionLoaded ? (
              <section className="content-surface content-loading-state" aria-busy={loadingVersionId === selectedVersion?.id}>
                <p>{loadingVersionId === selectedVersion?.id ? "正在加载 PRD…" : "当前版本 PRD 暂不可用，请点击刷新重试。"}</p>
              </section>
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
                        <DemoCommentFrame viewport="desktop" src={selectedDemoUrl} refreshKey={documentRefreshKey} commentMode={htmlCommentMode} comments={htmlComments} actor={{ id: currentUser.openId, name: currentUser.name, initial: currentUser.initial }} onCommentModeChange={setHtmlCommentMode} onCreateComment={createHtmlComment} onReply={replyHtmlComment} onUpdate={updateRequirementComment} onDelete={deleteRequirementComment} />
                      </div>
                    </div>
                  ) : (
                    <DemoCommentFrame viewport="desktop" src={selectedDemoUrl} refreshKey={documentRefreshKey} commentMode={htmlCommentMode} comments={htmlComments} actor={{ id: currentUser.openId, name: currentUser.name, initial: currentUser.initial }} onCommentModeChange={setHtmlCommentMode} onCreateComment={createHtmlComment} onReply={replyHtmlComment} onUpdate={updateRequirementComment} onDelete={deleteRequirementComment} />
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
                      documentId={selectedPrdDocument?.id}
                      documentPath={selectedPrdDocument?.path}
                      comments={prdComments}
                      commenterInitial={currentUser.initial}
                      commentMode={prdCommentMode}
                      onCreateComment={createPrdComment}
                      onCommentPositions={setPrdCommentPositions}
                      onOpenComment={() => { setActivePrdCommentId(null); setPrdCommentsOpen(true); }}
                    />
                  </div>
                ) : (
                  <RequirementMarkdown
                    className="split-prd-pane"
                    source={selectedPrdSource}
                    demoEntryUrl={selectedDemoUrl}
                    assetBaseUrl={selectedPrdAssetBaseUrl}
                    documentId={selectedPrdDocument?.id}
                    documentPath={selectedPrdDocument?.path}
                    comments={prdComments}
                    commenterInitial={currentUser.initial}
                    commentMode={prdCommentMode}
                    onCreateComment={createPrdComment}
                    onCommentPositions={setPrdCommentPositions}
                    onOpenComment={() => { setActivePrdCommentId(null); setPrdCommentsOpen(true); }}
                  />
                )}
              </section>
            ) : (
              <section
                className={`content-surface ${tab === "demo" ? "is-demo" : ""} ${tab === "prd" && prdDocuments.length > 1 ? "has-document-directory" : ""}`}
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
                        <DemoCommentFrame viewport="desktop" src={selectedDemoUrl} refreshKey={documentRefreshKey} commentMode={htmlCommentMode} comments={htmlComments} actor={{ id: currentUser.openId, name: currentUser.name, initial: currentUser.initial }} onCommentModeChange={setHtmlCommentMode} onCreateComment={createHtmlComment} onReply={replyHtmlComment} onUpdate={updateRequirementComment} onDelete={deleteRequirementComment} />
                      </div>
                    </div>
                  ) : (
                    <DemoCommentFrame viewport="desktop" src={selectedDemoUrl} refreshKey={documentRefreshKey} commentMode={htmlCommentMode} comments={htmlComments} actor={{ id: currentUser.openId, name: currentUser.name, initial: currentUser.initial }} onCommentModeChange={setHtmlCommentMode} onCreateComment={createHtmlComment} onReply={replyHtmlComment} onUpdate={updateRequirementComment} onDelete={deleteRequirementComment} />
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
                        documentId={selectedPrdDocument?.id}
                        documentPath={selectedPrdDocument?.path}
                        comments={prdComments}
                        commenterInitial={currentUser.initial}
                        commentMode={prdCommentMode}
                        onCreateComment={createPrdComment}
                        onCommentPositions={setPrdCommentPositions}
                        onOpenComment={() => { setActivePrdCommentId(null); setPrdCommentsOpen(true); }}
                      />
                    </div>
                  ) : (
                    <RequirementMarkdown
                      source={selectedPrdSource}
                      demoEntryUrl={selectedDemoUrl}
                      assetBaseUrl={selectedPrdAssetBaseUrl}
                      documentId={selectedPrdDocument?.id}
                      documentPath={selectedPrdDocument?.path}
                      comments={prdComments}
                      commenterInitial={currentUser.initial}
                      commentMode={prdCommentMode}
                      onCreateComment={createPrdComment}
                      onCommentPositions={setPrdCommentPositions}
                      onOpenComment={() => { setActivePrdCommentId(null); setPrdCommentsOpen(true); }}
                    />
                  )
                )}
              </section>
            )}
            {(tab === "prd" || tab === "split") ? <PrdCommentPanel
              open={prdCommentsOpen}
              comments={prdComments}
              positions={prdCommentPositions}
              activeThreadId={activePrdCommentId}
              actor={{ id: currentUser.openId, name: currentUser.name }}
              versionLabel={`V${selectedVersion!.number}`}
              onClose={() => { setPrdCommentsOpen(false); setActivePrdCommentId(null); }}
              onSelectThread={setActivePrdCommentId}
              onReply={replyPrdComment}
                        onUpdate={updateRequirementComment}
                        onDelete={deleteRequirementComment}
            /> : null}
            {discussionsOpen ? <RequirementDiscussionPanel
              discussions={discussions}
              actor={{ id: currentUser.openId, name: currentUser.name, initial: currentUser.initial }}
              canProcess={canProcessDiscussions}
              onClose={() => setDiscussionsOpen(false)}
              onCreate={createRequirementDiscussion}
              onReply={replyRequirementDiscussion}
              onProcess={processRequirementDiscussion}
              onUpdate={updateRequirementDiscussion}
              onDelete={deleteRequirementDiscussion}
            /> : null}
            {detail && selectedVersion ? <ProductSpecDialog key={`${detail.requirement.code}-${productSpecOpen ? "open" : "closed"}`} open={productSpecOpen} requirementCode={detail.requirement.code} initialProductId={detail.requirement.productId} onClose={() => setProductSpecOpen(false)} onMerged={(productId) => setDetail((current) => current ? { ...current, requirement: { ...current.requirement, productId } } : current)} /> : null}
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
        onOpenRequirement={openRequirement}
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
      <RequirementShareDialog
        key={shareSession}
        open={shareOpen}
        requirementCode={detail?.requirement.code ?? ""}
        requirementTitle={detail?.requirement.title ?? ""}
        onClose={() => setShareOpen(false)}
        onSent={showNotice}
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
