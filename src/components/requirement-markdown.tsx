"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import mermaid from "mermaid";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PrdCommentAnchor, RequirementComment } from "@/lib/types";
import { Icon } from "@/components/icons";

let mermaidSequence = 0;
const fallbackFlowchartSources = new Set<string>();

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  themeVariables: {
    primaryColor: "#ecfdf5",
    primaryBorderColor: "#10b981",
    primaryTextColor: "#27272a",
    lineColor: "#71717a",
    secondaryColor: "#f8fafc",
    tertiaryColor: "#ffffff",
  },
});

function normalizeMermaidSource(source: string) {
  return source.replace(/\r\n/g, "\n").replace(
    /^(\s*[A-Za-z][\w-]*)\s*-->\s*([^\[\]{}<>|\r\n]+?)\s*-->\s*([A-Za-z][\w-]*(?:\s*[\[{].*)?)\s*$/gm,
    (_match, from, label, target) => `${from.trim()} -->|${label.trim()}| ${target.trim()}`,
  );
}

function escapeSvgText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function renderFlowchartFallback(source: string) {
  type Node = { id: string; label: string; decision: boolean };
  type Edge = { from: string; to: string; label: string; dashed: boolean };
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const ensureNode = (id: string, label = id, decision = false) => {
    const current = nodes.get(id);
    if (!current || current.label === current.id) {
      nodes.set(id, { id, label, decision });
      return;
    }
    // An edge may be declared before the node shape. Keep the later shape
    // information so a decision remains a diamond in the fallback renderer.
    if (decision && !current.decision) nodes.set(id, { ...current, decision: true });
  };

  for (const line of source.split("\n")) {
    for (const match of line.matchAll(/([A-Za-z][\w-]*)\s*(?:\[([^\]]+)\]|\{([^}]+)\})/g)) {
      ensureNode(match[1], match[2] || match[3] || match[1], Boolean(match[3]));
    }
    // A node shape can be declared on the same line as an edge
    // (A[开始] --> B[下一步]). Remove only the shape text before parsing
    // edges, otherwise the bracket interrupts the arrow matcher.
    const edgeLine = line.replace(/([A-Za-z][\w-]*)\s*(?:\[[^\]]+\]|\{[^}]+\})/g, "$1");

    // Mermaid permits chained edges (A --> B --> C) and fan-out edges
    // (A --> B & C). Reading every edge instead of only the first one keeps
    // branch and convergence lines intact in the local fallback renderer.
    for (const match of edgeLine.matchAll(/([A-Za-z][\w-]*)\s*(-->|-\.->)\s*(?:\|([^|]+)\|\s*)?([A-Za-z][\w-]*)/g)) {
      const from = match[1];
      const to = match[4];
      const label = (match[3] || "").trim();
      ensureNode(from);
      ensureNode(to);
      if (!edges.some((edge) => edge.from === from && edge.to === to && edge.label === label)) edges.push({ from, to, label, dashed: match[2].startsWith("-.") });
    }
    for (const match of edgeLine.matchAll(/([A-Za-z][\w-]*)\s*-\.\s*([^\.\r\n]+?)\s*\.->\s*([A-Za-z][\w-]*)/g)) {
      const from = match[1];
      const to = match[3];
      const label = match[2].trim();
      ensureNode(from);
      ensureNode(to);
      if (!edges.some((edge) => edge.from === from && edge.to === to && edge.label === label)) edges.push({ from, to, label, dashed: true });
    }
    for (const match of edgeLine.matchAll(/([A-Za-z][\w-]*)\s*(-->|-\.->)\s*(?:\|([^|]+)\|\s*)?([A-Za-z][\w-]*)\s*&\s*([A-Za-z][\w-]*)/g)) {
      const from = match[1];
      const label = (match[3] || "").trim();
      ensureNode(from);
      for (const to of [match[4], match[5]]) {
        ensureNode(to);
        if (!edges.some((edge) => edge.from === from && edge.to === to && edge.label === label)) edges.push({ from, to, label, dashed: match[2].startsWith("-.") });
      }
    }
  }

  if (!nodes.size) return "";
  const levels = new Map<string, number>([...nodes.keys()].map((id) => [id, 0]));
  for (let round = 0; round < nodes.size; round += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = Math.min(nodes.size - 1, (levels.get(edge.from) || 0) + 1);
      if (next > (levels.get(edge.to) || 0)) {
        levels.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const groups = new Map<number, string[]>();
  for (const id of nodes.keys()) {
    const level = levels.get(id) || 0;
    groups.set(level, [...(groups.get(level) || []), id]);
  }
  const maxItems = Math.max(...[...groups.values()].map((group) => group.length));
  const nodeWidth = 174;
  const nodeHeight = 48;
  const decisionWidth = 176;
  const decisionHeight = 86;
  const horizontalGap = 28;
  const sidePadding = 48;
  // Keep four-way branches inside the normal content width. The previous
  // fixed 220px column spacing made the diagram needlessly wide and added a
  // horizontal scrollbar even when the labels fit comfortably.
  const width = Math.max(860, maxItems * nodeWidth + Math.max(0, maxItems - 1) * horizontalGap + sidePadding * 2);
  // Levels can have gaps when the source contains branches or a disconnected
  // node. Base the canvas height on the deepest level rather than the number
  // of populated groups so the last nodes and edges are never clipped.
  const maxLevel = Math.max(...levels.values());
  const height = Math.max(220, (maxLevel + 1) * 126 + 64);
  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, ids] of groups) {
    const contentWidth = ids.length * nodeWidth + Math.max(0, ids.length - 1) * horizontalGap;
    const startX = (width - contentWidth) / 2;
    ids.forEach((id, index) => positions.set(id, { x: startX + nodeWidth / 2 + index * (nodeWidth + horizontalGap), y: 54 + level * 126 }));
  }
  const nodeBounds = (node: Node) => (node.decision ? { width: decisionWidth, height: decisionHeight } : { width: nodeWidth, height: nodeHeight });
  const xValues = [...positions.values()].map(({ x }) => x);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const longLaneCounters = new Map<string, number>();
  const edgeSvg = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    if (!from || !to || !fromNode || !toNode) return "";
    const fromBounds = nodeBounds(fromNode);
    const toBounds = nodeBounds(toNode);
    const startY = from.y + fromBounds.height / 2;
    const endY = to.y - toBounds.height / 2;
    const bend = Math.max(28, Math.abs(endY - startY) * 0.42);
    const fromLevel = levels.get(edge.from) || 0;
    const toLevel = levels.get(edge.to) || 0;
    // Use the rendered distance as a second guard. A direct edge can make
    // the level numbers look adjacent even when another branch sits between
    // the two nodes vertically.
    const isLongEdge = toLevel - fromLevel > 1 || endY - startY > 160;
    // Long convergence edges must travel around the intermediate branch
    // instead of cutting through another decision diamond. Exception edges
    // get independent lanes, otherwise the four "异常/超时" paths collapse
    // into one dashed line and their labels become unreadable.
    // Exception paths should leave the main spine on the same side as their
    // destination. This keeps O/P/Q/R -> AA on the right instead of dragging
    // four dashed lines across the entire diagram; long solid convergence
    // paths keep the left-side routing used to avoid intermediate branches.
    const routeRight = edge.dashed || from.x > to.x;
    const direction = routeRight ? "right" : "left";
    const laneKey = `${edge.to}:${edge.dashed ? "dashed" : "solid"}:${direction}`;
    const laneIndex = isLongEdge ? (longLaneCounters.get(laneKey) || 0) : 0;
    if (isLongEdge) longLaneCounters.set(laneKey, laneIndex + 1);
    const laneBase = edge.dashed ? 28 : 88;
    const laneStep = edge.dashed ? 34 : 40;
    const laneX = routeRight
      ? Math.min(width - 24, maxX + laneBase + laneIndex * laneStep)
      : Math.max(24, minX - laneBase - laneIndex * laneStep);
    const path = isLongEdge
      ? `M ${from.x} ${startY} C ${from.x} ${startY + 24}, ${laneX} ${startY + 24}, ${laneX} ${startY + 52} V ${endY - 52} C ${laneX} ${endY - 24}, ${to.x} ${endY - 24}, ${to.x} ${endY}`
      : `M ${from.x} ${startY} C ${from.x} ${startY + bend}, ${to.x} ${endY - bend}, ${to.x} ${endY}`;
    const labelHalfWidth = Math.max(13, edge.label.length * 6);
    const rawMidX = isLongEdge ? laneX + (edge.dashed ? 24 : 0) : Math.round((from.x + to.x) / 2);
    // Keep lane labels inside the SVG when several exception branches use the
    // right-hand lanes near the canvas edge.
    const midX = Math.max(labelHalfWidth + 8, Math.min(width - labelHalfWidth - 8, rawMidX));
    const midY = Math.round((startY + endY) / 2);
    const label = edge.label
      ? `<g class="flowchart-fallback-edge-label"><rect x="${midX - labelHalfWidth}" y="${midY - 12}" width="${labelHalfWidth * 2}" height="20" rx="10"/><text x="${midX}" y="${midY + 3}" text-anchor="middle" class="flowchart-fallback-label">${escapeSvgText(edge.label)}</text></g>`
      : "";
    return `<path d="${path}" class="flowchart-fallback-edge${edge.dashed ? " is-dashed" : ""}" marker-end="url(#flowchart-arrow)"/>${label}`;
  }).join("");
  const nodeSvg = [...nodes.values()].map((node) => {
    const point = positions.get(node.id);
    if (!point) return "";
    const words = [...node.label].reduce<string[]>((lines, character) => {
      const current = lines[lines.length - 1] || "";
      if (current.length >= 16) lines.push(character);
      else if (lines.length) lines[lines.length - 1] = current + character;
      else lines.push(character);
      return lines;
    }, []);
    const text = words.slice(0, 3).map((line, index) => `<tspan x="${point.x}" dy="${index ? 16 : 0}">${escapeSvgText(line)}${index === 2 && words.length > 3 ? "…" : ""}</tspan>`).join("");
    const textOffset = (Math.min(words.length, 3) - 1) * 8;
    const shape = node.decision
      ? `<polygon points="${point.x},${point.y - decisionHeight / 2} ${point.x + decisionWidth / 2},${point.y} ${point.x},${point.y + decisionHeight / 2} ${point.x - decisionWidth / 2},${point.y}" class="flowchart-fallback-node is-decision"/>`
      : `<rect x="${point.x - nodeWidth / 2}" y="${point.y - nodeHeight / 2}" width="${nodeWidth}" height="${nodeHeight}" rx="8" class="flowchart-fallback-node"/>`;
    return `<g>${shape}<text x="${point.x}" y="${point.y - textOffset + 5}" text-anchor="middle" class="flowchart-fallback-node-text">${text}</text></g>`;
  }).join("");
  return `<svg class="flowchart-fallback-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="业务流程图"><defs><marker id="flowchart-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#64748b"/></marker></defs>${edgeSvg}${nodeSvg}</svg>`;
}

