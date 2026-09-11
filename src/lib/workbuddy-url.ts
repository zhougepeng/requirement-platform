export function normalizeWorkbuddyUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("请输入工作搭子网址。");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("请输入完整网址，例如 https://workbuddy.example.com。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("工作搭子网址必须使用 http 或 https。");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("工作搭子网址不能包含账号、密码、查询参数或片段。");
  }
  return parsed.toString().replace(/\/$/, "");
}
