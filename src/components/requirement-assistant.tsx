"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

type AssistantResponse = { answer: string; requirementCode: string; versionNo: number };
type KnowledgeAssistantResponse = { answer: string; sources: Array<{ requirementCode: string; title: string; versionNo: number; projectName: string; excerpt: string }> };
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; sources?: KnowledgeAssistantResponse["sources"] };

export function RequirementAssistant({ requirementCode, versionNo, mode = "requirement", onOpenRequirement }: { requirementCode?: string; versionNo?: number; mode?: "requirement" | "knowledge-base"; onOpenRequirement?: (requirementCode: string) => void }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function ask() {
    const value = question.trim();
    if (!value || sending) return;
    setSending(true);
    setError("");
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", content: value }]);
    setQuestion("");
    try {
      const response = await fetch("/api/v1/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "knowledge-base" ? { scope: "knowledge-base", question: value } : { requirement_code: requirementCode, version_no: versionNo, question: value }),
      });
      const payload = await response.json() as { data?: AssistantResponse | KnowledgeAssistantResponse; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || "AI 助手暂时无法回答。");
      const data = payload.data as AssistantResponse | KnowledgeAssistantResponse;
      setMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: "assistant", content: data.answer, sources: "sources" in data ? data.sources : undefined }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 助手暂时无法回答。");
    } finally {
      setSending(false);
    }
  }

  return <>
    <button className={`assistant-trigger ${mode === "knowledge-base" ? "assistant-trigger-knowledge" : ""}`} onClick={() => setOpen(true)} title={mode === "knowledge-base" ? "打开需求库智能体" : "AI 需求助手"} aria-label={mode === "knowledge-base" ? "打开需求库智能体" : "打开 AI 需求助手"}><Icon name="message" /><span className="sr-only">{mode === "knowledge-base" ? "需求库智能体" : "AI 需求助手"}</span></button>
    {open ? <section className="assistant-panel" role="dialog" aria-modal="false" aria-labelledby="assistant-title">
      <header><div><small>{mode === "knowledge-base" ? "所有已发布需求" : `当前需求 · V${versionNo}`}</small><h2 id="assistant-title">{mode === "knowledge-base" ? "需求库智能体" : "AI 需求助手"}</h2></div><button className="assistant-close" onClick={() => setOpen(false)} aria-label="关闭 AI 助手">×</button></header>
      <div className="assistant-messages" aria-live="polite">{messages.length ? messages.map((message) => <article className={`assistant-message is-${message.role}`} key={message.id}><span>{message.role === "assistant" ? "AI" : "我"}</span><div><p>{message.content}</p>{message.sources?.length ? <div className="assistant-sources">{message.sources.map((source) => <button key={`${message.id}-${source.requirementCode}`} onClick={() => { onOpenRequirement?.(source.requirementCode); setOpen(false); }}><small>{source.projectName} · {source.requirementCode} · PRD V{source.versionNo}</small><b>{source.title}</b><span>{source.excerpt}</span></button>)}</div> : null}</div></article>) : <div className="assistant-empty"><b>{mode === "knowledge-base" ? "需求库里想了解什么？" : "这版需求需要处理什么？"}</b><span>{mode === "knowledge-base" ? "直接提问需求流程、规则、字段或异常处理，回答只基于已发布 PRD。" : "可以让我梳理验收项、边界条件，或结合当前 PRD 找待确认事项。"}</span></div>}{sending ? <article className="assistant-message is-assistant is-pending"><span>AI</span><p>正在基于 PRD 分析…</p></article> : null}{error ? <p className="assistant-error">{error}</p> : null}</div>
      <div className="assistant-composer"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder={mode === "knowledge-base" ? "询问所有需求内容…" : "询问这版需求…"} maxLength={2000} aria-label="向 AI 需求助手提问" rows={2} /><button className="assistant-send" onClick={() => void ask()} disabled={!question.trim() || sending} aria-label="发送问题"><Icon name="send" /></button><small>Enter 发送，Shift + Enter 换行</small></div>
    </section> : null}
  </>;
}
