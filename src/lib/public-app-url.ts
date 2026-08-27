/**
 * 生成浏览器应访问的公开地址。服务监听 0.0.0.0 时，不能用请求内部地址作为 OAuth 回跳地址。
 */
export function publicAppUrl(pathname: string, fallbackRequestUrl: string) {
  const configuredBase = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  const configuredRedirect = process.env.FEISHU_REDIRECT_URI?.trim();
  const candidates = [configuredBase, configuredRedirect, fallbackRequestUrl];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (/^https?:$/.test(parsed.protocol) && parsed.hostname !== "0.0.0.0" && parsed.hostname !== "::") {
        return new URL(pathname, parsed.origin);
      }
    } catch {
      // 尝试下一个来源；最终回退到当前请求地址。
    }
  }
  return new URL(pathname, fallbackRequestUrl);
}
