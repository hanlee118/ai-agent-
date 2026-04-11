-- Mixed strategy project mode: complete | standalone | relay

ALTER TABLE "Project" ADD COLUMN "projectType" TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE "Project" ADD COLUMN "parentProjectId" TEXT;
ALTER TABLE "Project" ADD COLUMN "relaySourceStageId" TEXT;

CREATE INDEX IF NOT EXISTS "Project_projectType_createdAt_idx" ON "Project"("projectType", "createdAt");
CREATE INDEX IF NOT EXISTS "Project_parentProjectId_idx" ON "Project"("parentProjectId");

ALTER TABLE "WorkflowTemplate" ADD COLUMN "isStandalone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkflowTemplate" ADD COLUMN "standaloneCategory" TEXT;
ALTER TABLE "WorkflowTemplate" ADD COLUMN "inputContract" JSONB;
ALTER TABLE "WorkflowTemplate" ADD COLUMN "outputContract" JSONB;

CREATE TABLE IF NOT EXISTS "ProjectInput" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT,
    "filePath" TEXT,
    "referenceDeliverableId" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'pending',
    "validationErrors" JSONB,
    "inputSource" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectInput_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectInput_referenceDeliverableId_fkey" FOREIGN KEY ("referenceDeliverableId") REFERENCES "Deliverable" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "StageRelayRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceProjectId" TEXT NOT NULL,
    "sourceStageId" TEXT,
    "sourceDeliverableIds" JSONB NOT NULL,
    "targetProjectId" TEXT NOT NULL,
    "targetInputId" TEXT,
    "relayType" TEXT NOT NULL DEFAULT 'full',
    "transformationConfig" JSONB,
    "syncStatus" TEXT NOT NULL DEFAULT 'active',
    "lastSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StageRelayRelation_sourceProjectId_fkey" FOREIGN KEY ("sourceProjectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StageRelayRelation_sourceStageId_fkey" FOREIGN KEY ("sourceStageId") REFERENCES "Stage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StageRelayRelation_targetProjectId_fkey" FOREIGN KEY ("targetProjectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StageRelayRelation_targetInputId_fkey" FOREIGN KEY ("targetInputId") REFERENCES "ProjectInput" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProjectInput_projectId_createdAt_idx" ON "ProjectInput"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectInput_referenceDeliverableId_idx" ON "ProjectInput"("referenceDeliverableId");

CREATE UNIQUE INDEX IF NOT EXISTS "StageRelayRelation_sourceProjectId_sourceStageId_targetProjectId_key"
  ON "StageRelayRelation"("sourceProjectId", "sourceStageId", "targetProjectId");
CREATE INDEX IF NOT EXISTS "StageRelayRelation_sourceProjectId_sourceStageId_createdAt_idx"
  ON "StageRelayRelation"("sourceProjectId", "sourceStageId", "createdAt");
CREATE INDEX IF NOT EXISTS "StageRelayRelation_targetProjectId_createdAt_idx"
  ON "StageRelayRelation"("targetProjectId", "createdAt");
