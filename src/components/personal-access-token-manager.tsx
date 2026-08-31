"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

type AccessToken = {
  id: string;
  label: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

type CreatedAccessToken = { token: string; accessToken: AccessToken };

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json() as { data?: T; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error || "个人访问令牌请求失败。" );
  return payload.data;
}

export function PersonalAccessTokenManager({ initialOpen = false, onClose }: { initialOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(initialOpen);
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [revealedToken, setRevealedToken] = useState("");
  const [loading, setLoading] = useState(initialOpen);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setTokens(await request<AccessToken[]>("/api/v1/auth/access-tokens"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取个人访问令牌。" );
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await request<CreatedAccessToken>("/api/v1/auth/access-tokens", {
        method: "POST",
        body: JSON.stringify({ label: "个人访问令牌" }),
      });
      setRevealedToken(result.token);
      await load();
      setNotice("新令牌已生成，旧令牌已立即失效。请现在复制并保存。" );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法生成个人访问令牌。" );
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{ revoked: number }>("/api/v1/auth/access-tokens", { method: "DELETE" });
      setRevealedToken("");
      await load();
      setNotice(result.revoked ? "个人访问令牌已停用。" : "当前没有可停用的个人访问令牌。" );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法停用个人访问令牌。" );
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(revealedToken);
      setNotice("令牌已复制。请粘贴到需要对接的应用设置中。" );
    } catch {
      setError("无法自动复制，请手动复制令牌。" );
    }
  }

  function close() {
    setOpen(false);
    onClose?.();
  }

  const activeToken = tokens.find((token) => !token.revokedAt);

  useEffect(() => {
    if (!initialOpen) return;
    let cancelled = false;
    void request<AccessToken[]>("/api/v1/auth/access-tokens")
      .then((result) => { if (!cancelled) setTokens(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "无法读取个人访问令牌。" ); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [initialOpen]);

  return open ? <div className="model-manager-layer" role="presentation">
    <button className="model-manager-backdrop" aria-label="关闭个人访问令牌" onClick={close} />
    <section className="model-manager-dialog personal-access-token-dialog" role="dialog" aria-modal="true" aria-labelledby="personal-access-token-title">
      <header><div><h2 id="personal-access-token-title">个人访问令牌</h2><p>用于工作搭子、CLI 或其他已接入应用代表你创建需求。令牌只具备发布权限，不可进入管理接口。</p></div><button className="model-manager-close" onClick={close} aria-label="关闭个人访问令牌"><Icon name="close" /></button></header>
      <div className="model-manager-body">
        {error ? <p className="model-manager-error">{error}</p> : null}
        {notice ? <p className="personal-access-token-notice">{notice}</p> : null}
        {revealedToken ? <section className="personal-access-token-secret"><strong>请立即复制令牌</strong><p>关闭此窗口后不会再显示完整内容；需要时请重新生成。</p><code>{revealedToken}</code><button className="model-save" onClick={() => void copy()}><Icon name="link" />复制令牌</button></section> : null}
        {loading ? <p className="model-manager-empty">正在读取个人访问令牌…</p> : <section className="personal-access-token-status"><b>{activeToken ? "已配置个人访问令牌" : "尚未生成个人访问令牌"}</b>{activeToken ? <><span>{activeToken.tokenPrefix}…</span><small>创建于 {activeToken.createdAt}{activeToken.lastUsedAt ? `，最近使用 ${activeToken.lastUsedAt}` : "，尚未使用"}</small></> : <small>生成后配置到工作搭子或其他已接入应用。</small>}</section>}
      </div>
      <footer className="github-update-footer"><button className="model-cancel" onClick={close}>关闭</button>{activeToken ? <button className="model-cancel" disabled={saving} onClick={() => void revoke()}>停用令牌</button> : null}<button className="model-save" disabled={saving} onClick={() => void create()}>{saving ? "处理中…" : activeToken ? "重新生成" : "生成令牌"}</button></footer>
    </section>
  </div> : null;
}
