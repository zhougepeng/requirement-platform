"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { Product, ProductSpec, ProductSpecSnapshot, Project } from "@/lib/types";

type MaterialScope = "project" | "public";
type MaterialOrigin = "manual" | "system_generated";
type Material = { id: string; scope: MaterialScope; projectId?: string; directoryId?: string; title: string; fileName?: string; content: string; origin: MaterialOrigin; sourceRequirementCodes: string[]; createdAt: string; updatedAt: string };
type Directory = { id: string; name: string; scope: MaterialScope; projectId?: string; parentId?: string; createdAt: string; updatedAt: string };
type ApiResponse<T> = { data: T; error?: never } | { data?: never; error: string };
type Target = { scope: MaterialScope | "product" | "global"; projectId?: string; productId?: string; directoryId?: string; label: string };
type DirectoryDraft = { scope: MaterialScope; projectId?: string; parentId?: string; label: string };
const EMPTY_SPEC_SNAPSHOTS: ProductSpecSnapshot[] = [];

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

function DirectoryBranch({ directory, directories, target, canEdit, depth, onChoose, onCreate }: { directory: Directory; directories: Directory[]; target: Target; canEdit?: boolean; depth: number; onChoose: (next: Target) => void; onCreate: (next: DirectoryDraft) => void }) {
  const children = directories.filter((item) => item.parentId === directory.id);
  const isSelected = target.scope === directory.scope && target.projectId === directory.projectId && target.directoryId === directory.id;
  return <>
    <div className={`material-tree-row${isSelected ? " is-selected" : ""}`} style={{ paddingLeft: 7 + depth * 12 }}>
      <button className="material-tree-target" onClick={() => onChoose({ scope: directory.scope, projectId: directory.projectId, directoryId: directory.id, label: directory.name })}><Icon name="folder" /><span>{directory.name}</span></button>
      {canEdit ? <button className="material-tree-add" onClick={() => onCreate({ scope: directory.scope, projectId: directory.projectId, parentId: directory.id, label: directory.name })} title={`在“${directory.name}”下新建子目录`} aria-label={`在${directory.name}下新建子目录`}><Icon name="plus" /></button> : null}
    </div>
    {children.map((child) => <DirectoryBranch key={child.id} directory={child} directories={directories} target={target} canEdit={canEdit} depth={depth + 1} onChoose={onChoose} onCreate={onCreate} />)}
  </>;
}

const SPEC_CATEGORY_LABELS: Record<string, string> = { prd: "PRD", token: "样式", component: "组件", layout: "布局", interaction: "交互", template: "模板", demo: "Demo", terminology: "术语", business_rule: "业务规则" };
const SPEC_LEVEL_LABELS: Record<string, string> = { must: "必须", should: "建议", forbid: "禁止" };
const TOKEN_GROUPS: Array<[keyof ProductSpec["tokens"], string]> = [["color", "颜色"], ["typography", "字体"], ["spacing", "间距"], ["radius", "圆角"], ["shadow", "阴影"], ["border", "边框"], ["layout", "布局"]];

function specTokenEntries(value: Record<string, unknown>, prefix = "", depth = 0): Array<[string, string]> {
  if (depth > 2) return [];
  return Object.entries(value).flatMap(([key, raw]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return specTokenEntries(raw as Record<string, unknown>, name, depth + 1);
    if (raw === undefined || raw === null || raw === "") return [];
    return [[name, Array.isArray(raw) ? raw.join(", ") : String(raw)]];
  });
}

function SpecRuleGroup({ title, values }: { title: string; values: string[] }) {
  return <div className="material-spec-rule-group"><h5>{title}</h5>{values.length ? <ul>{values.map((value, index) => <li key={`${title}-${index}`}>{value}</li>)}</ul> : <p>暂未沉淀</p>}</div>;
}

