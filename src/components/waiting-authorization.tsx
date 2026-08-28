"use client";

import { useState } from "react";

type WaitingAuthorizationProps = { name: string };

export function WaitingAuthorization({ name }: WaitingAuthorizationProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  async function refreshPermission() {
    if (refreshing) return;
    setRefreshing(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/auth/me", { cache: "no-store" });
      const payload = await response.json() as { data?: { pendingApproval?: boolean }; error?: string };
      if (!response.ok) throw new Error(payload.error || "权限检查失败。");
      if (payload.data?.pendingApproval === false) {
        window.location.reload();
        return;
      }
      setMessage("暂未获得权限，请管理员在“员工与权限”中开通后重试。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "权限检查失败，请稍后重试。");
    } finally {
      setRefreshing(false);
    }
  }

  return <main className="waiting-authorization-page">
    <section className="waiting-authorization-card" aria-labelledby="waiting-authorization-title">
      <div className="waiting-authorization-icon" aria-hidden="true">⌛</div>
      <h1 id="waiting-authorization-title">账号等待授权</h1>
      <p>你好，{name}。你已通过公司飞书验证，管理员分配平台权限后即可访问需求库。</p>
      <span className="waiting-authorization-status">等待管理员授权</span>
      {message ? <p className="waiting-authorization-message" role="status">{message}</p> : null}
      <div className="waiting-authorization-actions">
        <button className="publish-button" onClick={() => void refreshPermission()} disabled={refreshing}>{refreshing ? "检查中…" : "刷新权限"}</button>
        <a className="waiting-authorization-logout" href="/auth/logout">退出登录</a>
      </div>
    </section>
  </main>;
}
