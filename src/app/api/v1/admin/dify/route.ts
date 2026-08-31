import { z } from "zod";

import { apiError, apiJson } from "@/lib/api-response";
import { getDifyKnowledgeSettings, saveDifyKnowledgeConfiguration } from "@/services/assistant/dify-config";
import { DifyKnowledgeClient } from "@/services/assistant/dify-knowledge-client";
import { listKnowledgeSyncEntries, syncExistingKnowledge } from "@/services/assistant/knowledge-sync-service";
import { listMaterialKnowledgeSyncEntries, syncAllMaterialKnowledge } from "@/services/materials/material-knowledge-sync-service";
import { adminFromRequest } from "@/services/auth/request-actor";
import { listRequirementKnowledgeExtractionFailures, retryRequirementKnowledgeExtraction } from "@/services/materials/requirement-knowledge-extraction-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configurationSchema = z.object({
  baseUrl: z.string().trim().min(1).max(500),
  datasetId: z.string().trim().min(1).max(240),
  apiKey: z.string().trim().min(1).max(4000),
});
const actionSchema = z.object({ action: z.enum(["verify", "sync", "retry-extraction"]), requirementCode: z.string().trim().optional() });

async function settingsPayload() {
  const [entries, materialEntries, extractionFailures] = await Promise.all([listKnowledgeSyncEntries(), listMaterialKnowledgeSyncEntries(), listRequirementKnowledgeExtractionFailures()]);
  const failed = [...entries, ...materialEntries].filter((entry) => entry.lastError);
  return {
    ...getDifyKnowledgeSettings(),
    sync: { totalDocuments: entries.length + materialEntries.length, failedDocuments: failed.length, lastError: failed[0]?.lastError },
    extractionFailures,
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
    const { action, requirementCode } = actionSchema.parse(await request.json());
    if (action === "verify") {
      const result = await new DifyKnowledgeClient().verifyConnection();
      return apiJson({ ...(await settingsPayload()), verification: result });
    }
    if (action === "retry-extraction") {
      if (!requirementCode) throw new Error("请选择需要重试的需求。");
      await retryRequirementKnowledgeExtraction(requirementCode);
      return apiJson(await settingsPayload());
    }
    const [requirements, materials] = await Promise.all([syncExistingKnowledge(), syncAllMaterialKnowledge()]);
    return apiJson({ ...(await settingsPayload()), syncResult: { requirements, materials } });
  } catch (error) {
    return apiError(error);
  }
}
