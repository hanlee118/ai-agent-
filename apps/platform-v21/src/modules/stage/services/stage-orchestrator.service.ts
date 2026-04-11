import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliverableService } from '../../deliverable/services/deliverable.service';
import { KnowledgeRetrievalService } from '../../knowledge/services/knowledge-retrieval.service';
import { ProjectInput } from '../../project/entities/project-input.entity';
import { StageStatus, WorkflowStatus } from '../../../shared/enums';
import { AgentRouterService } from '../../agent/services/agent-router.service';
import { SkillLearningService } from '../../skill/services/skill-learning.service';
import { StitchIntegrationService } from '../../../shared/services/stitch-integration.service';
import { ProjectWorkflow } from '../entities/project-workflow.entity';
import { ProjectStage } from '../entities/project-stage.entity';
import { StageTemplate } from '../entities/stage-template.entity';
import { StageTransition } from '../entities/stage-transition.entity';
import { QualityGateService } from './quality-gate.service';

@Injectable()
export class StageOrchestratorService {
  private readonly logger = new Logger(StageOrchestratorService.name);

  constructor(
    @InjectRepository(ProjectWorkflow)
    private readonly workflowRepo: Repository<ProjectWorkflow>,
    @InjectRepository(ProjectStage)
    private readonly stageRepo: Repository<ProjectStage>,
    @InjectRepository(StageTemplate)
    private readonly templateRepo: Repository<StageTemplate>,
    @InjectRepository(StageTransition)
    private readonly transitionRepo: Repository<StageTransition>,
    private readonly agentRouter: AgentRouterService,
    private readonly skillLearning: SkillLearningService,
    private readonly qualityGateService: QualityGateService,
    private readonly knowledgeService: KnowledgeRetrievalService,
    private readonly stitchService: StitchIntegrationService,
    private readonly deliverableService: DeliverableService,
  ) {}

  async createWorkflow(projectId: string, templateKey: string): Promise<ProjectWorkflow> {
    const template = await this.templateRepo.findOne({ where: { key: templateKey } });
    if (!template) {
      throw new NotFoundException(`Template not found: ${templateKey}`);
    }

    const stageGraph = this.buildStageGraph(template);
    const workflow = await this.workflowRepo.save(
      this.workflowRepo.create({
        projectId,
        templateId: template.id,
        name: `${template.name} Workflow`,
        stageGraph,
        status: WorkflowStatus.DRAFT,
      }),
    );

    const stages = stageGraph.nodes.map((node) =>
      this.stageRepo.create({
        workflowId: workflow.id,
        nodeId: node.id,
        templateKey: node.templateKey,
        status: StageStatus.PENDING,
        inputArtifacts: [],
        outputArtifacts: [],
      }),
    );
    await this.stageRepo.save(stages);

    return this.workflowRepo.findOneOrFail({ where: { id: workflow.id }, relations: ['stages', 'template'] });
  }

  async createStandaloneWorkflow(projectId: string, templateKey: string, inputs: ProjectInput[]): Promise<ProjectWorkflow> {
    const template = await this.templateRepo.findOne({ where: { key: templateKey } });
    if (!template) {
      throw new NotFoundException(`Template not found: ${templateKey}`);
    }

    const stageGraph = {
      nodes: [{ id: 'standalone-stage', templateKey, config: { isStandalone: true } }],
      edges: [] as Array<{ from: string; to: string; condition?: string }>,
    };

    const workflow = await this.workflowRepo.save(
      this.workflowRepo.create({
        projectId,
        templateId: template.id,
        name: `${template.name} (Standalone)`,
        stageGraph,
        status: WorkflowStatus.DRAFT,
        currentStageIds: [],
      }),
    );

    const stage = await this.stageRepo.save(
      this.stageRepo.create({
        workflowId: workflow.id,
        nodeId: 'standalone-stage',
        templateKey,
        status: StageStatus.PENDING,
        inputArtifacts: inputs.map((input) => ({
          type: input.type,
          name: input.name,
          referenceId: input.id,
          content: input.content?.slice(0, 1000),
        })),
      }),
    );

    workflow.currentStageIds = [stage.id];
    await this.workflowRepo.save(workflow);

    return this.workflowRepo.findOneOrFail({ where: { id: workflow.id }, relations: ['stages', 'template'] });
  }

