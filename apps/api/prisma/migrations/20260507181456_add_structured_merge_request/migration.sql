-- CreateTable
CREATE TABLE "StructuredMergeRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workflowStageId" TEXT,
    "executionId" TEXT,
    "relatedIssue" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "impact" TEXT NOT NULL,
    "verification" TEXT NOT NULL,
    "riskRollback" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StructuredMergeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StructuredMergeRequest_projectId_createdAt_idx" ON "StructuredMergeRequest"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "StructuredMergeRequest_workflowStageId_idx" ON "StructuredMergeRequest"("workflowStageId");

-- CreateIndex
CREATE INDEX "StructuredMergeRequest_executionId_idx" ON "StructuredMergeRequest"("executionId");

-- AddForeignKey
ALTER TABLE "StructuredMergeRequest" ADD CONSTRAINT "StructuredMergeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
