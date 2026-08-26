-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "User" (
  "id" TEXT NOT NULL, "feishuUserId" TEXT NOT NULL, "name" TEXT NOT NULL, "avatar" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Project" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT NOT NULL,
  "outlineCollectionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Requirement" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "code" TEXT NOT NULL, "title" TEXT NOT NULL,
  "outlineDocumentId" TEXT, "currentVersionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DemoArtifact" (
  "id" TEXT NOT NULL, "storageKey" TEXT NOT NULL, "originalName" TEXT NOT NULL, "entryFile" TEXT NOT NULL,
  "checksum" TEXT NOT NULL, "contentLength" INTEGER NOT NULL, "localDirectory" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DemoArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RequirementVersion" (
  "id" TEXT NOT NULL, "requirementId" TEXT NOT NULL, "versionNo" INTEGER NOT NULL,
  "outlineRevisionId" TEXT, "demoArtifactId" TEXT NOT NULL, "demoPath" TEXT NOT NULL, "demoEntryUrl" TEXT NOT NULL,
  "changeSummary" TEXT NOT NULL, "prdMarkdown" TEXT NOT NULL, "prdChecksum" TEXT NOT NULL,
  "demoChecksum" TEXT NOT NULL, "publisherId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequirementVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Comment" (
  "id" TEXT NOT NULL, "requirementId" TEXT NOT NULL, "versionId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "replyToId" TEXT, "content" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocument" (
  "id" TEXT NOT NULL, "projectId" TEXT, "outlineDocumentId" TEXT NOT NULL, "title" TEXT NOT NULL,
  "type" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantConversation" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "projectId" TEXT, "requirementId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_feishuUserId_key" ON "User"("feishuUserId");
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");
CREATE UNIQUE INDEX "Project_outlineCollectionId_key" ON "Project"("outlineCollectionId");
CREATE UNIQUE INDEX "Requirement_code_key" ON "Requirement"("code");
CREATE UNIQUE INDEX "Requirement_outlineDocumentId_key" ON "Requirement"("outlineDocumentId");
CREATE UNIQUE INDEX "Requirement_currentVersionId_key" ON "Requirement"("currentVersionId");
CREATE INDEX "Requirement_projectId_updatedAt_idx" ON "Requirement"("projectId", "updatedAt");
CREATE UNIQUE INDEX "DemoArtifact_storageKey_key" ON "DemoArtifact"("storageKey");
CREATE UNIQUE INDEX "RequirementVersion_requirementId_versionNo_key" ON "RequirementVersion"("requirementId", "versionNo");
CREATE INDEX "RequirementVersion_requirementId_createdAt_idx" ON "RequirementVersion"("requirementId", "createdAt");
CREATE INDEX "Comment_requirementId_versionId_createdAt_idx" ON "Comment"("requirementId", "versionId", "createdAt");
CREATE UNIQUE INDEX "KnowledgeDocument_outlineDocumentId_key" ON "KnowledgeDocument"("outlineDocumentId");

ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "RequirementVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RequirementVersion" ADD CONSTRAINT "RequirementVersion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequirementVersion" ADD CONSTRAINT "RequirementVersion_demoArtifactId_fkey" FOREIGN KEY ("demoArtifactId") REFERENCES "DemoArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequirementVersion" ADD CONSTRAINT "RequirementVersion_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RequirementVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
