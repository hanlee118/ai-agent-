-- CreateTable
CREATE TABLE IF NOT EXISTS "KnowledgeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "projectId" TEXT,
    "agentId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentVector" JSONB,
    "metadata" JSONB NOT NULL,
    "tags" JSONB NOT NULL,
    "stageContext" JSONB NOT NULL,
    "techStack" JSONB NOT NULL,
    "memoryType" TEXT,
    "importanceScore" REAL,
    "sourceUrl" TEXT,
    "filePath" TEXT,
    "fileType" TEXT,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "KnowledgeRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "strength" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeRelation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeRelation_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "KnowledgeItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentKnowledgePreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "knowledgeId" TEXT NOT NULL,
    "preferenceScore" REAL NOT NULL DEFAULT 0,
    "context" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentKnowledgePreference_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "KnowledgeItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkflowTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "executorConfig" JSONB NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "acceptanceCriteria" JSONB,
    "integrationConfig" JSONB,
    "defaultTimeout" INTEGER,
    "allowParallel" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Workflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stageGraph" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentStageIds" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workflow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Workflow_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkflowStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assignedAgents" JSONB NOT NULL,
    "inputArtifacts" JSONB NOT NULL,
    "outputArtifacts" JSONB NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "deadline" DATETIME,
    "gateResults" JSONB,
    "contextMemoryIds" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowStage_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkflowTransition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT,
    "action" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowTransition_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KnowledgeItem_scope_projectId_idx" ON "KnowledgeItem"("scope", "projectId");
CREATE INDEX IF NOT EXISTS "KnowledgeItem_createdAt_idx" ON "KnowledgeItem"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeRelation_sourceId_targetId_relationType_key" ON "KnowledgeRelation"("sourceId", "targetId", "relationType");
CREATE INDEX IF NOT EXISTS "KnowledgeRelation_sourceId_createdAt_idx" ON "KnowledgeRelation"("sourceId", "createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeRelation_targetId_createdAt_idx" ON "KnowledgeRelation"("targetId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentKnowledgePreference_agentId_knowledgeId_context_key" ON "AgentKnowledgePreference"("agentId", "knowledgeId", "context");
CREATE INDEX IF NOT EXISTS "AgentKnowledgePreference_agentId_createdAt_idx" ON "AgentKnowledgePreference"("agentId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowTemplate_key_key" ON "WorkflowTemplate"("key");
CREATE INDEX IF NOT EXISTS "Workflow_projectId_status_createdAt_idx" ON "Workflow"("projectId", "status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowStage_workflowId_nodeId_key" ON "WorkflowStage"("workflowId", "nodeId");
CREATE INDEX IF NOT EXISTS "WorkflowStage_workflowId_status_createdAt_idx" ON "WorkflowStage"("workflowId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkflowTransition_workflowId_createdAt_idx" ON "WorkflowTransition"("workflowId", "createdAt");
