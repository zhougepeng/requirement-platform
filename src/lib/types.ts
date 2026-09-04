export type RequirementVersion = {
  id: string;
  requirementCode: string;
  number: number;
  publishedAt: string;
  publisher: string;
  changeSummary: string;
  prd: string;
  demoEntryUrl: string;
  artifactId: string;
  versionName?: string;
  sourceVersionNo?: number;
  assetManifest?: RequirementAssetManifest;
  documents?: RequirementDocument[];
};

/** Lightweight version metadata used by the requirement detail first paint. */
export type RequirementVersionSummary = Omit<RequirementVersion, "prd" | "documents" | "assetManifest"> & {
  prd: "";
  documents?: Array<Omit<RequirementDocument, "content">>;
  assetManifest?: undefined;
};

export type RequirementDocumentKind = "prd" | "demo";
export type RequirementDocument = {
  id: string;
  name: string;
  path: string;
  kind: RequirementDocumentKind;
  mimeType: string;
  order: number;
  content?: string;
  url?: string;
};

export type RequirementAssetFile = { path: string; size: number; hash: string; mimeType: string };
export type RequirementAssetManifest = { files: RequirementAssetFile[]; totalFiles: number; totalSize: number; createdAt: string };

export type PrdCommentAnchor = {
  documentId: string;
  documentPath: string;
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  blockIndex: number;
};

