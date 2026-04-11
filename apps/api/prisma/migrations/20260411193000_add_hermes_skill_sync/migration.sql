-- CreateTable
CREATE TABLE IF NOT EXISTS "HermesSkill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hermesSkillId" TEXT,
    "skillKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "sourceProjectId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'hermes',
    "isCertified" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "HermesSkill_hermesSkillId_key" ON "HermesSkill"("hermesSkillId");
CREATE UNIQUE INDEX IF NOT EXISTS "HermesSkill_skillKey_key" ON "HermesSkill"("skillKey");
CREATE INDEX IF NOT EXISTS "HermesSkill_sourceProjectId_isCertified_updatedAt_idx" ON "HermesSkill"("sourceProjectId", "isCertified", "updatedAt");
CREATE INDEX IF NOT EXISTS "HermesSkill_skillKey_isActive_idx" ON "HermesSkill"("skillKey", "isActive");
