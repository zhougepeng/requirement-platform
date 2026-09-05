"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

type UpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  installerName: string;
  installerUrl: string;
  environment: "linux" | "local";
  updateAvailable: boolean;
  canInstall: boolean;
  blockedReason?: string;
};

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.text();
  let payload: { data?: T; error?: string } = {};
  if (body) {
    try {
      payload = JSON.parse(body) as { data?: T; error?: string };
    } catch {
      throw new Error(response.status === 502
        ? "更新服务在返回结果前断开。请稍后刷新页面确认版本；若版本未变化，请在服务器查看更新日志。"
        : "更新服务返回了无法识别的结果，请稍后重试。");
    }
  }
  if (!response.ok || !payload.data) {
    throw new Error(payload.error || (response.status === 502
      ? "更新服务在返回结果前断开。请稍后刷新页面确认版本；若版本未变化，请在服务器查看更新日志。"
      : "更新检查失败。"));
  }
  return payload.data;
}

export function GithubUpdateManager({ initialOpen = false, hideTrigger = false, onClose }: { initialOpen?: boolean; hideTrigger?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(initialOpen);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (initialOpen) void check();
  }, [initialOpen]);

  async function check() {
    setLoading(true);
    setError("");
    setComplete(false);
    try {
      setStatus(await request<UpdateStatus>("/api/v1/admin/update"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法检查安装包更新。");
    } finally {
      setLoading(false);
    }
  }

  async function install() {
    if (!status?.canInstall || pulling) return;
    setPulling(true);
    setError("");
    try {
      const result = await request<UpdateStatus>("/api/v1/admin/update", { method: "POST" });
      setStatus(result);
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法启动安装包更新。");
    } finally {
      setPulling(false);
    }
  }

  function close() {
    setOpen(false);
    onClose?.();
  }

  return <>
    {!hideTrigger ? <button className="model-manager-trigger" onClick={() => { setOpen(true); void check(); }} title="检查更新" aria-label="检查更新"><Icon name="refresh" /></button> : null}
    {open ? <div className="model-manager-layer" role="presentation"><button className="model-manager-backdrop" aria-label="关闭系统更新" onClick={close} /><section className="model-manager-dialog github-update-dialog" role="dialog" aria-modal="true" aria-labelledby="github-update-title">
      <header><div><h2 id="github-update-title">系统更新</h2><p>检查 GitHub Release 中的 Linux 安装包。</p></div><button className="model-manager-close" onClick={close} aria-label="关闭系统更新"><Icon name="close" /></button></header>
      <div className="model-manager-body github-update-body">
        {loading ? <p className="model-manager-empty">正在检查新安装包…</p> : null}
        {!loading && error ? <p className="model-manager-error">{error}</p> : null}
        {!loading && status ? <div className="github-update-status">
          <div><span>当前版本</span><code>{status.currentVersion}</code></div><div><span>最新安装包</span><code>{status.latestVersion}</code></div>
          {complete ? <p className="github-update-success">更新任务已启动。安装完成后服务会自动重启；页面可能暂时断开，请稍后刷新。</p> : status.updateAvailable ? <p className="github-update-available">发现新版安装包：{status.installerName}。</p> : <p className="github-update-current">当前已经是最新安装包版本。</p>}
          {status.updateAvailable && status.blockedReason ? <p className={status.environment === "local" ? "github-update-note" : "model-manager-error"}>{status.blockedReason}</p> : null}
          {status.updateAvailable && status.environment === "local" && status.installerUrl ? <a className="github-update-download" href={status.installerUrl} target="_blank" rel="noreferrer">下载 Linux 安装包</a> : null}
        </div> : null}
      </div>
      <footer className="github-update-footer"><button className="model-cancel" onClick={close}>关闭</button><button className="model-cancel" disabled={loading || pulling} onClick={() => void check()}><Icon name="refresh" />重新检查</button>{status?.canInstall && !complete ? <button className="model-save" disabled={pulling} onClick={() => void install()}>{pulling ? "正在启动更新…" : "下载并更新"}</button> : null}</footer>
    </section></div> : null}
  </>;
}
