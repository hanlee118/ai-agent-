-- Stage SOP optimization: clarification delegation + workflow template stage tasks

ALTER TABLE "TaskDelegation"
  ADD COLUMN IF NOT EXISTS "clarificationDeliverableId" TEXT,
  ADD COLUMN IF NOT EXISTS "clarificationTargetRole" TEXT,
  ADD COLUMN IF NOT EXISTS "clarificationResponse" TEXT,
  ADD COLUMN IF NOT EXISTS "clarificationRespondedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "clarificationRespondedAt" TIMESTAMP(3);

ALTER TABLE "WorkflowTemplate"
  ADD COLUMN IF NOT EXISTS "stageTasks" JSONB;
