import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3312;
const baseUrl = `http://127.0.0.1:${port}`;
const sessionSecret = randomBytes(32).toString("base64url");

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieValue(response, name) {
  const value = response.headers.get("set-cookie") || "";
  const match = value.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1];
}

function readOAuthState(cookie) {
  const [payload, signature] = cookie.split(".");
  expect(payload && signature, "OAuth state Cookie 缺失签名。");
  const expected = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  expect(signature === expected, "OAuth state Cookie 签名无效。");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, { redirect: "manual", ...options });
}

function locationPath(response) {
  const location = response.headers.get("location");
  return location ? new URL(location, baseUrl).pathname + new URL(location, baseUrl).search : "";
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await request("/login");
      if (response.status === 200) return;
    } catch {
      // 进程刚启动时连接尚不可用，继续等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("认证测试服务未能在 10 秒内启动。");
}

const server = spawn(process.execPath, ["server.js"], {
  cwd: path.join(projectRoot, ".next", "standalone"),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    AUTH_MODE: "feishu",
    AUTH_SESSION_SECRET: sessionSecret,
    FEISHU_APP_ID: "cli_test_qr_login",
    FEISHU_APP_SECRET: "test-secret",
    FEISHU_REDIRECT_URI: `${baseUrl}/auth/callback`,
    FEISHU_ALLOWED_TENANT_KEY: "tenant_test",
  },
  stdio: "ignore",
});

async function stopServer() {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
}

try {
  await waitUntilReady();

  const home = await request("/?from=auth-test");
  expect(home.status === 307, "未登录首页未跳转登录页。");
  expect(locationPath(home) === "/login?returnTo=%2F%3Ffrom%3Dauth-test", "首页 returnTo 不正确。");

  const deepLink = await request("/r/ERP-001?version=3");
  expect(deepLink.status === 307, "未登录需求链接未跳转登录页。");
  expect(locationPath(deepLink) === "/login?returnTo=%2Fr%2FERP-001%3Fversion%3D3", "需求链接 returnTo 不正确。");

  const qr = await request("/api/auth/feishu?returnTo=https%3A%2F%2Fevil.example");
  expect(qr.status === 200, "二维码授权地址未生成。");
  const qrBody = await qr.json();
  expect(new URL(qrBody.data?.goto).host === "passport.feishu.cn", "二维码未使用飞书授权地址。");
  const oauthCookie = cookieValue(qr, "requirement_platform_oauth_state");
  expect(oauthCookie, "二维码授权缺少 state Cookie。");
  expect(readOAuthState(oauthCookie).returnTo === "/", "外部 returnTo 未被拒绝。");

  const invalidState = await request("/auth/callback?code=unused&state=tampered", {
    headers: { Cookie: `requirement_platform_oauth_state=${oauthCookie}` },
  });
  expect(invalidState.status === 307 && locationPath(invalidState) === "/login?error=state", "篡改 state 未被拒绝。");
  expect(!cookieValue(invalidState, "requirement_platform_session"), "篡改 state 意外创建了 Session。");

  const logout = await request("/auth/logout");
  expect(logout.status === 307 && locationPath(logout) === "/login", "退出登录未返回登录页。");
  expect((logout.headers.get("set-cookie") || "").includes("requirement_platform_session="), "退出登录未清除 Session Cookie。");

  console.log("飞书认证本地回归测试通过：未登录拦截、需求深链回跳、防外部回跳、state 校验、退出登录。");
} finally {
  await stopServer();
}
