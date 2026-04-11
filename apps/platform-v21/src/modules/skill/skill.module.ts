import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Skill } from './entities/skill.entity';
import { SkillUsageLog } from './entities/skill-usage-log.entity';
import { SkillLearningService } from './services/skill-learning.service';
import { SkillController } from './controllers/skill.controller';
import { LLMOrchestrationService } from '../../shared/services/llm-orchestration.service';
import { EmbeddingService } from '../../shared/services/embedding.service';
import { StageTemplate } from '../stage/entities/stage-template.entity';
import { ProjectWorkflow } from '../stage/entities/project-workflow.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Skill, SkillUsageLog, StageTemplate, ProjectWorkflow])],
  controllers: [SkillController],
  providers: [SkillLearningService, LLMOrchestrationService, EmbeddingService],
  exports: [SkillLearningService, TypeOrmModule],
})
export class SkillModule {}
