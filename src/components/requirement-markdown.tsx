"use client";

import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

export function RequirementMarkdown({ source, demoEntryUrl, assetBaseUrl, className }: { source: string; demoEntryUrl: string; assetBaseUrl?: string; className?: string }) {
  return <article className={className ? `markdown-preview ${className}` : "markdown-preview"}>
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
