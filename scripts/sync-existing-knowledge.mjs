import nextEnv from "@next/env";
import { syncExistingKnowledge } from "../src/services/assistant/knowledge-sync-service.ts";

async function main() {
  nextEnv.loadEnvConfig(process.cwd(), false);
  const result = await syncExistingKnowledge();
  console.log(`知识同步完成：共 ${result.total} 个需求，成功 ${result.synced} 个，失败 ${result.failed.length} 个。`);
  for (const failed of result.failed) console.error(`${failed.requirementCode}：${failed.error}`);
  if (result.failed.length) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
