"use client";

import { useMemo, useState } from "react";
import { RequirementMarkdown } from "@/components/requirement-markdown";
import { Icon } from "@/components/icons";

type PublicSharePayload = {
  publicUrl: string;
  apiUrl: string;
  expiresAt: number;
  backUrl: string;
  project: { id: string; name: string };
  requirement: { code: string; title: string; status?: string };
  version: { number: number; publishedAt: string; publisher: string; changeSummary: string };
  prd: Array<{ name: string; path: string; content: string }>;
  demo: { previewUrl?: string; sourceUrl?: string; available: boolean; runtime: boolean };
};

export function PublicRequirementPreview({ payload }: { payload: PublicSharePayload }) {
  const [tab, setTab] = useState<"demo" | "prd">(payload.demo.available ? "demo" : "prd");
  const [prdPath, setPrdPath] = useState(payload.prd[0]?.path ?? "");
  const activePrd = useMemo(() => payload.prd.find((item) => item.path === prdPath) ?? payload.prd[0], [payload.prd, prdPath]);
  const expiresAt = new Date(payload.expiresAt).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
  const statusLabel = payload.requirement.status === "online" ? "已上线" : payload.requirement.status === "scheduled" ? "已排期" : "未上线";

  return <main className="public-share-page">
    <header className="public-share-topbar">
      <div className="public-share-leading"><a className="public-share-back-icon" href={payload.backUrl} aria-label="返回需求库"><Icon name="arrow" /></a><h1>{payload.requirement.title}</h1><span className="public-share-status">{statusLabel}</span></div>
      <nav className="public-share-tabs" aria-label="预览内容">
        {payload.demo.available ? <button type="button" className={tab === "demo" ? "is-active" : ""} onClick={() => setTab("demo")}>Demo</button> : null}
        <button type="button" className={tab === "prd" ? "is-active" : ""} onClick={() => setTab("prd")}>PRD</button>
      </nav>
      <div className="public-share-top-actions"><span>V{payload.version.number}</span><span className="public-share-expiry">有效至 {expiresAt}</span></div>
    </header>
    {tab === "demo" && payload.demo.previewUrl ? <section className="public-share-demo" aria-label="Demo 预览"><iframe title={`${payload.requirement.title} Demo`} src={payload.demo.previewUrl} sandbox="allow-scripts allow-forms" /></section> : null}
    {tab === "demo" && !payload.demo.available ? <section className="public-share-empty"><b>当前版本没有可公开预览的静态 Demo</b><p>{payload.demo.runtime ? "该版本是运行态 Demo，当前分享链接只提供 PRD 内容；运行实例仍需登录后访问。" : "请发布包含静态 HTML Demo 的版本后再分享。"}</p></section> : null}
    {tab === "prd" ? <section className="public-share-prd">{payload.prd.length > 1 ? <div className="public-share-prd-toolbar"><select aria-label="选择 PRD 文档" value={prdPath} onChange={(event) => setPrdPath(event.target.value)}>{payload.prd.map((item) => <option key={item.path} value={item.path}>{item.name}</option>)}</select></div> : null}{activePrd ? <RequirementMarkdown source={activePrd.content} demoEntryUrl={payload.demo.previewUrl || ""} assetBaseUrl={payload.demo.previewUrl || ""} className="public-share-markdown" /> : <p className="public-share-empty">当前版本没有 PRD 内容。</p>}</section> : null}
  </main>;
}
