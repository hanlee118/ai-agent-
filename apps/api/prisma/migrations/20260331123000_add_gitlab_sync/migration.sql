-- CreateTable
CREATE TABLE IF NOT EXISTS "GitLabSync" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "issueIid" INTEGER NOT NULL,
    "projectPath" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GitLabSync_projectId_issueIid_key" ON "GitLabSync"("projectId", "issueIid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GitLabSync_projectPath_status_idx" ON "GitLabSync"("projectPath", "status");
