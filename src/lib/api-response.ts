import { NextResponse } from "next/server";

export function apiError(error: unknown, fallback = "请求处理失败。") {
  const message = error instanceof Error ? error.message : fallback;
  const explicitStatus = typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : NaN;
  const status = Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599
    ? explicitStatus
    : /尚未配置/.test(message) ? 503 : /请先使用飞书登录|个人访问令牌无效|个人访问令牌已撤销/.test(message) ? 401 : /没有发布权限|没有管理员权限|尚未获准使用|个人访问令牌不能访问管理接口|不能停用最后一名管理员|至少保留一名(?:启用中|有效)的管理员/.test(message) ? 403 : /不存在|不完整/.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

export function apiJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}
