CREATE TABLE IF NOT EXISTS "AgentProfile" (
    "roleId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "workload" INTEGER NOT NULL,
    "styles" JSONB NOT NULL,
    "skills" JSONB NOT NULL,
    "recentHighlights" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "parsedKeywords" JSONB NOT NULL,
    "parsedConstraints" JSONB NOT NULL,
    "parsedRisks" JSONB NOT NULL,
    "parsedSuggestedTeam" JSONB NOT NULL,
    "parsedSummary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentStage" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,
    "pendingApproval" BOOLEAN NOT NULL DEFAULT false,
    "currentRole" TEXT NOT NULL,
    "team" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "liveTitle" TEXT NOT NULL,
    "liveBody" TEXT NOT NULL,
    "liveStartedAt" DATETIME NOT NULL,
    "liveProvider" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Stage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "assignee" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Stage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Deliverable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "stageType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deliverable_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "TimelineEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "agentId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    CONSTRAINT "TimelineEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Stage_projectId_sortOrder_idx" ON "Stage"("projectId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "Stage_projectId_type_key" ON "Stage"("projectId", "type");
CREATE INDEX IF NOT EXISTS "Deliverable_projectId_stageType_idx" ON "Deliverable"("projectId", "stageType");
CREATE INDEX IF NOT EXISTS "TimelineEvent_projectId_timestamp_idx" ON "TimelineEvent"("projectId", "timestamp");

CREATE TABLE IF NOT EXISTS "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "stageType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assignee" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Task_projectId_stageType_idx" ON "Task"("projectId", "stageType");
CREATE INDEX IF NOT EXISTS "Task_assignee_status_idx" ON "Task"("assignee", "status");

CREATE TABLE IF NOT EXISTS "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

CREATE TABLE IF NOT EXISTS "SystemConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'scripted',
    "apiBaseUrl" TEXT NOT NULL DEFAULT '',
    "apiKey" TEXT NOT NULL DEFAULT '',
    "modelName" TEXT NOT NULL DEFAULT '',
    "adminPasswordHash" TEXT NOT NULL DEFAULT '',
    "adminPasswordSalt" TEXT NOT NULL DEFAULT '',
    "adminPasswordUpdatedAt" DATETIME,
    "configSource" TEXT NOT NULL DEFAULT 'default',
    "lastValidatedAt" DATETIME,
    "lastValidationStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastValidationError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorType" TEXT NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

CREATE TABLE IF NOT EXISTS "NotificationState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "actionLabel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "eventAt" DATETIME,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "assignedTo" TEXT,
    "confirmedBy" TEXT,
    "workflowStatus" TEXT NOT NULL DEFAULT 'open',
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationState_sourceKey_key" ON "NotificationState"("sourceKey");
CREATE INDEX IF NOT EXISTS "NotificationState_workflowStatus_updatedAt_idx" ON "NotificationState"("workflowStatus", "updatedAt");
CREATE INDEX IF NOT EXISTS "NotificationState_severity_updatedAt_idx" ON "NotificationState"("severity", "updatedAt");

CREATE TABLE IF NOT EXISTS "PromptTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "projectId" TEXT,
    "ownerLabel" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "PromptTemplate_channel_locale_updatedAt_idx" ON "PromptTemplate"("channel", "locale", "updatedAt");
CREATE INDEX IF NOT EXISTS "PromptTemplate_projectId_channel_locale_idx" ON "PromptTemplate"("projectId", "channel", "locale");
CREATE INDEX IF NOT EXISTS "PromptTemplate_scope_ownerLabel_updatedAt_idx" ON "PromptTemplate"("scope", "ownerLabel", "updatedAt");

CREATE TABLE IF NOT EXISTS "ManagedAgentConfig" (
    "agentId" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT,
    "title" TEXT,
    "selectedModel" TEXT NOT NULL,
    "defaultModel" TEXT NOT NULL,
    "fallbackModel" TEXT,
    "executionMode" TEXT NOT NULL DEFAULT 'confirm_first',
    "requireConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "autoApproveMinorSteps" BOOLEAN NOT NULL DEFAULT false,
    "maxPromptTokens" INTEGER,
    "maxCompletionTokens" INTEGER,
    "maxDailyTokens" INTEGER,
    "memoryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "allowedAgentIds" JSONB,
    "intro" TEXT,
    "responsibility" TEXT,
    "toolAllowlist" JSONB
);

CREATE TABLE IF NOT EXISTS "AgentMemoryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 50,
    "tags" JSONB NOT NULL,
    "source" TEXT,
    "lastAccessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentMemoryEntry_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ManagedAgentConfig" ("agentId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AgentMemoryEntry_agentId_createdAt_idx" ON "AgentMemoryEntry"("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentMemoryEntry_agentId_importance_idx" ON "AgentMemoryEntry"("agentId", "importance");

CREATE TABLE IF NOT EXISTS "AgentUsageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentUsageLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ManagedAgentConfig" ("agentId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AgentUsageLog_agentId_createdAt_idx" ON "AgentUsageLog"("agentId", "createdAt");
