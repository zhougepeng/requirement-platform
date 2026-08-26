"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

type UpdateStatus = {
  currentCommit: string;
  remoteCommit: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  updateAvailable: boolean;
  canPull: boolean;
  blockedReason?: string;
};

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json() as { data?: T; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error || "更新检查失败。");
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
      setError(reason instanceof Error ? reason.message : "无法检查 GitHub 更新。");
    } finally {
      setLoading(false);
    }
  }

  async function pull() {
    if (!status?.canPull || pulling) return;
    setPulling(true);
    setError("");
    try {
      const result = await request<UpdateStatus>("/api/v1/admin/update", { method: "POST" });
      setStatus(result);
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法拉取 GitHub 更新。");
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
      <header><div><h2 id="github-update-title">系统更新</h2><p>检查需求库 GitHub 仓库的 main 分支。</p></div><button className="model-manager-close" onClick={close} aria-label="关闭系统更新"><Icon name="close" /></button></header>
      <div className="model-manager-body github-update-body">
        {loading ? <p className="model-manager-empty">正在检查 GitHub 更新…</p> : null}
        {!loading && error ? <p className="model-manager-error">{error}</p> : null}
        {!loading && status ? <div className="github-update-status">
          <div><span>当前版本</span><code>{status.currentCommit}</code></div><div><span>GitHub 版本</span><code>{status.remoteCommit}</code></div>
          {complete ? <p className="github-update-success">代码已拉取。请重新构建并重启需求库服务后生效。</p> : status.updateAvailable ? <p className="github-update-available">发现 {status.behind} 个更新提交。</p> : <p className="github-update-current">当前已经是 GitHub 最新版本。</p>}
          {status.updateAvailable && status.blockedReason ? <p className="model-manager-error">{status.blockedReason}</p> : null}
          {!status.updateAvailable && status.dirty ? <p className="github-update-note">当前存在本地修改；下次发现更新时，需先提交或处理这些修改后才能拉取。</p> : null}
        </div> : null}
      </div>
      <footer className="github-update-footer"><button className="model-cancel" onClick={close}>关闭</button><button className="model-cancel" disabled={loading || pulling} onClick={() => void check()}><Icon name="refresh" />重新检查</button>{status?.canPull && !complete ? <button className="model-save" disabled={pulling} onClick={() => void pull()}>{pulling ? "拉取中…" : "拉取更新"}</button> : null}</footer>
    </section></div> : null}
  </>;
}
