"use client";

import { useEffect, useMemo, useState } from "react";
import type { RequirementTestCase, RequirementTestStatus } from "@/lib/types";

type Filter = "all" | "pending" | "passed" | "failed" | "blocked" | "P0" | "P1" | "P2";

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json() as { data?: T; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error || "请求失败。");
  return body.data;
}

const filterLabels: Record<Filter, string> = {
  all: "全部",
  pending: "未完成",
  passed: "已完成",
  failed: "失败",
  blocked: "阻塞",
  P0: "P0",
  P1: "P1",
  P2: "P2",
};

const statusLabels: Record<RequirementTestStatus, string> = {
  pending: "未完成",
  passed: "已通过",
  failed: "失败",
  blocked: "阻塞",
};

const generationStages = [
  "正在读取当前版本 PRD…",
  "正在解析 Demo 页面…",
  "正在拆分测试场景…",
  "正在生成结构化用例…",
  "正在检查覆盖范围…",
];

export function TestCasesPanel({ requirementCode, versionNo }: { requirementCode: string; versionNo: number }) {
  const [items, setItems] = useState<RequirementTestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState(0);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState("");
  const url = `/api/v1/requirements/${encodeURIComponent(requirementCode)}/versions/${versionNo}/test-cases`;

  useEffect(() => {
    let cancelled = false;
    void api<RequirementTestCase[]>(url)
      .then((result) => { if (!cancelled) setItems(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "无法读取测试用例。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => {
      setGenerationStage((current) => (current + 1) % generationStages.length);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [generating]);

  const visible = useMemo(() => items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "pending" || filter === "passed" || filter === "failed" || filter === "blocked") return item.status === filter;
    return item.priority === filter;
  }), [items, filter]);
  const passed = items.filter((item) => item.status === "passed").length;

  async function generate() {
    setGenerating(true);
    setGenerationStage(0);
    setError("");
    try {
      const saved = await api<RequirementTestCase[]>(url, { method: "POST" });
      setItems(saved);
      setOpenId(saved[0]?.id ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "测试用例生成失败，请重试。");
    } finally {
      setGenerating(false);
    }
  }

  async function update(item: RequirementTestCase, status: RequirementTestStatus) {
    setError("");
    try {
      const saved = await api<RequirementTestCase>(`${url}/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setItems((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新测试状态失败。");
    }
  }

  if (loading) return <section className="test-cases-panel"><p className="test-case-loading">正在读取测试用例…</p></section>;

  if (!items.length) return <section className="test-cases-empty">
    <h2>暂无测试用例</h2>
    <p>AI 可以根据当前版本的 PRD 和 Demo 自动分析需求，并生成对应的测试用例。</p>
    {error ? <p className="test-case-error">{error}</p> : null}
    <button className="publish-button" onClick={() => void generate()} disabled={generating}>
      {generating ? generationStages[generationStage] : error ? "重新生成测试用例" : "生成测试用例"}
    </button>
  </section>;

  return <section className="test-cases-panel">
    <header className="test-cases-header">
      <div>
        <h2>测试用例</h2>
        <p>共 {items.length} 条 ｜ 已完成 {passed} ｜ P0 {items.filter((item) => item.priority === "P0").length} ｜ P1 {items.filter((item) => item.priority === "P1").length} ｜ P2 {items.filter((item) => item.priority === "P2").length}</p>
      </div>
      <button className="project-dialog-cancel" onClick={() => void generate()} disabled={generating}>
        {generating ? "正在重新生成…" : "重新生成并覆盖"}
      </button>
    </header>
    <div className="test-case-filters" aria-label="筛选测试用例">
      {(Object.keys(filterLabels) as Filter[]).map((value) => <button key={value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{filterLabels[value]}</button>)}
    </div>
    {error ? <p className="test-case-error">{error}</p> : null}
    {!visible.length ? <p className="test-case-loading">没有符合条件的测试用例。</p> : null}
    <div className="test-case-list">
      {visible.map((item) => <article className={`test-case is-${item.status}`} key={item.id}>
        <button className="test-case-summary" onClick={() => setOpenId((current) => current === item.id ? "" : item.id)} aria-expanded={openId === item.id}>
          <span className="test-case-status" aria-label={statusLabels[item.status]}>{item.status === "passed" ? "●" : item.status === "failed" ? "×" : item.status === "blocked" ? "!" : "○"}</span>
          <span className="test-case-title"><small>{item.id}</small><b>{item.title}</b><em>{item.priority} · {item.module}</em></span>
          <span className="test-case-chevron">{openId === item.id ? "⌃" : "⌄"}</span>
        </button>
        {openId === item.id ? <div className="test-case-detail">
          <p><b>PRD 来源：</b>{item.prdSource}</p>
          {item.preconditions.length ? <p><b>前置条件：</b>{item.preconditions.join("；")}</p> : null}
          <div><b>测试步骤</b><ol>{item.steps.map((step) => <li key={step.step}>{step.action}</li>)}</ol></div>
          <p><b>预期结果：</b>{item.expectedResults.join("；")}</p>
          <div className="test-case-actions">
            {item.status !== "passed" ? <button className="publish-button" onClick={() => void update(item, "passed")}>通过</button> : null}
            {item.status !== "failed" ? <button className="project-dialog-cancel" onClick={() => void update(item, "failed")}>标记失败</button> : null}
            {item.status !== "blocked" ? <button className="project-dialog-cancel" onClick={() => void update(item, "blocked")}>标记阻塞</button> : null}
            {item.status !== "pending" ? <button className="project-dialog-cancel" onClick={() => void update(item, "pending")}>设为未完成</button> : null}
          </div>
        </div> : null}
      </article>)}
    </div>
  </section>;
}
