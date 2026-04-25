-- AlterTable
ALTER TABLE "Task" ADD COLUMN "ownerAgentId" TEXT;
ALTER TABLE "Task" ADD COLUMN "reviewAgentId" TEXT;
ALTER TABLE "Task" ADD COLUMN "coordinationMode" TEXT NOT NULL DEFAULT 'single_owner';
ALTER TABLE "Task" ADD COLUMN "delegationPolicy" TEXT NOT NULL DEFAULT 'manual_only';
ALTER TABLE "Task" ADD COLUMN "syncPolicy" TEXT NOT NULL DEFAULT 'db_plus_gitlab';
ALTER TABLE "Task" ADD COLUMN "contextScope" TEXT;
ALTER TABLE "Task" ADD COLUMN "parentTaskId" TEXT;
ALTER TABLE "Task" ADD COLUMN "pendingDelegationCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "lastDelegatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TaskParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskParticipant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskParticipant_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskDependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TaskDelegation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "parentExecutionId" TEXT,
    "requestedByAgentId" TEXT NOT NULL,
    "targetAgentId" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "inputContextRef" TEXT,
    "inputSummary" TEXT,
    "resultSchema" TEXT,
    "outputSummary" TEXT,
    "outputPayloadJson" JSONB,
    "outputArtifactsJson" JSONB,
    "budgetTokens" INTEGER,
    "timeoutSec" INTEGER,
    "spawnDepth" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaskDelegation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDelegation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GitLabSyncBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "stageId" TEXT,
    "taskId" TEXT,
    "gitlabProjectId" TEXT NOT NULL,
    "issueId" TEXT,
    "issueIid" INTEGER,
    "bindingType" TEXT NOT NULL,
    "syncPolicy" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GitLabSyncBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GitLabSyncBinding_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Cleanup incompatible legacy unique index
DROP INDEX IF EXISTS "GitLabSyncBinding_projectId_bindingType_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_projectId_stageType_idx" ON "Task"("projectId", "stageType");
CREATE INDEX IF NOT EXISTS "Task_assignee_status_idx" ON "Task"("assignee", "status");
CREATE INDEX IF NOT EXISTS "Task_ownerAgentId_status_idx" ON "Task"("ownerAgentId", "status");
CREATE INDEX IF NOT EXISTS "Task_reviewAgentId_status_idx" ON "Task"("reviewAgentId", "status");
CREATE INDEX IF NOT EXISTS "Task_parentTaskId_idx" ON "Task"("parentTaskId");

CREATE UNIQUE INDEX IF NOT EXISTS "TaskParticipant_taskId_agentId_role_key" ON "TaskParticipant"("taskId", "agentId", "role");
CREATE INDEX IF NOT EXISTS "TaskParticipant_projectId_taskId_idx" ON "TaskParticipant"("projectId", "taskId");
CREATE INDEX IF NOT EXISTS "TaskParticipant_agentId_role_idx" ON "TaskParticipant"("agentId", "role");

CREATE UNIQUE INDEX IF NOT EXISTS "TaskDependency_taskId_dependsOnTaskId_type_key" ON "TaskDependency"("taskId", "dependsOnTaskId", "type");
CREATE INDEX IF NOT EXISTS "TaskDependency_projectId_type_idx" ON "TaskDependency"("projectId", "type");
CREATE INDEX IF NOT EXISTS "TaskDependency_dependsOnTaskId_type_idx" ON "TaskDependency"("dependsOnTaskId", "type");

CREATE INDEX IF NOT EXISTS "TaskDelegation_projectId_status_createdAt_idx" ON "TaskDelegation"("projectId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TaskDelegation_taskId_status_createdAt_idx" ON "TaskDelegation"("taskId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TaskDelegation_requestedByAgentId_createdAt_idx" ON "TaskDelegation"("requestedByAgentId", "createdAt");

CREATE INDEX IF NOT EXISTS "GitLabSyncBinding_projectId_bindingType_idx" ON "GitLabSyncBinding"("projectId", "bindingType");
CREATE INDEX IF NOT EXISTS "GitLabSyncBinding_taskId_bindingType_idx" ON "GitLabSyncBinding"("taskId", "bindingType");
CREATE INDEX IF NOT EXISTS "GitLabSyncBinding_gitlabProjectId_bindingType_idx" ON "GitLabSyncBinding"("gitlabProjectId", "bindingType");
CREATE UNIQUE INDEX IF NOT EXISTS "GitLabSyncBinding_taskId_bindingType_key" ON "GitLabSyncBinding"("taskId", "bindingType");
CREATE UNIQUE INDEX IF NOT EXISTS "GitLabSyncBinding_gitlabProjectId_issueIid_bindingType_key" ON "GitLabSyncBinding"("gitlabProjectId", "issueIid", "bindingType");
