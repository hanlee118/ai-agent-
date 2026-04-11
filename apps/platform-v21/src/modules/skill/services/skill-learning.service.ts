import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Skill } from '../entities/skill.entity';
import { SkillUsageLog } from '../entities/skill-usage-log.entity';
import { LLMOrchestrationService } from '../../../shared/services/llm-orchestration.service';
import { EmbeddingService } from '../../../shared/services/embedding.service';
import { ProjectStage } from '../../stage/entities/project-stage.entity';
import { StageTemplate } from '../../stage/entities/stage-template.entity';
import { ProjectWorkflow } from '../../stage/entities/project-workflow.entity';
import { SkillSource, SkillType, StageStatus } from '../../../shared/enums';

type EvaluationResult = {
  shouldCreate: boolean;
  score: number;
  name: string;
  type: 'procedural' | 'cognitive' | 'meta';
  keySteps: string[];
  pitfalls: string[];
};

@Injectable()
export class SkillLearningService {
  private readonly logger = new Logger(SkillLearningService.name);

  constructor(
    @InjectRepository(Skill)
    private readonly skillRepo: Repository<Skill>,
    @InjectRepository(SkillUsageLog)
    private readonly logRepo: Repository<SkillUsageLog>,
    @InjectRepository(StageTemplate)
    private readonly templateRepo: Repository<StageTemplate>,
    @InjectRepository(ProjectWorkflow)
    private readonly workflowRepo: Repository<ProjectWorkflow>,
    private readonly llmService: LLMOrchestrationService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async selfEvaluationCheckpoint(stage: ProjectStage): Promise<Skill | null> {
    const trace = stage.executionTrace;
    const toolCallCount = Array.isArray(trace?.toolCalls) ? trace.toolCalls.length : 0;

    const template = await this.templateRepo.findOne({ where: { key: stage.templateKey } });
    const config = this.getExtractionConfig(template?.skillExtractionConfig);

    if (toolCallCount < config.requiredToolCalls && stage.status !== StageStatus.COMPLETED) {
      return null;
    }

    const evaluation = await this.evaluateTrace(trace || {}, stage);
    if (!evaluation.shouldCreate || evaluation.score < config.evaluationThreshold) {
      return null;
    }

    return this.createSkill(stage, evaluation);
  }

  async recordUsage(data: {
    skillId: string;
    projectId: string;
    stageId: string;
    agentType: 'hermes' | 'openclaw';
    agentId?: string;
    success: boolean;
    duration: number;
    feedback?: string;
  }): Promise<void> {
    await this.logRepo.save(
      this.logRepo.create({
        skillId: data.skillId,
        projectId: data.projectId,
        stageId: data.stageId,
        agentId: data.agentId,
        agentType: data.agentType,
        success: data.success,
        durationMinutes: Math.max(0, Math.round(data.duration)),
        userFeedback: data.feedback,
      }),
    );

    const skill = await this.skillRepo.findOne({ where: { id: data.skillId } });
    if (!skill) {
      throw new NotFoundException(`Skill not found: ${data.skillId}`);
    }

    const nextHistory = [
      ...(skill.successHistory || []),
      {
        projectId: data.projectId,
        success: data.success,
        duration: data.duration,
        feedback: data.feedback || '',
      },
    ].slice(-10);

    const successRate =
      nextHistory.length > 0
        ? nextHistory.filter((item) => item.success).length / nextHistory.length
        : 0;

    skill.usageCount += 1;
    skill.successHistory = nextHistory;
    skill.manifest = {
      ...(skill.manifest || {}),
      successRate,
    };

    if (skill.usageCount % Number(process.env.SKILL_REFINEMENT_TRIGGER_USES || 5) === 0) {
      await this.evaluateRefinement(skill, successRate);
    }

    await this.skillRepo.save(skill);
  }

  async loadSkillsForExecution(stageType: string, projectId: string): Promise<Skill[]> {
    const queryVector = await this.embeddingService.embed(`Execute ${stageType}`);
    const allSkills = await this.skillRepo.find({
      where: { isActive: true },
      order: { updatedAt: 'DESC' },
      take: 50,
    });

    const now = Date.now();
    return allSkills
      .filter((skill) => {
        const observationPass = !skill.observationPeriodEnds || skill.observationPeriodEnds.getTime() <= now;
        const visibilityPass =
          skill.visibility === 'organization' ||
          skill.visibility === 'public' ||
          (skill.visibility === 'project' && skill.originProjectId === projectId) ||
          skill.isCertified;
        return observationPass && visibilityPass;
      })
      .map((skill) => {
        const embedding = Array.isArray(skill.embedding) ? skill.embedding : [];
        const score = this.cosine(queryVector, embedding);
        return { skill, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.skill);
  }

  async list(query: { type?: string; visibility?: string; query?: string }) {
    const items = await this.skillRepo.find({ order: { updatedAt: 'DESC' }, take: 200 });
    return items.filter((skill) => {
      const typePass = query.type ? skill.type === query.type : true;
      const visibilityPass = query.visibility ? skill.visibility === query.visibility : true;
      const queryPass = query.query
        ? `${skill.name} ${skill.skillKey} ${skill.instruction}`.toLowerCase().includes(query.query.toLowerCase())
        : true;
      return typePass && visibilityPass && queryPass;
    });
  }

  async exportToHermes(id: string): Promise<string> {
    const skill = await this.skillRepo.findOne({ where: { id } });
    if (!skill) {
      throw new NotFoundException(`Skill not found: ${id}`);
    }
    return `hermes-${skill.skillKey}`;
  }

  async importFromHermes(hermesSkillId: string, skillData?: Record<string, unknown>): Promise<Skill> {
    const existing = await this.skillRepo.findOne({
      where: { skillKey: `${hermesSkillId}-imported` },
    });
    if (existing) {
      return existing;
    }

    const instruction = typeof skillData?.instruction === 'string'
      ? skillData.instruction
      : `Imported from Hermes: ${hermesSkillId}`;
    const embedding = await this.embeddingService.embed(instruction);

    const created = this.skillRepo.create({
      skillKey: `${hermesSkillId}-imported`,
      name: typeof skillData?.name === 'string' ? skillData.name : `Imported ${hermesSkillId}`,
      type: (typeof skillData?.type === 'string' ? skillData.type : SkillType.PROCEDURAL) as SkillType,
      source: SkillSource.COMMUNITY_IMPORTED,
      manifest: {
        version: '1.0.0',
        author: 'hermes',
        description: typeof skillData?.description === 'string' ? skillData.description : `Imported skill ${hermesSkillId}`,
        tags: Array.isArray(skillData?.tags) ? skillData.tags : ['imported', 'hermes'],
        inputSchema: {},
        outputSchema: {},
        requiredTools: Array.isArray(skillData?.requiredTools) ? skillData.requiredTools : [],
        estimatedDuration: Number(skillData?.estimatedDuration || 15),
        successRate: Number(skillData?.successRate || 0),
      },
      instruction,
      embedding,
      isCertified: true,
      visibility: 'organization',
      isActive: true,
      successHistory: [],
      examples: [],
      externalMappings: { hermesSkillId },
      usageCount: 0,
      refinementCount: 0,
    });

    return this.skillRepo.save(created);
  }

  async listForHermes(input: { projectId?: string; limit?: number }) {
    const now = Date.now();
    const skills = await this.skillRepo.find({
      where: { isActive: true },
      order: { updatedAt: 'DESC' },
      take: 200,
    });

    return skills
      .filter((skill) => {
        if (skill.visibility === 'private') {
          return false;
        }
        if (skill.visibility === 'project' && input.projectId && skill.originProjectId && skill.originProjectId !== input.projectId) {
          return false;
        }
        if (skill.isCertified) {
          return true;
        }
        return !skill.observationPeriodEnds || skill.observationPeriodEnds.getTime() <= now;
      })
      .slice(0, Math.min(input.limit || 20, 100))
      .map((skill) => ({
        id: skill.id,
        skillKey: skill.skillKey,
        name: skill.name,
        type: skill.type,
        instruction: skill.instruction,
        manifest: skill.manifest,
        externalMappings: skill.externalMappings,
      }));
  }

  private async evaluateTrace(trace: Record<string, unknown>, stage: ProjectStage): Promise<EvaluationResult> {
    const prompt = [
      'Analyze this execution trace and evaluate if it should be extracted as a reusable Skill.',
      `Stage: ${stage.templateKey}`,
      `Tool Calls: ${Array.isArray(trace.toolCalls) ? trace.toolCalls.length : 0}`,
      `Decisions: ${JSON.stringify(trace.decisions || [])}`,
      `Errors: ${JSON.stringify(trace.errors || [])}`,
      `Resolution: ${String(trace.resolution || '')}`,
      'Return JSON with keys: shouldCreate, score, name, type, keySteps, pitfalls.',
    ].join('\n');

    const response = await this.llmService.complete(prompt);
    try {
      const parsed = JSON.parse(response) as EvaluationResult;
      return {
        shouldCreate: Boolean(parsed.shouldCreate),
        score: Number(parsed.score || 0),
        name: String(parsed.name || 'Auto Extracted Skill'),
        type: (['procedural', 'cognitive', 'meta'].includes(parsed.type) ? parsed.type : 'procedural') as
          | 'procedural'
          | 'cognitive'
          | 'meta',
        keySteps: Array.isArray(parsed.keySteps) ? parsed.keySteps.map((item) => String(item)) : [],
        pitfalls: Array.isArray(parsed.pitfalls) ? parsed.pitfalls.map((item) => String(item)) : [],
      };
    } catch {
      return {
        shouldCreate: false,
        score: 0,
        name: 'Invalid evaluation response',
        type: 'procedural',
        keySteps: [],
        pitfalls: [],
      };
    }
  }

  private async createSkill(stage: ProjectStage, evaluation: EvaluationResult): Promise<Skill> {
    const workflow = await this.workflowRepo.findOne({ where: { id: stage.workflowId } });
    const instruction = this.buildSkillInstruction(evaluation, stage);
    const embedding = await this.embeddingService.embed(instruction);

    const observationHours = Number(process.env.SKILL_OBSERVATION_PERIOD_HOURS || 24);
    const observationPeriodEnds = new Date(Date.now() + observationHours * 60 * 60 * 1000);

    const created = this.skillRepo.create({
      skillKey: `${this.toKebabCase(evaluation.name)}-v1`,
      name: evaluation.name,
      type: evaluation.type as SkillType,
      source: SkillSource.AUTO_EXTRACTED,
      manifest: {
        version: '1.0.0',
        author: 'system',
        description: `Extracted from ${stage.templateKey}`,
        tags: [stage.templateKey, 'auto-generated'],
        inputSchema: {},
        outputSchema: {},
        requiredTools: this.extractToolNames(stage),
        estimatedDuration: this.calculateDuration(stage),
        successRate: stage.status === StageStatus.COMPLETED ? 1 : 0,
      },
      instruction,
      originProjectId: workflow?.projectId,
      originStage: stage.templateKey,
      extractionDate: new Date(),
      embedding,
      observationPeriodEnds,
      isCertified: false,
      visibility: 'project',
      isActive: true,
      usageCount: 0,
      examples: [],
      successHistory: [],
      refinementCount: 0,
      externalMappings: {},
    });

    const saved = await this.skillRepo.save(created);
    this.logger.log(`Created skill ${saved.skillKey} from stage ${stage.id}`);
    return saved;
  }

  private async evaluateRefinement(skill: Skill, successRate: number): Promise<void> {
    if (successRate < 0.6) {
      skill.isActive = false;
      skill.refinementCount += 1;
      await this.skillRepo.save(skill);
      this.logger.warn(`Skill ${skill.skillKey} downgraded due to low success rate ${successRate.toFixed(2)}`);
    }
  }

  private getExtractionConfig(config?: { autoExtract?: boolean; evaluationThreshold?: number; requiredToolCalls?: number }) {
    return {
      autoExtract: config?.autoExtract ?? true,
      evaluationThreshold: Number(config?.evaluationThreshold ?? process.env.SKILL_AUTO_EXTRACT_THRESHOLD ?? 7),
      requiredToolCalls: Number(config?.requiredToolCalls ?? 5),
    };
  }

  private buildSkillInstruction(evaluation: EvaluationResult, stage: ProjectStage): string {
    const steps = evaluation.keySteps.map((item, idx) => `${idx + 1}. ${item}`).join('\n') || '1. Follow execution context.';
    const pitfalls = evaluation.pitfalls.map((item) => `- ${item}`).join('\n') || '- Missing context';

    return [
      `# ${evaluation.name}`,
      '',
      '## Context',
      `Extracted from ${stage.templateKey}`,
      '',
      '## Steps',
      steps,
      '',
      '## Pitfalls',
      pitfalls,
    ].join('\n');
  }

  private toKebabCase(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private calculateDuration(stage: ProjectStage) {
    if (!stage.startedAt) {
      return 0;
    }
    const end = stage.completedAt || new Date();
    return Math.round((end.getTime() - stage.startedAt.getTime()) / 60000);
  }

  private extractToolNames(stage: ProjectStage) {
    const toolCalls = Array.isArray(stage.executionTrace?.toolCalls) ? stage.executionTrace.toolCalls : [];
    return [...new Set(toolCalls.map((item) => String((item as { tool?: unknown }).tool || 'unknown')))].slice(0, 20);
  }

  private cosine(a: number[], b: number[]) {
    if (!a.length || !b.length) {
      return 0;
    }
    const length = Math.min(a.length, b.length);
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < length; i += 1) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) {
      return 0;
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }
}