function ProductSpecView({ product, spec, snapshots = EMPTY_SPEC_SNAPSHOTS, canEdit, onRestore }: { product: Product; spec: ProductSpec | null; snapshots?: ProductSpecSnapshot[]; canEdit?: boolean; onRestore?: (snapshot: ProductSpecSnapshot) => void }) {
  if (!spec) return <div className="material-list-empty"><Icon name="file" /><p>正在读取产品规范…</p></div>;
  const entries = spec.entries ?? [];
  const tokenGroups = TOKEN_GROUPS.map(([key, label]) => [label, specTokenEntries(spec.tokens[key] ?? {})] as const).filter(([, values]) => values.length);
  const tokenCount = tokenGroups.reduce((total, [, values]) => total + values.length, 0);
  const ruleCount = spec.rules.terminology.length + spec.rules.businessConstraints.length + spec.rules.copywriting.length;
  return <article className="material-preview material-product-spec-view">
    <header className="material-product-spec-head"><div><h3>{product.name}</h3><small>{product.description || "产品规范"} · V{spec.version} · 更新于 {spec.updatedAt.slice(0, 16).replace("T", " ")}</small></div><span className="material-spec-scope">{spec.scope === "global" ? "公共规范" : "产品规范"}</span></header>
    <section className="material-spec-guide"><div><span className="material-spec-kicker">这份规范怎么用</span><h4>生成 PRD / Demo 时自动作为约束</h4><p>系统会把公共规范与当前产品规范合并，生成时优先复用已有组件、样式 Token 和业务规则；生成结果仍需人工确认后发布。</p></div><ol><li><b>沉淀</b><span>从需求详情提取并确认更新</span></li><li><b>生成</b><span>自动带入 PRD、Demo 生成上下文</span></li><li><b>复核</b><span>检查冲突与缺口，再发布版本</span></li></ol></section>
    <div className="material-spec-summary"><div><b>{ruleCount}</b><span>基础规则</span></div><div><b>{entries.length}</b><span>可执行规范</span></div><div><b>{spec.components.length}</b><span>可复用组件</span></div><div><b>{tokenCount}</b><span>样式 Token</span></div></div>
    <section className="material-spec-section"><header><div><h4>可执行规范</h4><p>真正会被生成上下文读取的结构化规则，按优先级和作用域查看。</p></div><span className="material-spec-count">{entries.length} 条</span></header>{entries.length ? <div className="material-spec-entry-grid">{entries.map((entry) => <article className="material-spec-entry-card" key={entry.id}><header><b>{entry.title}</b><span className={`material-spec-badge is-${entry.level}`}>{SPEC_LEVEL_LABELS[entry.level] || entry.level}</span></header><p>{entry.description}</p><small>{SPEC_CATEGORY_LABELS[entry.category] || entry.category} · {entry.scope === "global" ? "公共" : "当前产品"}{entry.confidence === undefined ? "" : ` · 置信度 ${Math.round(entry.confidence * 100)}%`}</small>{entry.evidence?.length ? <details><summary>查看来源（{entry.evidence.length}）</summary><ul>{entry.evidence.map((item, index) => <li key={index}>{item.path || item.sourceType}{item.excerpt ? `：${item.excerpt}` : ""}</li>)}</ul></details> : null}</article>)}</div> : <p className="material-spec-empty">暂无可执行规范。提取并确认后，这里会出现可复用规则。</p>}</section>
    <section className="material-spec-section"><header><div><h4>基础规则</h4><p>用于统一产品语言、业务边界和 PRD 写作方式。</p></div></header><div className="material-spec-rule-grid"><SpecRuleGroup title="术语" values={spec.rules.terminology} /><SpecRuleGroup title="业务约束" values={spec.rules.businessConstraints} /><SpecRuleGroup title="文案规则" values={spec.rules.copywriting} /></div></section>
    <section className="material-spec-section"><header><div><h4>PRD 规范</h4><p>生成 PRD 时使用的结构和写作规则。</p></div></header><div className="material-spec-rule-grid"><SpecRuleGroup title="文档结构" values={spec.prd.structure} /><SpecRuleGroup title="写作规则" values={spec.prd.writingRules} /></div></section>
    <section className="material-spec-section"><header><div><h4>UI 样式 Token</h4><p>生成 Demo 时优先使用这些颜色、字体、间距和布局变量。</p></div><span className="material-spec-count">{tokenCount} 项</span></header>{tokenGroups.length ? <div className="material-spec-token-grid">{tokenGroups.map(([label, values]) => <div className="material-spec-token-group" key={label}><h5>{label}</h5>{values.slice(0, 16).map(([name, value]) => <div key={name}><span>{name}</span><code>{value}</code></div>)}{values.length > 16 ? <small>还有 {values.length - 16} 项</small> : null}</div>)}</div> : <p className="material-spec-empty">暂未沉淀 Token，生成 Demo 时会使用默认样式。</p>}</section>
    <section className="material-spec-section"><header><div><h4>组件与交互</h4><p>生成 Demo 时优先复用这些稳定组件，不再重复造相似控件。</p></div><span className="material-spec-count">{spec.components.length} 个</span></header>{spec.components.length ? <div className="material-spec-component-grid">{spec.components.map((component) => <article className="material-spec-component-card" key={component.id || component.name}><header><b>{component.name}</b>{component.repeatCount ? <span>重复 {component.repeatCount} 次</span> : null}</header>{component.id ? <small>组件 ID：{component.id}</small> : null}<p>{component.usage}</p>{component.interaction?.length ? <div className="material-spec-chip-row">{component.interaction.map((item) => <span key={item}>{item}</span>)}</div> : null}{component.avoid ? <small className="material-spec-avoid">不适用：{component.avoid}</small> : null}{component.code ? <details><summary>查看可复用代码</summary><pre>{component.code}</pre></details> : null}</article>)}</div> : <p className="material-spec-empty">暂未沉淀组件。</p>}</section>
    <section className="material-spec-section"><header><div><h4>Demo 规范</h4><p>用于约束页面结构、交互状态和演示完成度。</p></div></header><div className="material-spec-rule-grid"><SpecRuleGroup title="布局原则" values={spec.demo.layoutPrinciples} /><SpecRuleGroup title="组件复用" values={spec.demo.componentReuseRules} /><SpecRuleGroup title="交互要求" values={spec.demo.interactionRequirements} /><SpecRuleGroup title="开发约束" values={spec.demo.constraints} /></div></section>
    <section className="material-product-spec-history"><header><div><h4>历史版本</h4><p>每次确认更新都会保留快照，可在需要时回滚。</p></div></header>{snapshots.length ? snapshots.map((snapshot) => <article key={snapshot.snapshotId}><div><b>V{snapshot.version}</b><small>{snapshot.createdAt.slice(0, 16).replace("T", " ")}{snapshot.createdBy ? ` · ${snapshot.createdBy}` : ""}</small></div>{canEdit && onRestore ? <button className="project-dialog-cancel" onClick={() => onRestore(snapshot)}>回滚为此版本</button> : null}</article>) : <p>暂无历史版本</p>}</section>
  </article>;
}

