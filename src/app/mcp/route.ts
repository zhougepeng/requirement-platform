import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { getProject, getRequirementDetail, getVersion, listProjectRequirements, listProjects, listVersions, publishRequirement, searchRequirements } from "@/services/requirement/repository";
import { scheduleRequirementKnowledgeSync } from "@/services/assistant/knowledge-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function tokenMatches(request: Request) {
  const configured = process.env.MCP_API_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const received = Buffer.from(supplied);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function createServer() {
  const server = new McpServer({ name: "requirement-platform", version: "0.1.0" });
  server.registerTool("list_projects", { description: "列出可访问项目" }, async () => text(await listProjects()));
  server.registerTool("get_project", { description: "读取项目详情", inputSchema: { project_code: z.string().min(2) } }, async ({ project_code }) => text(await getProject(project_code)));
  server.registerTool("list_requirements", { description: "列出项目需求", inputSchema: { project_code: z.string().min(2) } }, async ({ project_code }) => text(await listProjectRequirements(project_code)));
  server.registerTool("get_requirement", { description: "读取需求及当前版本", inputSchema: { requirement_code: z.string().min(2) } }, async ({ requirement_code }) => text(await getRequirementDetail(requirement_code)));
  server.registerTool("list_versions", { description: "列出需求业务版本", inputSchema: { requirement_code: z.string().min(2) } }, async ({ requirement_code }) => text(await listVersions(requirement_code)));
  server.registerTool("get_requirement_version", { description: "读取指定业务版本", inputSchema: { requirement_code: z.string().min(2), version: z.number().int().positive() } }, async ({ requirement_code, version }) => text(await getVersion(requirement_code, version)));
  server.registerTool("search_requirements", { description: "按当前版本的标题或 PRD 搜索需求", inputSchema: { query: z.string().min(1).max(200) } }, async ({ query }) => text(await searchRequirements(query)));
  server.registerTool("publish_requirement", { description: "使用已上传的 Demo 工件发布新需求版本，旧版本不会被覆盖", inputSchema: {
    project_code: z.string().min(2),
    requirement_code: z.string().min(2),
    title: z.string().min(1).max(200),
    prd_markdown: z.string().min(1).max(100_000),
    demo_artifact_id: z.string().min(1),
    change_summary: z.string().min(1).max(1000),
  } }, async ({ project_code, requirement_code, title, prd_markdown, demo_artifact_id, change_summary }) => {
    const published = await publishRequirement({
      projectCode: project_code,
      requirementCode: requirement_code,
      title,
      prdMarkdown: prd_markdown,
      artifactId: demo_artifact_id,
      changeSummary: change_summary,
      actor: { id: "mcp-service", name: "Requirement MCP" },
    });
    scheduleRequirementKnowledgeSync(published.requirement.code);
    return text(published);
  });
  return server;
}

async function handle(request: Request) {
  if (!tokenMatches(request)) return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createServer();
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function DELETE(request: Request) {
  return handle(request);
}
