"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

type UpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  installerName: string;
  installerUrl: string;
  deployment: "installer" | "docker";
  target: string;
  environment: "linux" | "local";
  updateAvailable: boolean;
  canInstall: boolean;
  blockedReason?: string;
  job?: {
    id: string;
    state: "running" | "success" | "failed";
    startedAt: string;
    finishedAt?: string;
    message?: string;
    installedVersion?: string;
  };
  started?: boolean;
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

  useEffect(() => {
    if (initialOpen) void check();
  }, [initialOpen]);

  useEffect(() => {
    if (!open || status?.job?.state !== "running") return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void request<UpdateStatus>("/api/v1/admin/update")
        .then((next) => {
          if (!stopped) {
            setStatus(next);
            setError("");
          }
        })
        .catch((reason) => {
          if (!stopped) setError(reason instanceof Error ? reason.message : "正在等待更新服务恢复。");
        });
    }, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [open, status?.job?.state]);

  async function check() {
    setLoading(true);
    setError("");
    try {
      setStatus(await request<UpdateStatus>("/api/v1/admin/update"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法检查更新。");
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法启动更新。");
    } finally {
      setPulling(false);
    }
  }

  function close() {
    setOpen(false);
    onClose?.();
  }

  const dockerDeployment = status?.deployment === "docker";
  const updateTarget = dockerDeployment && status ? status.target + ":" + status.latestVersion : status?.installerName || "";

  return <>
    {!hideTrigger ? <button className="model-manager-trigger" onClick={() => { setOpen(true); void check(); }} title="检查更新" aria-label="检查更新"><Icon name="refresh" /></button> : null}
    {open ? <div className="model-manager-layer" role="presentation"><button className="model-manager-backdrop" aria-label="关闭系统更新" onClick={close} /><section className="model-manager-dialog github-update-dialog" role="dialog" aria-modal="true" aria-labelledby="github-update-title">
      <header><div><h2 id="github-update-title">系统更新</h2><p>{dockerDeployment ? "检查 GitHub Release 中的 Docker 镜像。" : "检查 GitHub Release 中的 Linux 安装包。"}</p></div><button className="model-manager-close" onClick={close} aria-label="关闭系统更新"><Icon name="close" /></button></header>
      <div className="model-manager-body github-update-body">
        {loading ? <p className="model-manager-empty">正在检查新版本…</p> : null}
        {!loading && error ? <p className="model-manager-error">{error}</p> : null}
        {!loading && status ? <div className="github-update-status">
          <div><span>当前版本</span><code>{status.currentVersion}</code></div><div><span>{dockerDeployment ? "最新镜像" : "最新安装包"}</span><code>{status.latestVersion}</code></div>
          {status.job?.state === "running" ? <p className="github-update-success">{status.job.message || "更新正在后台执行，服务重启后会自动继续检查。"}</p> : status.job?.state === "failed" ? <p className="model-manager-error">{status.job.message || "更新失败，请查看服务器更新日志后重试。"}</p> : status.job?.state === "success" && !status.updateAvailable ? <p className="github-update-success">{status.job.message || "更新完成，当前服务已是最新版本。"}</p> : status.updateAvailable ? <p className="github-update-available">{dockerDeployment ? "发现新版镜像：" + updateTarget + "。" : "发现新版安装包：" + status.installerName + "。"}</p> : <p className="github-update-current">当前已经是最新{dockerDeployment ? "镜像" : "安装包"}版本。</p>}
          {status.updateAvailable && status.blockedReason ? <p className={status.environment === "local" ? "github-update-note" : "model-manager-error"}>{status.blockedReason}</p> : null}
          {status.updateAvailable && status.environment === "local" && status.installerUrl ? <a className="github-update-download" href={status.installerUrl} target="_blank" rel="noreferrer">下载 Linux 安装包</a> : null}
        </div> : null}
      </div>
      <footer className="github-update-footer"><button className="model-cancel" onClick={close}>关闭</button><button className="model-cancel" disabled={loading || pulling || status?.job?.state === "running"} onClick={() => void check()}><Icon name="refresh" />重新检查</button>{status?.canInstall ? <button className="model-save" disabled={pulling} onClick={() => void install()}>{pulling ? "正在提交更新…" : dockerDeployment ? "拉取并更新" : "下载并更新"}</button> : null}</footer>
    </section></div> : null}
  </>;
}
