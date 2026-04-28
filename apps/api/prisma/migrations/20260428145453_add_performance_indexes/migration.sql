-- CreateIndex
CREATE INDEX "KnowledgeItem_scope_projectId_updatedAt_idx" ON "KnowledgeItem"("scope", "projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "Stage_projectId_createdAt_idx" ON "Stage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_projectId_stageType_status_idx" ON "Task"("projectId", "stageType", "status");
