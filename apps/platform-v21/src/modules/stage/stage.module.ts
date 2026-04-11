import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StageTemplate } from './entities/stage-template.entity';
import { ProjectWorkflow } from './entities/project-workflow.entity';
import { ProjectStage } from './entities/project-stage.entity';
import { StageTransition } from './entities/stage-transition.entity';
import { StageOrchestratorService } from './services/stage-orchestrator.service';
import { QualityGateService } from './services/quality-gate.service';
import { AgentModule } from '../agent/agent.module';
import { SkillModule } from '../skill/skill.module';
import { DeliverableModule } from '../deliverable/deliverable.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { StitchIntegrationService } from '../../shared/services/stitch-integration.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([StageTemplate, ProjectWorkflow, ProjectStage, StageTransition]),
    AgentModule,
    SkillModule,
    DeliverableModule,
    KnowledgeModule,
  ],
  providers: [StageOrchestratorService, QualityGateService, StitchIntegrationService],
  exports: [StageOrchestratorService, TypeOrmModule],
})
export class StageModule {}
