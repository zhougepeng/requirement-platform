"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import type { RequirementComment } from "@/lib/types";

type CommentActor = { id?: string; name: string };

function isOwner(comment: RequirementComment, actor: CommentActor) {
  return comment.authorId ? comment.authorId === actor.id : comment.author === actor.name;
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function CommentMessage({ comment, actor, onUpdate, onDelete }: { comment: RequirementComment; actor: CommentActor; onUpdate: (comment: RequirementComment, content: string) => Promise<void>; onDelete: (comment: RequirementComment) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(comment.content);
  const [saving, setSaving] = useState(false);
  const deleted = Boolean(comment.deletedAt);
  const owner = !deleted && isOwner(comment, actor);
  async function save() {
    const next = value.trim();
    if (!next || saving) return;
    setSaving(true);
    try { await onUpdate(comment, next); setEditing(false); } finally { setSaving(false); }
  }
  async function remove() {
    if (!window.confirm("确定删除这条评论吗？回复会保留。")) return;
    await onDelete(comment);
  }
  return <article className={`prd-comment-message${deleted ? " is-deleted" : ""}`}>
    <header>
      <span className={`avatar avatar-${comment.tone}`}>{comment.initials}</span>
      <span><b>{deleted ? "已删除评论" : comment.author}</b><time>{timeLabel(comment.updatedAt || comment.createdAt)}{comment.updatedAt ? " · 已编辑" : ""}</time></span>
      {owner ? <span className="prd-comment-message-actions"><button type="button" onClick={() => setEditing(true)} title="编辑评论" aria-label="编辑评论"><Icon name="edit" /></button><button type="button" onClick={() => void remove()} title="删除评论" aria-label="删除评论"><Icon name="trash" /></button></span> : null}
    </header>
    {deleted ? <p>该评论已删除。</p> : editing ? <div className="prd-comment-edit"><textarea value={value} onChange={(event) => setValue(event.target.value)} rows={3} autoFocus onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void save(); } }} /><span><button type="button" onClick={() => { setValue(comment.content); setEditing(false); }}>取消</button><button type="button" disabled={!value.trim() || saving} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button></span></div> : <p>{comment.content}</p>}
  </article>;
}

export function PrdCommentPanel({ open, comments, positions, activeThreadId, actor, versionLabel, onClose, onSelectThread, onReply, onUpdate, onDelete }: { open: boolean; comments: RequirementComment[]; positions: Record<string, number>; activeThreadId: string | null; actor: CommentActor; versionLabel: string; onClose: () => void; onSelectThread: (id: string | null) => void; onReply: (threadId: string, content: string) => Promise<RequirementComment>; onUpdate: (comment: RequirementComment, content: string) => Promise<void>; onDelete: (comment: RequirementComment) => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const roots = useMemo(() => comments.filter((comment) => !comment.parentId), [comments]);
  const active = roots.find((comment) => comment.id === activeThreadId) ?? null;
  const repliesByThread = useMemo(() => new Map(roots.map((comment) => [comment.id, comments.filter((reply) => reply.parentId === comment.id)])), [comments, roots]);
  const positionedThreads = useMemo(() => {
    const ordered = roots.map((comment) => ({ comment, desired: (positions[comment.id] ?? 110) - 102 }))
      .toSorted((left, right) => left.desired - right.desired)
    return ordered.reduce<{ items: Array<(typeof ordered)[number] & { top: number }>; bottom: number }>((state, item) => {
      const top = Math.max(6, item.desired, state.bottom + 10);
      return { items: [...state.items, { ...item, top }], bottom: top + 108 };
    }, { items: [], bottom: 0 }).items;
  }, [positions, roots]);
  if (!open) return null;
  async function submit() {
    const value = text.trim();
    if (!value || sending) return;
    if (!active) { setError("请先选择一条评论后回复。"); return; }
    setSending(true);
    setError("");
    try {
      await onReply(active.id, value);
      setText("");
      onSelectThread(active.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "评论保存失败。");
    } finally { setSending(false); }
  }
  return <aside className="prd-comments-panel" aria-label="PRD 评论">
    <header><div><b>评论</b><small>{versionLabel} · {roots.length} 条讨论</small></div><button type="button" className="comment-close" onClick={onClose} aria-label="关闭评论">×</button></header>
    <div className="prd-comments-track">
      {positionedThreads.length ? positionedThreads.map(({ comment, top }) => {
        const replies = repliesByThread.get(comment.id) ?? [];
        return comment.id === active?.id ? <section key={comment.id} className="prd-comment-thread-card is-active" style={{ top }}><header className="prd-comment-card-anchor"><blockquote>{comment.anchor?.quote || "PRD 评论"}</blockquote><span aria-hidden="true">···⌃</span></header><CommentMessage comment={comment} actor={actor} onUpdate={onUpdate} onDelete={onDelete} />{replies.map((reply) => <CommentMessage key={reply.id} comment={reply} actor={actor} onUpdate={onUpdate} onDelete={onDelete} />)}<div className="prd-comment-composer"><input value={text} onChange={(event) => setText(event.target.value)} placeholder="回复…" autoFocus onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }} /><button type="button" className="send-button" onClick={() => void submit()} disabled={!text.trim() || sending} aria-label="发送回复">✓</button>{error ? <p className="release-status-error">{error}</p> : null}</div></section> : <button type="button" className="prd-comment-thread-card" style={{ top }} key={comment.id} onClick={() => onSelectThread(comment.id)}><header className="prd-comment-card-anchor"><span className="prd-comment-thread-quote">{comment.anchor?.quote || "原文已无法定位"}</span><span aria-hidden="true">···⌄</span></header><div className="prd-comment-card-meta"><span className={`avatar avatar-${comment.tone}`}>{comment.initials}</span><b>{comment.deletedAt ? "已删除评论" : comment.author}</b><time>{dateLabel(comment.updatedAt || comment.createdAt)}</time></div><p className="prd-comment-card-content">{comment.deletedAt ? "该评论已删除" : comment.content || "查看讨论"}</p>{replies.length ? <span className="prd-comment-reply-count">+{replies.length} 条评论</span> : null}</button>;
      }) : <p className="comment-empty">选中 PRD 正文后即可添加评论。</p>}
    </div>
  </aside>;
}
