import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import AdmZip from "adm-zip";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3313;
const baseUrl = `http://127.0.0.1:${port}`;
const sessionSecret = randomBytes(32).toString("base64url");
const dataDir = await mkdtemp(path.join(tmpdir(), "requirement-platform-permissions-"));

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
  const assistantResponse = await request("/api/v1/assistant", "viewer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "all-published", question: "你好" }) });
  expect(assistantResponse.status === 200, `查看角色无法使用 AI 助手入口（HTTP ${assistantResponse.status}）。`);
  expect((await request("/api/v1/projects", "viewer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "VIEWER", name: "禁止创建", description: "" }) })).status === 403, "查看角色错误获得发布权限。");

  expect((await request("/api/v1/projects", "publisher", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "PUB", name: "发布测试项目", description: "" }) })).status === 201, "发布角色无法创建项目。");
  expect((await request("/api/v1/admin/employees", "publisher")).status === 403, "发布角色错误获得管理员权限。");

  expect((await request("/api/v1/admin/employees", "admin")).status === 200, "管理角色无法读取员工权限。");
  expect((await request("/api/v1/models", "admin")).status === 200, "管理角色无法读取模型管理。");

  expect((await request("/api/v1/auth/access-tokens", "viewer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "viewer-token" }) })).status === 403, "查看角色错误生成个人访问令牌。");
  const issuedToken = await request("/api/v1/auth/access-tokens", "publisher", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "权限回归测试" }) });
  expect(issuedToken.status === 201, `发布角色无法生成个人访问令牌（HTTP ${issuedToken.status}）。`);
  const issuedPayload = await issuedToken.json();
  const accessToken = issuedPayload.data?.token;
  expect(typeof accessToken === "string" && accessToken.startsWith("rpt_"), "个人访问令牌响应缺少有效令牌。");
  const tokenHeaders = { Authorization: `Bearer ${accessToken}` };
  const tokenProjects = await request("/api/v1/projects", undefined, { headers: tokenHeaders });
  expect(tokenProjects.status === 200, `个人访问令牌无法读取项目列表（HTTP ${tokenProjects.status}）。`);

  const createdProject = await request("/api/v1/projects", undefined, {
    method: "POST",
    headers: { ...tokenHeaders, "content-type": "application/json" },
    body: JSON.stringify({ code: "WBK", name: "工作搭子联调项目", description: "服务间令牌回归测试" }),
  });
  expect(createdProject.status === 201, `个人访问令牌无法创建项目（HTTP ${createdProject.status}）。`);

  const archive = new AdmZip();
  archive.addFile("index.html", Buffer.from("<!doctype html><title>workbench integration</title>", "utf8"));
  const form = new FormData();
  form.append("file", new Blob([archive.toBuffer()], { type: "application/zip" }), "demo.zip");
  const uploadedArtifact = await request("/api/v1/artifacts", undefined, {
    method: "POST",
    headers: tokenHeaders,
    body: form,
  });
  expect(uploadedArtifact.status === 201, `个人访问令牌无法上传 Demo 工件（HTTP ${uploadedArtifact.status}）。`);
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
  expect(published.status === 201, `个人访问令牌无法发布需求（HTTP ${published.status}）。`);
  const publishedPayload = await published.json();
  const requirementCode = publishedPayload.data?.requirement?.code;
  expect(typeof requirementCode === "string" && requirementCode.length > 0, "发布需求响应缺少需求编号。");
  expect(publishedPayload.data?.requirement?.owner === "publisher", "个人访问令牌发布需求未归属到真实发布人。");

  const snapshotArchive = new AdmZip();
  snapshotArchive.addFile("PRD.md", Buffer.from("# 主 PRD\n\n兼容旧发布端。", "utf8"));
  snapshotArchive.addFile("prd/01-下单.md", Buffer.from("# 下单\n\n支持提交订单。", "utf8"));
  snapshotArchive.addFile("prd/02-支付.md", Buffer.from("# 支付\n\n支持支付确认。", "utf8"));
  snapshotArchive.addFile("demo/index.html", Buffer.from("<!doctype html><title>snapshot demo</title>", "utf8"));
  const snapshotForm = new FormData();
  snapshotForm.append("archive", new Blob([snapshotArchive.toBuffer()], { type: "application/zip" }), "multi-prd.zip");
  snapshotForm.append("change_summary", "多 PRD 快照回归测试。");
  const snapshotPublished = await request(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/versions`, undefined, {
    method: "POST",
    headers: tokenHeaders,
    body: snapshotForm,
  });
  expect(snapshotPublished.status === 201, `多 PRD 快照无法发布（HTTP ${snapshotPublished.status}）。`);
  const snapshotPayload = await snapshotPublished.json();
  const snapshotPrds = (snapshotPayload.data?.version?.documents || []).filter((item) => item.kind === "prd");
  expect(snapshotPrds.length === 2, `多 PRD 快照应展示 2 个目录项，实际为 ${snapshotPrds.length}。`);
  expect(snapshotPrds.map((item) => item.path).join("|") === "prd/01-下单.md|prd/02-支付.md", "多 PRD 快照目录项或顺序不正确。");

  const createdGap = await request(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/gaps`, "viewer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "退款多久到账？" }),
  });
  expect(createdGap.status === 201, `查看角色无法添加待补充项（HTTP ${createdGap.status}）。`);
  const gaps = await request(`/api/v1/requirements/${encodeURIComponent(requirementCode)}/gaps`, "viewer");
  expect(gaps.status === 200 && (await gaps.json()).data?.length === 1, "待补充项未正确保存或读取。" );

  expect((await request("/api/v1/admin/employees", undefined, { headers: tokenHeaders })).status === 403, "个人访问令牌错误获得员工管理权限。");
  expect((await request("/api/v1/models", undefined, { headers: tokenHeaders })).status === 403, "个人访问令牌错误获得模型管理权限。");
  expect((await request("/api/v1/admin/employees", "admin", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ open_id: "publisher", role: "none" }) })).status === 200, "管理员无法取消发布权限。");
  expect((await request("/api/v1/projects", undefined, { headers: tokenHeaders })).status === 403, "取消发布权限后个人访问令牌仍可使用。");
  expect((await request("/api/v1/admin/employees", "admin", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ open_id: "publisher", role: "publisher" }) })).status === 200, "管理员无法恢复发布权限。");
  expect((await request("/api/v1/projects", undefined, { headers: tokenHeaders })).status === 200, "恢复发布权限后个人访问令牌未恢复使用。");
  const employeeFile = path.join(dataDir, "employees.local.json");
  const employeeStore = JSON.parse(await readFile(employeeFile, "utf8"));
  employeeStore.employees.find((item) => item.openId === "publisher").directoryActive = false;
  await writeFile(employeeFile, JSON.stringify(employeeStore), "utf8");
  expect((await request("/api/v1/projects", undefined, { headers: tokenHeaders })).status === 403, "员工离职后个人访问令牌仍可使用。");
  const invalidToken = await request("/api/v1/projects", undefined, { headers: { Authorization: "Bearer invalid-workbench-token" } });
  expect(invalidToken.status === 401 || invalidToken.status === 403, `错误个人访问令牌未被拒绝（HTTP ${invalidToken.status}）。`);

  console.log("权限回归测试通过：查看、发布和管理权限均按角色生效；个人访问令牌仅代表真实发布人创建需求，不能访问管理接口，撤销发布权限后立即失效。");
} finally {
  await stopServer();
  await rm(dataDir, { recursive: true, force: true });
}
