-- CreateIndex
CREATE INDEX "Model_status_updatedAt_idx" ON "Model"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ModelLog_modelId_timestamp_idx" ON "ModelLog"("modelId", "timestamp");

-- CreateIndex
CREATE INDEX "ModelLog_modelId_type_timestamp_idx" ON "ModelLog"("modelId", "type", "timestamp");
