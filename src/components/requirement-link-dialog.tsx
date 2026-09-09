"use client";

import { createPortal } from "react-dom";

export function RequirementLinkDialog({ open, requirementTitle, versionNumber, onClose, onCopy }: { open: boolean; requirementTitle: string; versionNumber: number; onClose: () => void; onCopy: (mode: "short" | "long") => Promise<void> }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="release-status-dialog-layer" onClick={onClose}>
      <button className="release-status-dialog-backdrop" aria-label="关闭复制链接选项" />
      <section className="requirement-link-dialog" role="dialog" aria-modal="true" aria-labelledby="requirement-link-title" onClick={(event) => event.stopPropagation()}>
        <header><div><h2 id="requirement-link-title">复制需求链接</h2><small>{requirementTitle} · V{versionNumber}</small></div><button type="button" className="release-status-close" onClick={onClose} aria-label="关闭">×</button></header>
        <div className="requirement-link-options">
          <button type="button" onClick={() => void onCopy("short")}><strong>短期匿名预览</strong><span>7 天有效 · 无需登录 · 仅查看 Demo 和 PRD</span></button>
          <button type="button" onClick={() => void onCopy("long")}><strong>长期访问链接</strong><span>长期有效 · 需要登录 · 保留完整需求权限</span></button>
        </div>
        <footer><button type="button" className="release-status-cancel" onClick={onClose}>取消</button></footer>
      </section>
    </div>,
    document.body,
  );
}