export function MaterialLibrary({ projects, canEdit }: { projects: Project[]; canEdit?: boolean }) {
  const [directories, setDirectories] = useState<Directory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productSpec, setProductSpec] = useState<ProductSpec | null>(null);
  const [globalSpec, setGlobalSpec] = useState<ProductSpec | null>(null);
  const [productSpecSnapshots, setProductSpecSnapshots] = useState<ProductSpecSnapshot[]>([]);
  const [globalSpecSnapshots, setGlobalSpecSnapshots] = useState<ProductSpecSnapshot[]>([]);
  const [target, setTarget] = useState<Target>(() => projects[0] ? { scope: "project", projectId: projects[0].id, label: projects[0].name } : { scope: "public", label: "公共资料" });
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selected, setSelected] = useState<Material | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [directoryDraft, setDirectoryDraft] = useState<DirectoryDraft | null>(null);
  const [directoryName, setDirectoryName] = useState("");
  const [creatingDirectory, setCreatingDirectory] = useState(false);
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
    setSelected((current) => result.find((item) => item.id === current?.id) ?? null);
  }

  useEffect(() => {
    let active = true;
    void request<Directory[]>("/api/v1/materials/directories").then((result) => { if (active) setDirectories(result); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取资料目录。"); });
    void request<Product[]>("/api/v1/products").then((result) => { if (active) setProducts(result); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取产品规范。"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    if (target.scope === "product") {
      const id = encodeURIComponent(target.productId || "");
      void Promise.all([request<ProductSpec>(`/api/v1/products/${id}/spec`), request<ProductSpecSnapshot[]>(`/api/v1/products/${id}/spec/versions`)]).then(([spec, snapshots]) => { if (active) { setProductSpec(spec); setProductSpecSnapshots(snapshots); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取产品规范。"); });
      return () => { active = false; };
    }
    if (target.scope === "global") {
      void Promise.all([request<ProductSpec>("/api/v1/specs/global"), request<ProductSpecSnapshot[]>("/api/v1/specs/global/versions")]).then(([spec, snapshots]) => { if (active) { setGlobalSpec(spec); setGlobalSpecSnapshots(snapshots); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取公共规范。"); });
      return () => { active = false; };
    }
    const params = new URLSearchParams({ scope: target.scope });
    if (target.projectId) params.set("project_id", target.projectId);
    if (target.directoryId) params.set("directory_id", target.directoryId);
    void request<Material[]>(`/api/v1/materials?${params}`).then((result) => {
      if (!active) return;
      setMaterials(result);
      setSelected((current) => result.find((item) => item.id === current?.id) ?? null);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取资料。"); });
    return () => { active = false; };
  }, [target.scope, target.projectId, target.productId, target.directoryId]);

  function selectMaterial(next: Material | null) { setSelected(next); setEditing(false); setUploadMenuOpen(false); setTitle(next?.title ?? ""); setContent(next?.content ?? ""); }
  function choose(next: Target) { setError(""); setEditing(false); setSelected(null); setUploadMenuOpen(false); if (next.scope === "product") { setProductSpec(null); setProductSpecSnapshots([]); } if (next.scope === "global") { setGlobalSpec(null); setGlobalSpecSnapshots([]); } setTarget(next); }
  async function restoreSpec(snapshot: ProductSpecSnapshot) {
    if (!canEdit || !window.confirm(`确认回滚到 V${snapshot.version}？当前规范会自动保留为一个新快照。`)) return;
    try {
      const endpoint = target.scope === "global" ? "/api/v1/specs/global/versions" : `/api/v1/products/${encodeURIComponent(target.productId || "")}/spec/versions`;
      const restored = await request<ProductSpec>(endpoint, { method: "POST", body: JSON.stringify({ snapshotId: snapshot.snapshotId }) });
      if (target.scope === "global") { setGlobalSpec(restored); setGlobalSpecSnapshots(await request<ProductSpecSnapshot[]>("/api/v1/specs/global/versions")); }
      else { setProductSpec(restored); setProductSpecSnapshots(await request<ProductSpecSnapshot[]>(`/api/v1/products/${encodeURIComponent(target.productId || "")}/spec/versions`)); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "回滚规范失败。"); }
  }
  function startNew() { setSelected(null); setTitle(""); setContent(""); setUploadMenuOpen(false); setEditing(true); }
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

  function openCreateDirectory(next: DirectoryDraft) { setDirectoryDraft(next); setDirectoryName(""); setError(""); }

  async function createDirectory() {
    if (!directoryDraft || creatingDirectory || !directoryName.trim()) return;
    setCreatingDirectory(true); setError("");
    try {
      const created = await request<Directory>("/api/v1/materials/directories", { method: "POST", body: JSON.stringify({ name: directoryName, scope: directoryDraft.scope, projectId: directoryDraft.projectId, parentId: directoryDraft.parentId }) });
      await loadDirectories();
      choose({ scope: created.scope, projectId: created.projectId, directoryId: created.id, label: created.name });
      setDirectoryDraft(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "新建目录失败。"); } finally { setCreatingDirectory(false); }
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

  const showDetail = editing || selected !== null;

  const projectDirectories = directories.filter((directory) => directory.scope === "project");
  const publicDirectories = directories.filter((directory) => directory.scope === "public");

  return <section className="material-library">
    <header className="material-library-head"><div><h1>资料库</h1><p>项目资料与公共资料会自动作为需求智能体的补充知识。</p></div></header>
    {error ? <p className="material-error" role="alert">{error}</p> : null}
    <div className="material-library-layout">
      <aside className="material-tree">
        <small>项目资料</small>
        <div className="material-tree-list">{projects.map((project) => <div key={project.id}><div className={`material-tree-row${target.scope === "project" && target.projectId === project.id && !target.directoryId ? " is-selected" : ""}`}><button className="material-tree-target" onClick={() => choose({ scope: "project", projectId: project.id, label: project.name })}><Icon name="folder" /><span>{project.name}</span></button>{canEdit ? <button className="material-tree-add" onClick={() => openCreateDirectory({ scope: "project", projectId: project.id, label: project.name })} title={`在“${project.name}”下新建子目录`} aria-label={`在${project.name}下新建子目录`}><Icon name="plus" /></button> : null}</div>{projectDirectories.filter((directory) => directory.projectId === project.id && !directory.parentId).map((directory) => <DirectoryBranch key={directory.id} directory={directory} directories={projectDirectories} target={target} canEdit={canEdit} depth={1} onChoose={choose} onCreate={openCreateDirectory} />)}</div>)}</div>
        <div className="material-tree-group-head"><small>公共资料</small>{canEdit ? <button className="material-tree-add" onClick={() => openCreateDirectory({ scope: "public", label: "公共资料" })} title="新建公共资料目录" aria-label="新建公共资料目录"><Icon name="plus" /></button> : null}</div>
        <div className="material-tree-list">{publicDirectories.filter((directory) => !directory.parentId).map((directory) => <DirectoryBranch key={directory.id} directory={directory} directories={publicDirectories} target={target} canEdit={canEdit} depth={0} onChoose={choose} onCreate={openCreateDirectory} />)}</div>
         <div className="material-tree-group-head"><small>产品规范</small></div>
         <div className="material-tree-list"><div className={`material-tree-row${target.scope === "global" ? " is-selected" : ""}`}><button className="material-tree-target" onClick={() => choose({ scope: "global", label: "公共规范" })}><Icon name="file" /><span>公共规范</span></button></div>{products.length ? products.map((product) => <div className={`material-tree-row${target.scope === "product" && target.productId === product.id ? " is-selected" : ""}`} key={product.id}><button className="material-tree-target" onClick={() => choose({ scope: "product", productId: product.id, label: product.name })}><Icon name="folder" /><span>{product.name}</span></button></div>) : <p className="material-tree-empty">暂无产品</p>}</div>
      </aside>
      <section className="material-content">
         <header className="material-content-head"><div>{showDetail ? <button className="material-back-button" onClick={() => selectMaterial(null)}><Icon name="arrow" /> 资料列表</button> : <small>{target.scope === "project" ? "项目资料" : target.scope === "product" ? "产品规范" : target.scope === "global" ? "公共规范" : "公共资料"}</small>}<h2>{showDetail && selected ? selected.title : target.label}</h2></div>{canEdit && target.scope !== "product" && target.scope !== "global" ? <div className="material-actions"><input ref={fileInput} type="file" accept=".md,.txt,text/markdown,text/plain" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /><button className="publish-button" onClick={() => setUploadMenuOpen((current) => !current)}><Icon name="plus" /> 上传新资料</button>{uploadMenuOpen ? <div className="material-upload-menu" role="menu"><button role="menuitem" onClick={() => fileInput.current?.click()}><Icon name="file" /> 选择 .md / .txt 文件</button><button role="menuitem" onClick={startNew}><Icon name="edit" /> 直接粘贴文本</button></div> : null}</div> : null}</header>
          {target.scope === "product" ? <ProductSpecView product={products.find((product) => product.id === target.productId) ?? { id: target.productId || "", name: target.label, createdAt: "", updatedAt: "" }} spec={productSpec} snapshots={productSpecSnapshots} canEdit={canEdit} onRestore={(snapshot) => void restoreSpec(snapshot)} /> : target.scope === "global" ? <ProductSpecView product={{ id: "global", name: "公共规范", description: "所有产品共享的生成基线", createdAt: "", updatedAt: "" }} spec={globalSpec} snapshots={globalSpecSnapshots} canEdit={canEdit} onRestore={(snapshot) => void restoreSpec(snapshot)} /> : showDetail ? <article className="material-preview material-detail-view">{editing ? <><label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="资料标题" maxLength={120} /></label><label>内容<textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="可直接粘贴 Markdown 或文本内容" maxLength={400000} /></label><footer><button className="project-dialog-cancel" onClick={() => { setEditing(false); setTitle(selected?.title ?? ""); setContent(selected?.content ?? ""); }}>取消</button><button className="publish-button" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存"}</button></footer></> : selected ? <><header><div><h3>{selected.title}</h3>{selected.origin === "system_generated" ? <small>系统根据已上线需求自动整理{selected.sourceRequirementCodes.length ? ` · 来源 ${selected.sourceRequirementCodes.join("、")}` : ""}</small> : <small>{selected.fileName ?? "人工维护"}</small>}</div>{canEdit ? <div>{selected.origin === "manual" ? <button className="icon-button" onClick={() => void move()} title="移动资料" aria-label="移动资料"><Icon name="folder" /></button> : null}<button className="icon-button" onClick={startEdit} title="编辑资料" aria-label="编辑资料"><Icon name="edit" /></button><button className="icon-button material-delete" onClick={() => void remove()} title="删除资料" aria-label="删除资料"><Icon name="trash" /></button></div> : null}</header><pre>{selected.content}</pre></> : null}</article> : <div className="material-list material-list-full"><div className="material-list-head"><span>名称</span><span>更新时间</span></div>{materials.length ? materials.map((item) => <button key={item.id} onClick={() => selectMaterial(item)}><span><b>{item.title}</b>{item.origin === "system_generated" ? <em>系统整理</em> : null}</span><small>{formatTime(item.updatedAt)}</small></button> ) : <div className="material-list-empty"><Icon name="file" /><p>当前目录还没有资料</p>{canEdit ? <button className="publish-button" onClick={() => setUploadMenuOpen(true)}><Icon name="plus" /> 上传新资料</button> : null}</div>}</div>}
      </section>
    </div>
    {directoryDraft ? <div className="material-directory-dialog-backdrop" role="presentation"><form className="material-directory-dialog" onSubmit={(event) => { event.preventDefault(); void createDirectory(); }}><header><div><h3>新建子目录</h3><p>将在“{directoryDraft.label}”下创建。</p></div><button type="button" className="icon-button" onClick={() => setDirectoryDraft(null)} title="关闭" aria-label="关闭"><Icon name="close" /></button></header><label>目录名称<input autoFocus value={directoryName} onChange={(event) => setDirectoryName(event.target.value)} placeholder="例如：交互规范" maxLength={120} /></label><footer><button type="button" className="project-dialog-cancel" onClick={() => setDirectoryDraft(null)}>取消</button><button className="publish-button" disabled={!directoryName.trim() || creatingDirectory}>{creatingDirectory ? "创建中…" : "创建"}</button></footer></form></div> : null}
  </section>;
}
