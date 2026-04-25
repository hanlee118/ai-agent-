-- DropIndex
DROP INDEX "ModelLog_modelId_timestamp_idx";

-- DropIndex
DROP INDEX "Project_currentStage_idx";

-- DropIndex
DROP INDEX "Project_status_idx";

-- DropIndex
DROP INDEX "Task_assignee_idx";

-- AlterTable
ALTER TABLE "AgentKnowledgePreference" ALTER COLUMN "preferenceScore" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "KnowledgeItem" ALTER COLUMN "importanceScore" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "KnowledgeRelation" ALTER COLUMN "strength" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "SystemConfig" ADD COLUMN     "executionProtocol" JSONB;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_parentProjectId_fkey" FOREIGN KEY ("parentProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_relaySourceStageId_fkey" FOREIGN KEY ("relaySourceStageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "StageRelayRelation_sourceProjectId_sourceStageId_targetProjectI" RENAME TO "StageRelayRelation_sourceProjectId_sourceStageId_targetProj_key";
