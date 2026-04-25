-- CreateTable
CREATE TABLE IF NOT EXISTS "ProjectExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "stageType" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "requestedMode" TEXT,
    "runtimeMode" TEXT,
    "promptSummary" TEXT,
    "outputPreview" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectExecution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProjectExecution_projectId_createdAt_idx" ON "ProjectExecution"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectExecution_projectId_stageType_createdAt_idx" ON "ProjectExecution"("projectId", "stageType", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectExecution_status_createdAt_idx" ON "ProjectExecution"("status", "createdAt");
