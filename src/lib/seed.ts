import type { DemoArtifact, Project, Requirement, RequirementComment, RequirementStore, RequirementVersion } from "@/lib/types";

export const projects: Project[] = [
  {
    id: "erp",
    name: "ERP",
    description: "汽配旺旺 ERP 的采购、销售、仓库等产品需求。",
    createdAt: "2026-08-23",
    updatedAt: "2026-08-24",
    owner: "张三",
    requirements: [
      { code: "ERP-001", title: "图片转采购单", latestVersion: 3, createdAt: "2026-08-23 17:10", updatedAt: "2026-08-24 14:49", owner: "张三" },
      { code: "ERP-002", title: "采购开单", latestVersion: 2 },
      { code: "ERP-003", title: "订货计划开单", latestVersion: 1 },
    ],
  },
];

const prdV2 = `# 图片转采购单

## 一、背景

采购人员需要把聊天截图、报价单等图片中的配件明细录入采购单。手工逐行录入慢，且容易遗漏数量、价格和车型信息。

## 二、目标

在 ERP 的采购开单页提供图片输入和识别入口，将识别结果交给用户确认后导入采购单，不直接替代人工判断。

## 三、流程与范围

1. 在采购开单或订货计划开单中进入“外部导入”。
2. 用户选择、拖拽或粘贴 JPG/PNG 图片。
3. 系统识别配件编码、数量、成本单价、销售单价和基础配件信息。
4. 用户检查识别结果，确认后才写入采购单明细。

| 能力 | 本期处理 | 说明 |
| --- | --- | --- |
| 图片输入 | 支持 | 选择、拖拽和粘贴 JPG/PNG |
| 明细识别 | 支持 | 展示识别出的采购明细 |
| 采购单写入 | 支持 | 仅在用户点击确认后写入 |
| 失败处理 | 提示 | 未识别明细时提示更换清晰图片 |`;

const prdV3 = `# 图片转采购单

## 一、背景

采购人员需要把聊天截图、报价单等图片中的配件明细录入采购单。手工逐行录入慢，且容易遗漏数量、价格和车型信息。

## 二、目标

在 ERP 的采购开单页提供图片输入和识别入口，将识别结果交给用户确认后导入采购单。识别失败不能自动重试或自动写入。

## 三、流程与范围

1. 在采购开单或订货计划开单中进入“外部导入”。
2. 用户选择、拖拽或粘贴 JPG/PNG 图片。
3. 系统展示识别结果、未匹配明细和导入状态。
4. 对表格类图片识别失败时，用户可以手工选择对应导入列。
5. 用户确认后才将成功明细写入采购单；失败项保留提示，不写入单据。

| 能力 | 本期处理 | 说明 |
| --- | --- | --- |
| 图片输入 | 支持 | 选择、拖拽和粘贴 JPG/PNG |
| 明细识别 | 支持 | 展示配件编码、数量、单价及基础资料 |
| 异常标记 | 支持 | 无法匹配的明细在列表中明确标红 |
| 手工列映射 | 支持 | 表格图片可选择目标列与文件列对应关系 |
| 采购单写入 | 支持 | 仅在用户确认后写入成功明细 |
| 自动重试 | 不支持 | 识别失败由用户更换图片或手工映射 |

## 四、边界与验收

- 图片仅支持 JPG、PNG。
- 识别结果必须经过用户确认，不能直接生成已确认采购单。
- 未匹配或识别失败的内容不能静默丢失；页面须给出明确原因和下一步操作。`;

export const initialVersions: RequirementVersion[] = [
  {
    id: "v3",
    requirementCode: "ERP-001",
    number: 3,
    publishedAt: "2026-08-24 14:49",
    publisher: "张三",
    changeSummary: "补充识别失败状态、手工列映射和成功明细确认导入规则。",
    prd: prdV3,
    demoEntryUrl: "/demo-assets/erp/ERP-001/v3/index.html",
    artifactId: "artifact_erp_image_to_purchase",
  },
  {
    id: "v2",
    requirementCode: "ERP-001",
    number: 2,
    publishedAt: "2026-08-24 11:30",
    publisher: "李四",
    changeSummary: "补充图片输入、识别结果和采购单确认导入流程。",
    prd: prdV2,
    demoEntryUrl: "/demo-assets/erp/ERP-001/v2/index.html",
    artifactId: "artifact_erp_image_to_purchase",
  },
  {
    id: "v1",
    requirementCode: "ERP-001",
    number: 1,
    publishedAt: "2026-08-23 17:10",
    publisher: "张三",
    changeSummary: "首次发布图片转采购单方案。",
    prd: `${prdV2}\n\n> 首版仅定义图片输入和识别结果展示。`,
    demoEntryUrl: "/demo-assets/erp/ERP-001/v1/index.html",
    artifactId: "artifact_erp_image_to_purchase",
  },
];

export const initialComments: RequirementComment[] = [
  {
    id: "comment-1",
    requirementCode: "ERP-001",
    versionId: "v3",
    author: "李四",
    initials: "李",
    tone: "blue",
    createdAt: "08-24 14:52",
    content: "识别失败后保留手工列映射，避免用户只能重新上传。",
  },
  {
    id: "comment-2",
    requirementCode: "ERP-001",
    versionId: "v3",
    author: "王五",
    initials: "王",
    tone: "green",
    createdAt: "08-24 14:56",
    content: "确认导入时只写入成功明细，失败项必须保留明确提示。",
  },
  {
    id: "comment-3",
    requirementCode: "ERP-001",
    versionId: "v2",
    author: "张三",
    initials: "张",
    tone: "violet",
    createdAt: "08-24 11:42",
    content: "V2 作为基础识别流程的对照版本保留。",
  },
];

const initialRequirements: Requirement[] = [
  {
    id: "ERP-001",
    projectId: "erp",
    code: "ERP-001",
    title: "图片转采购单",
    currentVersionId: "v3",
    createdAt: "2026-08-23 17:10",
    updatedAt: "2026-08-24 14:49",
    owner: "张三",
  },
];

const initialArtifacts: DemoArtifact[] = [
  {
    id: "artifact_erp_image_to_purchase",
    originalFileName: "erp-image-to-purchase.html",
    entryFile: "index.html",
    checksum: "seed-local-artifact",
    createdAt: "2026-08-24 14:49",
  },
];

export function createInitialStore(): RequirementStore {
  return {
    schemaVersion: 1,
    projects: structuredClone(projects),
    requirements: structuredClone(initialRequirements),
    versions: structuredClone(initialVersions),
    comments: structuredClone(initialComments),
    artifacts: structuredClone(initialArtifacts),
  };
}
