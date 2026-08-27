import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import AdmZip from "adm-zip";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3313;
const baseUrl = `http://127.0.0.1:${port}`;
const sessionSecret = randomBytes(32).toString("base64url");
const dataDir = await mkdtemp(path.join(tmpdir(), "requirement-platform-permissions-"));
const integrationToken = randomBytes(32).toString("base64url");

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sessionCookie(openId, name) {
  const payload = Buffer.from(JSON.stringify({ openId, name, expiresAt: Date.now() + 60_000 })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return `requirement_platform_session=${payload}.${signature}`;
}

async function request(pathname, openId, options = {}) {
  const headers = new Headers(options.headers);
  if (openId) headers.set("Cookie", sessionCookie(openId, openId));
  return fetch(`${baseUrl}${pathname}`, {
    redirect: "manual",
    ...options,
    headers,
  });
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/login`);
      if (response.status === 200) return;
    } catch {
      // 服务进程仍在启动，继续等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("权限测试服务未能在 10 秒内启动。");
}

const timestamp = "2026-08-27 12:00";
const employee = (openId, role) => ({
  id: `employee_${openId}`,
  openId,
  name: openId,
  departmentNames: [],
  role,
  enabled: role !== "none",
  isAdmin: role === "admin",
  directoryActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});

await writeFile(path.join(dataDir, "employees.local.json"), JSON.stringify({
  schemaVersion: 1,
  employees: [employee("viewer", "viewer"), employee("publisher", "publisher"), employee("admin", "admin")],
}), "utf8");

const server = spawn(process.execPath, ["server.js"], {
  cwd: path.join(projectRoot, ".next", "standalone"),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    AUTH_MODE: "feishu",
    AUTH_COOKIE_SECURE: "false",
    APP_BASE_URL: baseUrl,
    AUTH_SESSION_SECRET: sessionSecret,
    WORKBENCH_INTEGRATION_TOKEN: integrationToken,
    REQUIREMENT_PLATFORM_DATA_DIR: dataDir,
    REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR: path.join(dataDir, "published-demos"),
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

  expect((await request("/api/v1/projects", "viewer")).status === 200, "查看角色无法读取项目列表。");
  const assistantResponse = await request("/api/v1/assistant", "viewer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "all-published", question: "测试" }) });
  expect(assistantResponse.status !== 401 && assistantResponse.status !== 403, `查看角色被错误拒绝使用 AI 助手（HTTP ${assistantResponse.status}）。`);
  expect((await request("/api/v1/projects", "viewer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "VIEWER", name: "禁止创建", description: "" }) })).status === 403, "查看角色错误获得发布权限。");

  expect((await request("/api/v1/projects", "publisher", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "PUB", name: "发布测试项目", description: "" }) })).status === 201, "发布角色无法创建项目。");
  expect((await request("/api/v1/admin/employees", "publisher")).status === 403, "发布角色错误获得管理员权限。");

  expect((await request("/api/v1/admin/employees", "admin")).status === 200, "管理角色无法读取员工权限。");
  expect((await request("/api/v1/models", "admin")).status === 200, "管理角色无法读取模型管理。");

  const tokenHeaders = { Authorization: `Bearer ${integrationToken}` };
  const tokenProjects = await request("/api/v1/projects", undefined, { headers: tokenHeaders });
  expect(tokenProjects.status === 200, `工作搭子令牌无法读取项目列表（HTTP ${tokenProjects.status}）。`);

  const createdProject = await request("/api/v1/projects", undefined, {
    method: "POST",
    headers: { ...tokenHeaders, "content-type": "application/json" },
    body: JSON.stringify({ code: "WBK", name: "工作搭子联调项目", description: "服务间令牌回归测试" }),
  });
  expect(createdProject.status === 201, `工作搭子令牌无法创建项目（HTTP ${createdProject.status}）。`);

  const archive = new AdmZip();
  archive.addFile("index.html", Buffer.from("<!doctype html><title>workbench integration</title>", "utf8"));
  const form = new FormData();
  form.append("file", new Blob([archive.toBuffer()], { type: "application/zip" }), "demo.zip");
  const uploadedArtifact = await request("/api/v1/artifacts", undefined, {
    method: "POST",
    headers: tokenHeaders,
    body: form,
  });
  expect(uploadedArtifact.status === 201, `工作搭子令牌无法上传 Demo 工件（HTTP ${uploadedArtifact.status}）。`);
  const artifactPayload = await uploadedArtifact.json();
  const artifactId = artifactPayload.data?.id;
  expect(typeof artifactId === "string" && artifactId.length > 0, "Demo 工件响应缺少 id。");

  const published = await request("/api/v1/requirements/publish", undefined, {
    method: "POST",
    headers: { ...tokenHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      project_code: "WBK",
      title: "订单取消规则",
      prd_markdown: "# 订单取消\n\n订单已发货后不能直接取消，需要申请退货。",
      artifact_id: artifactId,
      change_summary: "服务间令牌回归测试。",
    }),
  });
  expect(published.status === 201, `工作搭子令牌无法发布需求（HTTP ${published.status}）。`);
  const publishedPayload = await published.json();
  const requirementCode = publishedPayload.data?.requirement?.code;
  expect(typeof requirementCode === "string" && requirementCode.length > 0, "发布需求响应缺少需求编号。");

  const undefinedAnswer = await request("/api/v1/assistant", "viewer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "current-requirement", requirement_code: requirementCode, version_no: 1, question: "退款多久到账？" }),
  });
  expect(undefinedAnswer.status === 200, `未定义问题请求失败（HTTP ${undefinedAnswer.status}）。`);
  const undefinedPayload = await undefinedAnswer.json();
  expect(undefinedPayload.data?.status === "undefined", "PRD 未定义问题被错误回答为已定义。" );

  const createdGap = await request(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/gaps`, "viewer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "退款多久到账？" }),
  });
  expect(createdGap.status === 201, `查看角色无法添加待补充项（HTTP ${createdGap.status}）。`);
  const gaps = await request(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/gaps`, "viewer");
  expect(gaps.status === 200 && (await gaps.json()).data?.length === 1, "待补充项未正确保存或读取。" );

  const conflictingRequirement = await request("/api/v1/requirements/publish", undefined, {
    method: "POST",
    headers: { ...tokenHeaders, "content-type": "application/json" },
    body: JSON.stringify({ project_code: "WBK", title: "订单取消例外", prd_markdown: "# 订单取消\n\n订单已发货后可以直接取消。", artifact_id: artifactId, change_summary: "冲突检测回归测试。" }),
  });
  expect(conflictingRequirement.status === 201, `无法创建冲突检测需求（HTTP ${conflictingRequirement.status}）。`);
  const conflictAnswer = await request("/api/v1/assistant", "viewer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "current-project", project_id: "WBK", question: "订单已发货后取消订单怎么办？" }),
  });
  expect(conflictAnswer.status === 200 && (await conflictAnswer.json()).data?.status === "conflict", "已发布 PRD 的相反规则未被识别为冲突。" );

  expect((await request("/api/v1/admin/employees", undefined, { headers: tokenHeaders })).status === 403, "工作搭子令牌错误获得员工管理权限。");
  expect((await request("/api/v1/models", undefined, { headers: tokenHeaders })).status === 403, "工作搭子令牌错误获得模型管理权限。");
  const invalidToken = await request("/api/v1/projects", undefined, { headers: { Authorization: "Bearer invalid-workbench-token" } });
  expect(invalidToken.status === 401 || invalidToken.status === 403, `错误工作搭子令牌未被拒绝（HTTP ${invalidToken.status}）。`);

  console.log("权限回归测试通过：查看可读和使用 AI、PRD 未定义不编造且可记录待补充项、已发布 PRD 冲突可识别；发布可创建项目并发布 Demo+PRD、管理可进入管理员接口；服务间令牌越权和错误令牌均被拒绝。");
} finally {
  await stopServer();
  await rm(dataDir, { recursive: true, force: true });
}
