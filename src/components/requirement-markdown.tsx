"use client";

import { useEffect, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PrdCommentAnchor, RequirementComment } from "@/lib/types";

let mermaidLoader: Promise<typeof import("mermaid")> | null = null;
let mermaidSequence = 0;

function loadMermaid() {
  mermaidLoader ??= import("mermaid").then((module) => {
    module.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        primaryColor: "#eff6ff",
        primaryBorderColor: "#2563eb",
        primaryTextColor: "#172033",
        lineColor: "#64748b",
        secondaryColor: "#f8fafc",
        tertiaryColor: "#ffffff",
      },
    });
    return module;
  });
  return mermaidLoader;
}

function normalizeMermaidSource(source: string) {
  return source.replace(/\r\n/g, "\n").replace(
    /^(\s*[A-Za-z][\w-]*)\s*-->\s*([^\[\]{}<>|\r\n]+?)\s*-->\s*([A-Za-z][\w-]*(?:\s*[\[{].*)?)\s*$/gm,
    (_match, from, label, target) => `${from.trim()} -->|${label.trim()}| ${target.trim()}`,
  );
}

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const id = `requirement-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${mermaidSequence++}`;
    void loadMermaid()
      .then(({ default: mermaid }) => mermaid.render(id, normalizeMermaidSource(source)))
      .then(({ svg: nextSvg }) => {
        if (active) setSvg(nextSvg);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [reactId, source]);

  if (failed) return <div className="mermaid-diagram is-failed"><p>流程图语法无法渲染，保留原始内容供检查。</p><pre><code>{source}</code></pre></div>;
  if (!svg) return <div className="mermaid-diagram is-loading" aria-busy="true">正在渲染流程图…</div>;
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function resolveImageUrl(source: string, demoEntryUrl: string, assetBaseUrl?: string) {
  const value = source.trim();
  if (/^(https?:|data:image\/)/i.test(value)) return value;
  if (!value || value.startsWith("/") || value.includes("\\") || value.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "";
  const baseUrl = assetBaseUrl || demoEntryUrl;
  const base = baseUrl.slice(0, baseUrl.lastIndexOf("/") + 1);
  return `${base}${value.split("/").map(encodeURIComponent).join("/")}`;
}

type CommentSelection = { anchor: PrdCommentAnchor; left: number; top: number };
type CommentMarker = { id: string; lines: Array<{ left: number; top: number; width: number }>; buttonLeft: number; buttonTop: number; viewportTop: number };

function offsetFor(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function textPosition(root: HTMLElement, position: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let cursor = 0;
  let last: Node | null = null;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (position <= cursor + length) return { node, offset: Math.max(0, position - cursor) };
    cursor += length;
    last = node;
  }
  return last ? { node: last, offset: last.textContent?.length ?? 0 } : null;
}

function anchorStart(text: string, anchor: PrdCommentAnchor) {
  const matchesContext = (index: number) => {
    const prefix = text.slice(Math.max(0, index - anchor.prefix.length), index);
    const suffix = text.slice(index + anchor.quote.length, index + anchor.quote.length + anchor.suffix.length);
    return (!anchor.prefix || prefix === anchor.prefix) && (!anchor.suffix || suffix === anchor.suffix);
  };
  if (text.slice(anchor.start, anchor.end) === anchor.quote && matchesContext(anchor.start)) return anchor.start;
  const matches: number[] = [];
  let index = text.indexOf(anchor.quote);
  while (index >= 0) {
    if (matchesContext(index)) matches.push(index);
    index = text.indexOf(anchor.quote, index + Math.max(1, anchor.quote.length));
  }
  if (matches.length === 1) return matches[0];
  return -1;
}

function rangeFor(root: HTMLElement, anchor: PrdCommentAnchor) {
  const text = root.textContent ?? "";
  const start = anchorStart(text, anchor);
  if (start < 0) return null;
  const startPosition = textPosition(root, start);
  const endPosition = textPosition(root, start + anchor.quote.length);
  if (!startPosition || !endPosition) return null;
  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset);
  return range;
}

function blockIndexFor(root: HTMLElement, node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const block = element?.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,pre");
  if (!block) return 0;
  return [...root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,pre")].indexOf(block);
}

export function RequirementMarkdown({ source, demoEntryUrl, assetBaseUrl, className, documentId, documentPath, comments = [], commenterInitial = "我", commentMode = false, onCreateComment, onOpenComment, onCommentPositions }: { source: string; demoEntryUrl: string; assetBaseUrl?: string; className?: string; documentId?: string; documentPath?: string; comments?: RequirementComment[]; commenterInitial?: string; commentMode?: boolean; onCreateComment?: (content: string, anchor: PrdCommentAnchor) => Promise<RequirementComment>; onOpenComment?: (commentId: string) => void; onCommentPositions?: (positions: Record<string, number>) => void }) {
  const root = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<CommentSelection | null>(null);
  const [markers, setMarkers] = useState<CommentMarker[]>([]);
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const [commentError, setCommentError] = useState("");

  useEffect(() => {
    const markerRoot = root.current;
    if (!markerRoot) return;
    let frame = 0;
    const updateMarkers = () => {
      const element = markerRoot;
      const next = comments.filter((comment) => !comment.parentId && !comment.deletedAt && comment.anchor && "start" in comment.anchor).flatMap((comment) => {
        const range = rangeFor(element, comment.anchor as PrdCommentAnchor);
        const rects = range ? [...range.getClientRects()].filter((rect) => rect.width || rect.height) : [];
        if (!rects.length) return [];
        const rootRect = element.getBoundingClientRect();
        const first = rects[0];
        const last = rects[rects.length - 1];
        const toLocalLeft = (rect: DOMRect) => rect.left - rootRect.left + element.scrollLeft;
        const toLocalTop = (rect: DOMRect) => rect.top - rootRect.top + element.scrollTop;
        return [{
          id: comment.id,
          lines: rects.map((rect) => ({ left: toLocalLeft(rect), top: toLocalTop(rect) + rect.height + 2, width: rect.width })),
          buttonLeft: Math.min(element.scrollWidth - 26, toLocalLeft(last) + last.width + 7),
          buttonTop: toLocalTop(last) + Math.min(last.height, 20),
          viewportTop: first.top,
        }];
      });
      setMarkers(next);
      onCommentPositions?.(Object.fromEntries(next.map((marker) => [marker.id, marker.viewportTop])));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateMarkers);
    };
    schedule();
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    markerRoot.addEventListener("scroll", schedule, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    observer?.observe(markerRoot);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      markerRoot.removeEventListener("scroll", schedule);
      observer?.disconnect();
    };
  }, [comments, onCommentPositions, source]);

  function captureSelection() {
    if (!commentMode || !documentId || !documentPath || !onCreateComment || !root.current) return;
    window.setTimeout(() => {
      const selected = window.getSelection();
      const element = root.current;
      if (!selected || selected.isCollapsed || !selected.rangeCount || !element || !element.contains(selected.anchorNode) || !element.contains(selected.focusNode)) return;
      const range = selected.getRangeAt(0);
      const raw = range.toString();
      const quote = raw.trim().slice(0, 1200);
      const rect = range.getBoundingClientRect();
      if (!quote || (!rect.width && !rect.height)) return;
      const leading = raw.length - raw.trimStart().length;
      const start = offsetFor(element, range.startContainer, range.startOffset) + leading;
      const end = start + quote.length;
      const text = element.textContent ?? "";
      setSelection({
        anchor: { documentId, documentPath, quote, prefix: text.slice(Math.max(0, start - 120), start), suffix: text.slice(end, end + 120), start, end, blockIndex: blockIndexFor(element, range.startContainer) },
        left: Math.min((document.querySelector(".prd-comments-panel")?.getBoundingClientRect().left ?? window.innerWidth) - 292, Math.max(12, rect.right + 12)),
        top: Math.max(12, rect.top - 4),
      });
      setCommentText("");
      setCommentError("");
    }, 0);
  }

  async function submitComment() {
    const value = commentText.trim();
    if (!selection || !value || sending || !onCreateComment) return;
    setSending(true);
    setCommentError("");
    try {
      const created = await onCreateComment(value, selection.anchor);
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      setCommentText("");
      onOpenComment?.(created.id);
    } catch (reason) {
      setCommentError(reason instanceof Error ? reason.message : "评论保存失败。");
    } finally {
      setSending(false);
    }
  }

  return <article ref={root} onMouseUp={captureSelection} onKeyUp={captureSelection} className={`${className ? `markdown-preview ${className}` : "markdown-preview"}${commentMode ? " is-commenting" : ""}`}>
    <div className="prd-comment-highlight-layer" aria-hidden="true">
      {markers.flatMap((marker) => marker.lines.map((line, index) => <span key={`${marker.id}-${index}`} className="prd-comment-highlight" style={{ left: line.left, top: line.top, width: line.width }} />))}
    </div>
    {markers.map((marker) => <button key={`marker-${marker.id}`} type="button" className="prd-comment-marker" style={{ left: marker.buttonLeft, top: marker.buttonTop }} onClick={() => onOpenComment?.(marker.id)} title="查看评论" aria-label="查看这段文字的评论">●</button>)}
    {selection ? <div className="prd-selection-composer" style={{ left: selection.left, top: selection.top }} role="dialog" aria-label="添加评论"><span className="prd-selection-avatar">{commenterInitial}</span><input value={commentText} onChange={(event) => setCommentText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitComment(); } if (event.key === "Escape") { setSelection(null); setCommentText(""); } }} placeholder="添加评论…" autoFocus /><button type="button" className="prd-selection-send" onClick={() => void submitComment()} disabled={!commentText.trim() || sending} aria-label="发送评论">✓</button><button type="button" className="prd-selection-close" onClick={() => { setSelection(null); setCommentText(""); }} aria-label="取消评论">×</button>{commentError ? <small>{commentError}</small> : null}</div> : null}
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: ({ className: codeClassName, children }) => {
          const language = /language-([^\s]+)/.exec(codeClassName ?? "")?.[1]?.toLowerCase();
          const value = String(children).replace(/\n$/, "");
          if (language === "mermaid") return <MermaidDiagram key={value} source={value} />;
          return <code className={codeClassName}>{children}</code>;
        },
        img: ({ src, alt }) => {
          const imageUrl = typeof src === "string" ? resolveImageUrl(src, demoEntryUrl, assetBaseUrl) : "";
          if (!imageUrl) return <span className="markdown-image-missing">图片资源不可用：{alt || "未命名图片"}</span>;
          // The source is an authenticated, version-scoped route, so Next image optimization cannot fetch it server-side.
          // eslint-disable-next-line @next/next/no-img-element
          return <img src={imageUrl} alt={alt || ""} loading="lazy" />;
        },
      }}
    >
      {source}
    </ReactMarkdown>
  </article>;
}
