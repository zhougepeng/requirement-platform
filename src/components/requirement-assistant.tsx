"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/icons";

type AssistantScope = "current-requirement" | "current-project" | "all-published";
type AssistantContext = {
  kind: "library" | "project" | "requirement";
  projectId?: string;
  projectName?: string;
  requirementCode?: string;
  requirementTitle?: string;
  versionNo?: number;
};
type AssistantSource = { id: string; projectId: string; projectName: string; requirementCode: string; requirementName: string; prdVersion: number; section: string; excerpt: string; historical: boolean; releaseStatus: "online" | "scheduled" | "offline"; scheduleVersion?: string; scheduledGrayDate?: string; scheduledFullDate?: string; releaseVersion?: string; releaseDate?: string };
type AssistantAnswer = {
  status: "defined" | "partial" | "undefined" | "conflict";
  answer: string;
  keyPoints: string[];
  flow: string[];
  comparison?: { columns: string[]; rows: string[][] };
  sources: AssistantSource[];
  undefinedPoints: string[];
  relatedRequirements: Array<{ code: string; title: string }>;
  demo?: { available: boolean; url?: string };
  testCases: Array<{ id: string; title: string; status?: string; priority?: string; module?: string }>;
  detailed: boolean;
};
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; result?: AssistantAnswer };
type TriggerPosition = { left: number; top: number };
type TriggerDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  moved: boolean;
};

const triggerPositionKey = "requirement-platform:assistant-trigger-position:v1";

function defaultScope(context: AssistantContext): AssistantScope {
  return context.kind === "requirement" ? "current-requirement" : context.kind === "project" ? "current-project" : "all-published";
}

function scopeForQuestion(question: string, context: AssistantContext) {
  if (context.kind === "library") return "all-published" as const;
  if (/所有项目|全部项目|全局|整个需求库|需求库中/.test(question)) return "all-published" as const;
  if (context.kind === "requirement" && /当前项目|本项目|同项目|其他需求/.test(question)) return "current-project" as const;
  return defaultScope(context);
}

function quickQuestions(context: AssistantContext) {
  if (context.kind === "requirement") return ["总结这个需求", "核心业务流程", "有哪些异常场景", "有哪些未明确规则", "最近版本修改了什么"];
  if (context.kind === "project") return ["这个项目的核心流程是什么？", "有哪些异常场景？", "最近有哪些需求发生变化？", "哪些规则 PRD 还没有定义？"];
  return ["有哪些项目和核心流程？", "某个字段在哪里定义？", "最近有哪些需求发生变化？", "哪些规则 PRD 还没有定义？"];
}

