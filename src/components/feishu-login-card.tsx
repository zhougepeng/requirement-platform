"use client";

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    QRLogin?: (input: { id: string; goto: string; width?: string; height?: string; style?: string }) => {
      matchOrigin: (origin: string) => boolean;
      matchData: (data: unknown) => boolean;
    };
  }
}

const QR_SDK = "https://lf-package-cn.feishucdn.com/obj/feishu-static/lark/passport/qrcode/LarkSSOSDKWebQRCode-1.0.3.js";
const EXPIRE_MS = 5 * 60 * 1000;

type LoginStatus = "loading" | "ready" | "confirming" | "expired" | "error";

function errorText(value?: string) {
  const messages: Record<string, string> = {
    tenant: "当前账号无访问权限，请使用公司飞书账号重新扫码。",
    state: "登录校验已失效，请重新扫码。",
    cancelled: "你已取消飞书授权，请重新扫码。",
    configuration: "飞书登录尚未完成配置，请联系管理员。",
    failed: "登录失败，请重新尝试。",
  };
  return value ? messages[value] || messages.failed : "";
}

export function FeishuLoginCard({ returnTo, initialError, tenantKey }: { returnTo: string; initialError?: string; tenantKey?: string }) {
  const [status, setStatus] = useState<LoginStatus>(initialError ? "error" : "loading");
  const [message, setMessage] = useState(errorText(initialError));
  const instanceRef = useRef<{ matchOrigin: (origin: string) => boolean; matchData: (data: unknown) => boolean } | undefined>(undefined);
  const gotoRef = useRef("");

  const loadQrCode = useCallback(async () => {
    setStatus("loading");
    setMessage("");
    const container = document.getElementById("feishu-login-qr");
    if (container) container.replaceChildren();
    try {
      const response = await fetch(`/api/auth/feishu?returnTo=${encodeURIComponent(returnTo)}`, { cache: "no-store" });
      const payload = await response.json() as { data?: { goto?: string }; error?: string };
      const goto = payload.data?.goto;
      if (!response.ok || !goto) throw new Error(payload.error || "二维码加载失败。");
      gotoRef.current = goto;
      const initialize = () => {
        if (!window.QRLogin) throw new Error("飞书二维码组件加载失败。");
        instanceRef.current = window.QRLogin({ id: "feishu-login-qr", goto, width: "280", height: "280", style: "width:280px;height:280px" });
        setStatus("ready");
        window.setTimeout(() => {
          setStatus((current) => current === "ready" ? "expired" : current);
        }, EXPIRE_MS);
      };
      if (window.QRLogin) initialize();
      else {
        const script = document.createElement("script");
        script.src = QR_SDK;
        script.async = true;
        script.onload = initialize;
        script.onerror = () => { setStatus("error"); setMessage("二维码加载失败，请刷新后重试。"); };
        document.head.append(script);
      }
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "二维码加载失败，请重新尝试。");
    }
  }, [returnTo]);

  useEffect(() => {
    if (tenantKey) return;
    const handleMessage = (event: MessageEvent) => {
      const qr = instanceRef.current;
      if (!qr || !qr.matchOrigin(event.origin) || !qr.matchData(event.data)) return;
      const tmpCode = (event.data as { tmp_code?: unknown })?.tmp_code;
      if (typeof tmpCode !== "string" || !tmpCode) return;
      setStatus("confirming");
      setMessage("已扫码，请在飞书确认登录。");
      const goto = gotoRef.current;
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 飞书二维码 SDK 要求跳转到外部授权地址。
      if (goto) window.location.href = `${goto}&tmp_code=${encodeURIComponent(tmpCode)}`;
    };
    window.addEventListener("message", handleMessage);
    const timer = window.setTimeout(() => { void loadQrCode(); }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", handleMessage);
    };
  }, [loadQrCode, tenantKey]);

  const directLogin = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  if (tenantKey) return <main className="login-page"><section className="login-card tenant-discovery-card"><span className="login-mark">✓</span><h1>已读取企业标识</h1><p>请复制下面的值，填写到服务器配置。</p><code className="tenant-key-value">{tenantKey}</code><p className="tenant-key-hint">填写 <b>FEISHU_ALLOWED_TENANT_KEY</b> 后，删除 <b>FEISHU_TENANT_DISCOVERY=true</b> 并重启服务。</p><a className="login-fallback" href="/login">完成后重新登录</a></section></main>;
  return <main className="login-page"><section className="login-card" aria-labelledby="login-title"><span className="login-mark">▣</span><h1 id="login-title">需求管理平台</h1><p>使用飞书扫码登录</p><div className="login-qr-shell" aria-live="polite"><div id="feishu-login-qr" />{status === "loading" ? <span>正在加载二维码…</span> : null}{status === "expired" ? <div className="login-qr-overlay"><b>二维码已失效</b><button onClick={() => void loadQrCode()}>刷新二维码</button></div> : null}{status === "error" ? <div className="login-qr-overlay is-error"><b>登录暂不可用</b><button onClick={() => void loadQrCode()}>重新尝试</button></div> : null}</div><p className={`login-status ${status === "error" ? "is-error" : ""}`}>{message || (status === "confirming" ? "正在登录…" : status === "ready" ? "请使用公司飞书扫码" : "")}</p><a className="login-fallback" href={directLogin}>二维码无法显示？打开飞书授权页</a><small>仅限公司内部成员访问</small></section></main>;
}
