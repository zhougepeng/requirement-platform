import "server-only";

import { extractProductSpecWithModel } from "@/services/assistant/product-spec-generator";
import { getRequirementDetail, mergeProductSpec, savePendingProductSpecExtraction } from "@/services/requirement/repository";

let queue = Promise.resolve();

/**
 * 上线后的产品规范提取是后台任务，不能阻塞状态更新。
 * 没有主产品时跳过；有冲突时保留待确认结果，正常新增/补充直接合并。
 */
export function scheduleRequirementProductSpecExtraction(requirementCode: string, actor?: { id: string; name: string }) {
  queue = queue.then(async () => {
    try {
      const detail = await getRequirementDetail(requirementCode);
      const productId = detail.requirement.productId;
      if (!productId) return;
      const extraction = await extractProductSpecWithModel(requirementCode, productId);
      if (extraction.summary.total === 0) return;
      if (extraction.summary.conflicts > 0) {
        await savePendingProductSpecExtraction({
          requirementCode,
          productId,
          changes: extraction.changes,
          draftSpec: extraction.draftSpec,
        });
        return;
      }
      await mergeProductSpec(productId, extraction.draftSpec, actor);
    } catch {
      // 自动提取失败不影响上线；下次手动提取仍可重试。
    }
  }).catch(() => undefined);
}
