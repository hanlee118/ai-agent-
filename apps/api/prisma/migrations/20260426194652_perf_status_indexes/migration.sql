-- CreateIndex
CREATE INDEX "Project_status_pendingApproval_updatedAt_idx" ON "Project"("status", "pendingApproval", "updatedAt");

-- CreateIndex
CREATE INDEX "Stage_status_updatedAt_idx" ON "Stage"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Task_status_updatedAt_idx" ON "Task"("status", "updatedAt");