export type HtmlCommentAnchor = {
  documentId: string;
  documentPath: string;
  selector: string;
  quote: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RequirementComment = {
  id: string;
  requirementCode: string;
  versionId: string;
  kind?: "prd" | "html";
  commentSchema?: "prd_thread_v2" | "html_thread_v1";
  documentId?: string;
  documentPath?: string;
  anchor?: PrdCommentAnchor | HtmlCommentAnchor;
  parentId?: string;
  authorId?: string;
  author: string;
  initials: string;
  tone: "blue" | "green" | "violet";
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  content: string;
};

/** Requirement-level R&D discussion. It deliberately has no version or document anchor. */
export type RequirementDiscussion = {
  id: string;
  requirementCode: string;
  parentId?: string;
  authorId?: string;
  author: string;
  initials: string;
  tone: "blue" | "green" | "violet";
  content: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
  status?: "open" | "closed";
  resolution?: "resolved" | "rejected" | "related_requirement";
  resolutionNote?: string;
  relatedRequirementCode?: string;
  handledAt?: string;
  handledBy?: string;
};

export type RequirementGap = {
  id: string;
  requirementCode: string;
  question: string;
  source: "assistant" | "manual";
  status: "open";
  createdAt: string;
  createdBy: string;
};

export type RequirementTestStep = { step: number; action: string };
export type RequirementTestStatus = "pending" | "passed" | "failed" | "blocked";
export type RequirementTestCase = {
  id: string;
  requirementCode: string;
  versionNo: number;
  title: string;
  module: string;
  priority: "P0" | "P1" | "P2";
  type: "happy_path" | "branch" | "exception" | "boundary" | "validation" | "permission";
  prdSource: string;
  preconditions: string[];
  steps: RequirementTestStep[];
  expectedResults: string[];
  status: RequirementTestStatus;
  demoAvailable: boolean;
  demoScript: Array<{ action: string; target?: string; value?: string; expected?: string; scenario?: string }>;
  demoVersion: string;
  createdAt: string;
  updatedAt: string;
};

export type RequirementSummary = {
  code: string;
  title: string;
  latestVersion: number;
  createdAt?: string;
  updatedAt?: string;
  owner?: string;
  /** Feishu open_id for ownership checks. Legacy records may not have it. */
  ownerId?: string;
  archivedAt?: string;
  archivedBy?: string;
  status?: "offline" | "scheduled" | "online";
  scheduleVersion?: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
  releaseVersion?: string;
  releaseDate?: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt?: string;
  updatedAt: string;
  owner?: string;
  /** Feishu open_id for ownership checks. Legacy records may not have it. */
  ownerId?: string;
  archivedAt?: string;
  archivedBy?: string;
  requirements: RequirementSummary[];
};

export type Requirement = {
  id: string;
  projectId: string;
  code: string;
  title: string;
  currentVersionId: string;
  createdAt: string;
  updatedAt: string;
  owner?: string;
  /** Feishu open_id for ownership checks. Legacy records may not have it. */
  ownerId?: string;
  archivedAt?: string;
  archivedBy?: string;
  status?: "offline" | "scheduled" | "online";
  scheduleVersion?: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
  releaseVersion?: string;
  releaseDate?: string;
  /** Optional primary product used as PRD/Demo generation context. */
  productId?: string;
};

export type Product = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectProduct = {
  projectId: string;
  productId: string;
  createdAt: string;
};

export type ProductSpecComponent = {
  name: string;
  usage: string;
  avoid?: string;
  style?: Record<string, unknown>;
  states?: string[];
  interaction?: string[];
  code?: string;
  sourceRequirementCodes?: string[];
};

export type ProductSpec = {
  id: string;
  productId: string;
  version: number;
  rules: {
    terminology: string[];
    businessConstraints: string[];
    copywriting: string[];
  };
  prd: {
    template?: string;
    structure: string[];
    writingRules: string[];
  };
  tokens: {
    color?: Record<string, unknown>;
    typography?: Record<string, unknown>;
    spacing?: Record<string, unknown>;
    radius?: Record<string, unknown>;
    shadow?: Record<string, unknown>;
    border?: Record<string, unknown>;
    layout?: Record<string, unknown>;
  };
  components: ProductSpecComponent[];
  demo: {
    layoutPrinciples: string[];
    componentReuseRules: string[];
    interactionRequirements: string[];
    constraints: string[];
  };
  updatedAt: string;
  updatedBy?: string;
};

export type ProductSpecChange = {
  category: "added" | "supplemented" | "conflict";
  path: string;
  summary: string;
  existing?: unknown;
  incoming?: unknown;
};

export type ProductSpecPendingExtraction = {
  id: string;
  requirementCode: string;
  productId: string;
  changes: ProductSpecChange[];
  draftSpec: ProductSpec;
  createdAt: string;
  status: "pending_review";
};

/** A persisted business event used by the requirement board timeline. */
export type RequirementTimelineEvent = {
  id: string;
  requirementCode: string;
  projectId: string;
  requirementName: string;
  projectName: string;
  status: "scheduled" | "online";
  eventDate: string;
  version: string;
  scheduledGrayDate?: string;
  scheduledFullDate?: string;
  releaseDate?: string;
  recordedAt: string;
  source: "backfill" | "status_update";
};

export type DemoArtifact = {
  id: string;
  originalFileName: string;
  entryFile: string;
  checksum: string;
  createdAt: string;
};

export type RequirementStore = {
  schemaVersion: number;
  projects: Project[];
  requirements: Requirement[];
  versions: RequirementVersion[];
  comments: RequirementComment[];
  /** Optional for backward compatibility with stores created before requirement discussions. */
  discussions?: RequirementDiscussion[];
  artifacts: DemoArtifact[];
  /** Optional for backward compatibility with existing local stores. */
  gaps?: RequirementGap[];
  testCases?: RequirementTestCase[];
  /** Optional for backward compatibility with stores created before timeline support. */
  timelineEvents?: RequirementTimelineEvent[];
  products?: Product[];
  projectProducts?: ProjectProduct[];
  productSpecs?: ProductSpec[];
  productSpecPendingExtractions?: ProductSpecPendingExtraction[];
};

export type RequirementDetail = {
  project: Project;
  requirement: Requirement;
  currentVersion: RequirementVersion;
};

export type RequirementDetailSummary = Omit<RequirementDetail, "currentVersion"> & {
  currentVersion: RequirementVersionSummary;
};