  async startWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.workflowRepo.findOne({ where: { id: workflowId }, relations: ['stages', 'template'] });
    if (!workflow) {
      throw new NotFoundException(`Workflow not found: ${workflowId}`);
    }

    const entryNodes = workflow.stageGraph.nodes.filter(
      (node) => !workflow.stageGraph.edges.some((edge) => edge.to === node.id),
    );

    const entryStages = entryNodes
      .map((node) => workflow.stages.find((stage) => stage.nodeId === node.id))
      .filter((stage): stage is ProjectStage => Boolean(stage));

    workflow.status = WorkflowStatus.ACTIVE;
    workflow.currentStageIds = entryStages.map((stage) => stage.id);
    await this.workflowRepo.save(workflow);

    for (const stage of entryStages) {
      await this.activateStage(stage.id);
    }
  }

  private async activateStage(stageId: string): Promise<void> {
    const stage = await this.stageRepo.findOne({ where: { id: stageId }, relations: ['workflow', 'workflow.project'] });
    if (!stage) {
      throw new NotFoundException(`Stage not found: ${stageId}`);
    }

    const template = await this.templateRepo.findOne({ where: { key: stage.templateKey } });
    if (!template) {
      throw new NotFoundException(`Template not found: ${stage.templateKey}`);
    }

    const projectId = stage.workflow.projectId;
    const stageContext = await this.knowledgeService.buildExecutionContext({
      projectId,
      stageType: stage.templateKey,
      agentId: stage.assignedAgents?.[0],
      taskDescription: `Execute stage ${stage.templateKey} for project ${projectId}`,
    });
    const stageSkills = await this.skillLearning.loadSkillsForExecution(stage.templateKey, projectId);

    const routing = await this.agentRouter.determineRouting({
      stageType: template.key,
      category: template.category,
      preferredAgent: template.preferredAgentType,
      complexity: this.estimateComplexity(stage.inputArtifacts),
    });

    stage.assignedAgents = routing.agentIds;
    stage.status = StageStatus.RUNNING;
    stage.startedAt = new Date();
    await this.stageRepo.save(stage);

    const result = await this.agentRouter.execute(routing, {
      stageId: stage.id,
      templateKey: stage.templateKey,
      description: `Execute stage ${stage.templateKey}`,
      inputs: stage.inputArtifacts,
      timeout: template.defaultTimeout,
      context: {
        projectId,
        stageType: stage.templateKey,
        assignedAgents: stage.assignedAgents,
        knowledgeContext: stageContext,
        skills: stageSkills.map((skill) => ({
          id: skill.id,
          key: skill.skillKey,
          name: skill.name,
          instruction: skill.instruction,
        })),
      },
    });

    if (!result.success) {
      stage.status = StageStatus.FAILED;
      stage.executionTrace = result.executionTrace;
      stage.gateResults = { passed: false, reason: result.errorMessage || 'agent execution failed' };
      await this.stageRepo.save(stage);
      return;
    }

    const stitchedArtifacts = await this.stitchService.maybeEnrichArtifacts({
      stageKey: stage.templateKey,
      projectId,
      artifacts: result.artifacts,
      config: (template.integrationConfig || {}) as { useStitch?: boolean; requiredTools?: string[]; webhookUrls?: string[] },
    });

    stage.outputArtifacts = stitchedArtifacts;
    stage.executionTrace = result.executionTrace;

    const gateEvaluation = await this.qualityGateService.evaluate(stage, template);
    stage.gateResults = gateEvaluation;
    if (!gateEvaluation.passed) {
      stage.status = StageStatus.REVIEWING;
      await this.stageRepo.save(stage);
      this.logger.warn(`Stage ${stage.id} blocked by quality gate: ${gateEvaluation.violations.join('; ')}`);
      return;
    }

    stage.status = StageStatus.COMPLETED;
    stage.completedAt = new Date();

    const skill = await this.skillLearning.selfEvaluationCheckpoint(stage);
    if (skill) {
      stage.generatedSkillIds = [...(stage.generatedSkillIds || []), skill.id];
    }

    await this.stageRepo.save(stage);

    await this.deliverableService.createFromStageOutput({
      projectId,
      stageId: stage.id,
      artifacts: stage.outputArtifacts as Array<Record<string, unknown>>,
    });
    await this.knowledgeService.ingestStageArtifacts({
      projectId,
      stageKey: stage.templateKey,
      stageId: stage.id,
      agentId: stage.assignedAgents[0],
      artifacts: stage.outputArtifacts as Array<Record<string, unknown>>,
    });

    if (template.isStandalone) {
      await this.completeStandaloneStage(stage);
      return;
    }

    await this.transitionToNext(stage);
  }

  private async completeStandaloneStage(stage: ProjectStage): Promise<void> {
    const workflow = await this.workflowRepo.findOne({ where: { id: stage.workflowId } });
    if (!workflow) {
      return;
    }
    workflow.status = WorkflowStatus.COMPLETED;
    workflow.currentStageIds = [];
    await this.workflowRepo.save(workflow);
  }

  private async transitionToNext(currentStage: ProjectStage): Promise<void> {
    const workflow = await this.workflowRepo.findOne({ where: { id: currentStage.workflowId }, relations: ['stages'] });
    if (!workflow) {
      return;
    }

    const currentNode = currentStage.nodeId || workflow.stageGraph.nodes.find((n) => n.templateKey === currentStage.templateKey)?.id;
    if (!currentNode) {
      return;
    }

    const outgoingEdges = workflow.stageGraph.edges.filter((edge) => edge.from === currentNode);
    if (outgoingEdges.length === 0) {
      workflow.status = WorkflowStatus.COMPLETED;
      workflow.currentStageIds = [];
      await this.workflowRepo.save(workflow);
      return;
    }

    const nextStages = outgoingEdges
      .map((edge) => workflow.stages.find((stage) => stage.nodeId === edge.to))
      .filter((stage): stage is ProjectStage => Boolean(stage));

    workflow.currentStageIds = nextStages.map((stage) => stage.id);
    await this.workflowRepo.save(workflow);

    await this.transitionRepo.save(
      outgoingEdges.map((edge) =>
        this.transitionRepo.create({
          workflowId: workflow.id,
          fromStageId: currentStage.id,
          toStageId: workflow.stages.find((stage) => stage.nodeId === edge.to)?.id,
          action: 'proceed',
          triggeredBy: 'system',
        }),
      ),
    );

    for (const stage of nextStages) {
      await this.activateStage(stage.id);
    }
  }

  private buildStageGraph(template: StageTemplate) {
    if (template.isStandalone) {
      return {
        nodes: [{ id: 'standalone-stage', templateKey: template.key }],
        edges: [],
      };
    }

    if (template.key === 'standard_software_development') {
      return {
        nodes: [
          { id: 'requirements', templateKey: 'requirements_design' },
          { id: 'visual', templateKey: 'visual_design' },
          { id: 'code', templateKey: 'code_development' },
          { id: 'qa', templateKey: 'qa_acceptance' },
        ],
        edges: [
          { from: 'requirements', to: 'visual' },
          { from: 'visual', to: 'code' },
          { from: 'code', to: 'qa' },
        ],
      };
    }

    return {
      nodes: [{ id: template.key, templateKey: template.key }],
      edges: [],
    };
  }

  private estimateComplexity(artifacts: unknown[]) {
    const artifactCount = artifacts.length;
    if (artifactCount >= 5) {
      return 8;
    }
    if (artifactCount >= 2) {
      return 6;
    }
    return 4;
  }
}
