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
};

export type RequirementAssetFile = { path: string; size: number; hash: string; mimeType: string };
export type RequirementAssetManifest = { files: RequirementAssetFile[]; totalFiles: number; totalSize: number; createdAt: string };

export type RequirementComment = {
  id: string;
  requirementCode: string;
  versionId: string;
  author: string;
  initials: string;
  tone: "blue" | "green" | "violet";
  createdAt: string;
  content: string;
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

export type RequirementSummary = {
  code: string;
  title: string;
  latestVersion: number;
  createdAt?: string;
  updatedAt?: string;
  owner?: string;
  archivedAt?: string;
  archivedBy?: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt?: string;
  updatedAt: string;
  owner?: string;
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
  archivedAt?: string;
  archivedBy?: string;
};

export type DemoArtifact = {
  id: string;
  originalFileName: string;
  entryFile: string;
  checksum: string;
  createdAt: string;
};

export type RequirementStore = {
  schemaVersion: 1;
  projects: Project[];
  requirements: Requirement[];
  versions: RequirementVersion[];
  comments: RequirementComment[];
  artifacts: DemoArtifact[];
  /** Optional for backward compatibility with existing local stores. */
  gaps?: RequirementGap[];
};

export type RequirementDetail = {
  project: Project;
  requirement: Requirement;
  currentVersion: RequirementVersion;
};