function FlowchartFallback({ source }: { source: string }) {
  const svg = renderFlowchartFallback(source);
  if (!svg) return <div className="mermaid-diagram is-failed"><p>流程图语法无法渲染，保留原始内容供检查。</p><pre><code>{source}</code></pre></div>;
  return <DiagramViewport svg={svg} className="flowchart-fallback" />;
}

function DiagramViewport({ svg, className = "" }: { svg: string; className?: string }) {
  const [scale, setScale] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  return <div className={`mermaid-diagram ${className}${fullscreen ? " is-fullscreen" : ""}`}>
    <div className="mermaid-controls" role="toolbar" aria-label="流程图查看工具">
      <button type="button" className="mermaid-zoom-button" onClick={() => setScale((value) => Math.max(50, value - 25))} title="缩小流程图" aria-label="缩小流程图">-</button>
      <button type="button" onClick={() => setScale(100)} title="还原流程图大小" aria-label="还原流程图大小"><Icon name="refresh" /></button>
      <button type="button" onClick={() => setScale((value) => Math.min(250, value + 25))} title="放大流程图" aria-label="放大流程图"><Icon name="plus" /></button>
      <button type="button" onClick={() => setFullscreen((value) => !value)} title={fullscreen ? "退出完整流程图" : "展开完整流程图"} aria-label={fullscreen ? "退出完整流程图" : "展开完整流程图"}><Icon name="external" /></button>
    </div>
    <div className="mermaid-canvas" style={{ zoom: scale / 100 } as CSSProperties} dangerouslySetInnerHTML={{ __html: svg }} />
    {fullscreen ? <button type="button" className="mermaid-fullscreen-dismiss" onClick={() => setFullscreen(false)} aria-label="关闭完整流程图" /> : null}
  </div>;
}

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const isFlowchart = /^\s*(?:flowchart|graph)\s+/m.test(source);
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  const [showFallback, setShowFallback] = useState(() => isFlowchart || fallbackFlowchartSources.has(source));

  useEffect(() => {
    if (isFlowchart) return;
    let active = true;
    const id = `requirement-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${mermaidSequence++}`;
    const timeout = window.setTimeout(() => {
      if (!active) return;
      fallbackFlowchartSources.add(source);
      setShowFallback(true);
    }, 1800);
    void mermaid
      .render(id, normalizeMermaidSource(source))
      .then(({ svg: nextSvg }) => {
        if (active) {
          window.clearTimeout(timeout);
          setSvg(nextSvg);
          setShowFallback(false);
        }
      })
      .catch(() => {
        if (active) {
          window.clearTimeout(timeout);
          setFailed(true);
        }
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [isFlowchart, reactId, source]);

  if (failed) return <div className="mermaid-diagram is-failed"><p>流程图语法无法渲染，保留原始内容供检查。</p><pre><code>{source}</code></pre></div>;
  // Mermaid 11 的异步布局模块在当前 Next 开发环境中可能永远不返回；流程图直接使用本地 SVG 渲染，避免切换 PRD 后长期停在加载态。
  if (showFallback || isFlowchart) return <FlowchartFallback source={source} />;
  if (!svg) return <div className="mermaid-diagram is-loading" aria-busy="true">正在渲染流程图…</div>;
  return <DiagramViewport svg={svg} />;
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