export function RequirementAssistant({ context, onOpenRequirement, onOpenTestCases }: { context: AssistantContext; onOpenRequirement?: (requirementCode: string, versionNo?: number) => void; onOpenTestCases?: () => void }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [gapSaving, setGapSaving] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const triggerDragRef = useRef<TriggerDragState | null>(null);
  const ignoreTriggerClickRef = useRef(false);

  function applyTriggerPosition(position: TriggerPosition) {
    const trigger = triggerRef.current;
    if (!trigger) return position;
    const bounds = trigger.getBoundingClientRect();
    const left = Math.round(
      Math.min(Math.max(8, position.left), window.innerWidth - bounds.width - 8),
    );
    const top = Math.round(
      Math.min(Math.max(8, position.top), window.innerHeight - bounds.height - 8),
    );
    trigger.style.left = `${left}px`;
    trigger.style.top = `${top}px`;
    trigger.style.right = "auto";
    trigger.style.bottom = "auto";
    return { left, top };
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(triggerPositionKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<TriggerPosition>;
      if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return;
      applyTriggerPosition({ left: parsed.left as number, top: parsed.top as number });
    } catch {
      // A missing or malformed local preference should not block the assistant.
    }
  }, []);

  function beginTriggerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    triggerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: bounds.left,
      startTop: bounds.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTrigger(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = triggerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return;
    drag.moved = true;
    ignoreTriggerClickRef.current = true;
    applyTriggerPosition({
      left: drag.startLeft + deltaX,
      top: drag.startTop + deltaY,
    });
  }

  function endTriggerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = triggerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    triggerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    try {
      window.localStorage.setItem(
        triggerPositionKey,
        JSON.stringify({ left: Math.round(bounds.left), top: Math.round(bounds.top) }),
      );
    } catch {
      // The trigger remains movable even if this browser cannot persist preferences.
    }
  }
  async function ask(value = question) {
    const prompt = value.trim();
    if (!prompt || sending) return;
    const queryScope = scopeForQuestion(prompt, context);
    setSending(true);
    setError("");
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", content: prompt }]);
    setQuestion("");
    try {
      const response = await fetch("/api/v1/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: queryScope,
          question: prompt,
          requirement_code: context.requirementCode,
          project_id: context.projectId,
          version_no: queryScope === "current-requirement" ? context.versionNo : undefined,
        }),
      });
      const payload = await response.json() as { data?: AssistantAnswer; error?: string };
      const result = payload.data;
      if (!response.ok || !result) throw new Error(payload.error || "AI 助手暂时无法回答。");
      setMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: "assistant", content: result.answer, result }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 助手暂时无法回答。");
    } finally {
      setSending(false);
    }
  }

  async function addGap(message: ChatMessage) {
    if (!context.requirementCode || gapSaving) return;
    setGapSaving(message.id);
    try {
      const response = await fetch(`/api/v1/requirements/${encodeURIComponent(context.requirementCode)}/gaps`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: message.content }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "添加待补充项失败。");
      window.dispatchEvent(new CustomEvent("requirement-gap-created", { detail: { requirementCode: context.requirementCode } }));
      setGapSaving(`done:${message.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加待补充项失败。");
      setGapSaving(null);
    }
  }

  const contextDetail = context.kind === "requirement"
    ? `${context.projectName ?? "当前项目"} ＞ ${context.requirementTitle ?? context.requirementCode} ＞ V${context.versionNo ?? "当前"}`
    : context.kind === "project" ? `${context.projectName ?? "当前项目"} ＞ 全部需求` : "所有已发布需求";

  return <>
    <button ref={triggerRef} type="button" className="assistant-trigger" onClick={() => { if (ignoreTriggerClickRef.current) { ignoreTriggerClickRef.current = false; return; } setOpen(true); }} onPointerDown={beginTriggerDrag} onPointerMove={moveTrigger} onPointerUp={endTriggerDrag} onPointerCancel={endTriggerDrag} title="打开需求智能体；可拖拽调整位置" aria-label="打开需求智能体，可拖拽调整位置"><Icon name="message" /><span className="sr-only">需求智能体</span></button>
    {open ? <section className="assistant-panel" role="dialog" aria-modal="false" aria-labelledby="assistant-title">
      <header><div><small>需求智能体</small><h2 id="assistant-title">{contextDetail}</h2></div><button className="assistant-close" onClick={() => setOpen(false)} aria-label="关闭需求智能体">×</button></header>
      <div className="assistant-messages" aria-live="polite">
        {messages.length ? messages.map((message) => <article className={`assistant-message is-${message.role}`} key={message.id}>
          <span>{message.role === "assistant" ? "AI" : "我"}</span><div><p>{message.content}</p>{message.result ? <AnswerContent result={message.result} onOpenRequirement={onOpenRequirement} onOpenTestCases={onOpenTestCases} onOpenDemo={() => message.result?.demo?.url && window.open(message.result.demo.url, "_blank", "noopener,noreferrer")} onAddGap={() => void addGap(message)} gapSaving={gapSaving === message.id} gapSaved={gapSaving === `done:${message.id}`} /> : null}</div>
        </article>) : <div className="assistant-empty"><b>{context.kind === "library" ? "需求库里想了解什么？" : "项目需求需要确认什么？"}</b><span>回答使用已同步的最新需求、PRD、测试和上线状态。</span><div className="assistant-quick-questions">{quickQuestions(context).map((item) => <button key={item} onClick={() => void ask(item)}>{item}</button>)}</div></div>}
        {sending ? <article className="assistant-message is-assistant is-pending"><span>AI</span><p>正在检索需求知识库…</p></article> : null}
        {error ? <p className="assistant-error">{error}</p> : null}
      </div>
      <div className="assistant-composer"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="询问需求流程、规则、字段或异常处理…" maxLength={2000} aria-label="向需求智能体提问" rows={2} /><button className="assistant-send" onClick={() => void ask()} disabled={!question.trim() || sending} aria-label="发送问题"><Icon name="send" /></button><small>Enter 发送，Shift + Enter 换行</small></div>
    </section> : null}
  </>;
}

function AnswerContent({ result, onOpenRequirement, onOpenTestCases, onOpenDemo, onAddGap, gapSaving, gapSaved }: { result: AssistantAnswer; onOpenRequirement?: (requirementCode: string, versionNo?: number) => void; onOpenTestCases?: () => void; onOpenDemo: () => void; onAddGap: () => void; gapSaving: boolean; gapSaved: boolean }) {
  return <div className="assistant-answer-detail">
    <small className="assistant-section-label">要点</small>
    {result.keyPoints.length ? <ul>{result.keyPoints.map((item) => <li key={item}>{item}</li>)}</ul> : null}
    {result.flow.length ? <p className="assistant-flow">{result.flow.join(" → ")}</p> : null}
    {result.comparison ? <div className="assistant-comparison"><table><thead><tr>{result.comparison.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.comparison.rows.map((row, index) => <tr key={`${index}-${row.join("-")}`}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}</tbody></table></div> : null}
    {result.undefinedPoints.length ? <p className="assistant-undefined-points">未定义：{result.undefinedPoints.join("；")}</p> : null}
    {result.sources.length ? <details className="assistant-sources"><summary>查看来源（{result.sources.length}）</summary>{result.sources.map((source) => <button key={source.id} onClick={() => onOpenRequirement?.(source.requirementCode, source.prdVersion)}><small>{source.requirementName} · {source.releaseStatus === "online" ? `已上线${source.releaseVersion ? ` · ${source.releaseVersion}` : ""}${source.releaseDate ? ` · ${source.releaseDate}` : ""}` : source.releaseStatus === "scheduled" ? `已排期${source.scheduleVersion ? ` · ${source.scheduleVersion}` : ""}${source.scheduledFullDate ? ` · 预计全量 ${source.scheduledFullDate}` : ""}` : "未上线 · 规划中"} · PRD · {source.section}</small><span>{source.excerpt}</span></button>)}</details> : null}
    {result.relatedRequirements.length ? <p className="assistant-related">关联需求：{result.relatedRequirements.map((item) => <button key={item.code} onClick={() => onOpenRequirement?.(item.code)}>{item.title}</button>)}</p> : null}
    {result.testCases.length ? <div className="assistant-test-cases"><small>相关测试用例</small>{result.testCases.map((testCase) => <button key={testCase.id} onClick={() => { onOpenTestCases?.(); window.dispatchEvent(new CustomEvent("requirement-open-test-cases")); }}><b>{testCase.id}</b><span>{testCase.title}</span><em>{[testCase.priority, testCase.status, testCase.module].filter(Boolean).join(" · ")}</em></button>)}</div> : null}
    {result.demo?.available ? <button className="assistant-inline-action" onClick={onOpenDemo}>演示这个流程</button> : null}
    {(result.status === "undefined" || result.status === "partial") ? <button className="assistant-inline-action" onClick={onAddGap} disabled={gapSaving || gapSaved}>{gapSaved ? "已添加为待补充项" : gapSaving ? "正在添加…" : "添加为待补充项"}</button> : null}
  </div>;
}
