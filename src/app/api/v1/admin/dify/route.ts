import { z } from "zod";

import { apiError, apiJson } from "@/lib/api-response";
import { getDifyKnowledgeSettings, saveDifyKnowledgeConfiguration } from "@/services/assistant/dify-config";
import { DifyKnowledgeClient } from "@/services/assistant/dify-knowledge-client";
import { listKnowledgeSyncEntries, syncExistingKnowledge } from "@/services/assistant/knowledge-sync-service";
import { adminFromRequest } from "@/services/auth/request-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configurationSchema = z.object({
  baseUrl: z.string().trim().min(1).max(500),
  datasetId: z.string().trim().min(1).max(240),
  apiKey: z.string().trim().min(1).max(4000),
});
const actionSchema = z.object({ action: z.enum(["verify", "sync"]) });

async function settingsPayload() {
  const entries = await listKnowledgeSyncEntries();
  const failed = entries.filter((entry) => entry.lastError);
  return {
    ...getDifyKnowledgeSettings(),
    sync: { totalDocuments: entries.length, failedDocuments: failed.length, lastError: failed[0]?.lastError },
  };
}

export async function GET(request: Request) {
  try {
    await adminFromRequest(request);
    return apiJson(await settingsPayload());
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await adminFromRequest(request);
    saveDifyKnowledgeConfiguration(configurationSchema.parse(await request.json()));
    return apiJson(await settingsPayload());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await adminFromRequest(request);
    const { action } = actionSchema.parse(await request.json());
    if (action === "verify") {
      const result = await new DifyKnowledgeClient().verifyConnection();
      return apiJson({ ...(await settingsPayload()), verification: result });
    }
    const result = await syncExistingKnowledge();
    return apiJson({ ...(await settingsPayload()), syncResult: result });
  } catch (error) {
    return apiError(error);
  }
}
