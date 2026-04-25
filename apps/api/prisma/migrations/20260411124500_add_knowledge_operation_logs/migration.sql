-- CreateTable
CREATE TABLE IF NOT EXISTS "KnowledgeOperationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operationType" TEXT NOT NULL,
    "scope" TEXT,
    "projectId" TEXT,
    "agentId" TEXT,
    "triggeredBy" TEXT,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "canRollback" BOOLEAN NOT NULL DEFAULT false,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KnowledgeOperationLog_operationType_createdAt_idx" ON "KnowledgeOperationLog"("operationType", "createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeOperationLog_projectId_createdAt_idx" ON "KnowledgeOperationLog"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeOperationLog_agentId_createdAt_idx" ON "KnowledgeOperationLog"("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeOperationLog_createdAt_idx" ON "KnowledgeOperationLog"("createdAt");
