import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { ProjectType, StageStatus, WorkflowStatus } from '../../../shared/enums';
import { UploadedFileLike } from '../../../shared/interfaces/uploaded-file.interface';
import { FileStorageService } from '../../../shared/services/file-storage.service';
import { Deliverable } from '../../deliverable/entities/deliverable.entity';
import { StageTemplate } from '../../stage/entities/stage-template.entity';
import { ProjectStage } from '../../stage/entities/project-stage.entity';
import { StageOrchestratorService } from '../../stage/services/stage-orchestrator.service';
import { Project } from '../entities/project.entity';
import { ProjectInput } from '../entities/project-input.entity';
import { StageRelayRelation } from '../entities/stage-relay-relation.entity';
import { CreateProjectDto } from '../dto/create-project.dto';
import { ProjectInputDto } from '../dto/project-input.dto';

@Injectable()
export class ProjectFactoryService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectInput)
    private readonly inputRepo: Repository<ProjectInput>,
    @InjectRepository(StageTemplate)
    private readonly templateRepo: Repository<StageTemplate>,
    @InjectRepository(Deliverable)
    private readonly deliverableRepo: Repository<Deliverable>,
    @InjectRepository(ProjectStage)
    private readonly stageRepo: Repository<ProjectStage>,
    @InjectRepository(StageRelayRelation)
    private readonly relayRepo: Repository<StageRelayRelation>,
    private readonly stageOrchestrator: StageOrchestratorService,
    private readonly fileService: FileStorageService,
  ) {}

  async createProject(dto: CreateProjectDto): Promise<Project> {
    switch (dto.projectType) {
      case ProjectType.COMPLETE:
        return this.createCompleteProject(dto);
      case ProjectType.STANDALONE:
        return this.createStandaloneProject(dto);
      case ProjectType.RELAY:
        return this.createRelayProject(dto);
      default:
        throw new BadRequestException(`Unknown project type: ${dto.projectType}`);
    }
  }

  async listStandaloneTemplates(category?: string) {
    return this.templateRepo.find({
      where: {
        isStandalone: true,
        category: category || undefined,
        isActive: true,
      },
      order: { updatedAt: 'DESC' },
    });
  }

  async listRelaySources(stageType?: string) {
    const stages = await this.stageRepo.find({
      where: {
        status: StageStatus.COMPLETED,
        templateKey: stageType || undefined,
      },
      relations: ['workflow', 'workflow.project'],
      order: { updatedAt: 'DESC' },
      take: 50,
    });

    return Promise.all(
      stages.map(async (stage) => {
        const deliverables = await this.deliverableRepo.find({ where: { stageId: stage.id } });
        return {
          sourceProjectId: stage.workflow.projectId,
          sourceProjectName: stage.workflow.project?.name,
          sourceStageId: stage.id,
          sourceTemplateKey: stage.templateKey,
          deliverables: deliverables.map((item) => ({ id: item.id, name: item.name, type: item.type })),
        };
      }),
    );
  }

  async uploadInput(file: UploadedFileLike) {
    const path = await this.fileService.save(file, 'v21/preupload-inputs');
    return {
      fileName: file.originalname,
      filePath: path,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  private async createCompleteProject(dto: CreateProjectDto): Promise<Project> {
    const payload: DeepPartial<Project> = {
      name: dto.name,
      description: dto.description,
      projectType: ProjectType.COMPLETE,
      agentRoutingStrategy: dto.agentRoutingStrategy || 'auto',
      status: WorkflowStatus.ACTIVE,
    };

    const project = await this.projectRepo.save(
      this.projectRepo.create(payload),
    );

    const workflow = await this.stageOrchestrator.createWorkflow(
      project.id,
      dto.templateKey || 'standard_software_development',
    );
    await this.stageOrchestrator.startWorkflow(workflow.id);
    return project;
  }

  private async createStandaloneProject(dto: CreateProjectDto): Promise<Project> {
    const templateKey = dto.templateKey;
    if (!templateKey) {
      throw new BadRequestException('templateKey is required for standalone projects');
    }

    const template = await this.templateRepo.findOne({ where: { key: templateKey, isStandalone: true } });
    if (!template) {
      throw new NotFoundException(`Standalone template ${templateKey} not found`);
    }

    const inputs = dto.inputs || [];
    const validation = this.validateInputs(inputs, template.inputContract || {});
    if (!validation.valid) {
      throw new BadRequestException({ message: 'Input validation failed', errors: validation.errors });
    }

    const payload: DeepPartial<Project> = {
      name: dto.name,
      description: dto.description,
      projectType: ProjectType.STANDALONE,
      status: WorkflowStatus.ACTIVE,
      knowledgeMeta: {
        optimizationTarget: template.standaloneCategory,
        iterationDepth: 0,
      },
    };

    const project = await this.projectRepo.save(
      this.projectRepo.create(payload),
    );

    const savedInputs = await this.saveProjectInputs(project.id, inputs);
    const workflow = await this.stageOrchestrator.createStandaloneWorkflow(project.id, template.key, savedInputs);
    await this.stageOrchestrator.startWorkflow(workflow.id);

    return project;
  }

  private async createRelayProject(dto: CreateProjectDto): Promise<Project> {
    if (!dto.sourceStageId || !dto.sourceProjectId || !dto.templateKey) {
      throw new BadRequestException('sourceProjectId, sourceStageId and templateKey are required for relay');
    }

    const sourceStage = await this.stageRepo.findOne({ where: { id: dto.sourceStageId }, relations: ['workflow'] });
    if (!sourceStage || sourceStage.status !== StageStatus.COMPLETED) {
      throw new BadRequestException('Source stage not found or not completed');
    }

    const sourceDeliverables = await this.deliverableRepo.find({ where: { stageId: dto.sourceStageId } });
    if (sourceDeliverables.length === 0) {
      throw new BadRequestException('No deliverables found in source stage');
    }

    const targetTemplate = await this.templateRepo.findOne({ where: { key: dto.templateKey } });
    if (!targetTemplate) {
      throw new NotFoundException(`Target template not found: ${dto.templateKey}`);
    }

    const compatibility = this.checkCompatibility(sourceDeliverables, targetTemplate);
    if (!compatibility.compatible) {
      throw new BadRequestException({
        message: 'Source deliverables not compatible with target template',
        mismatches: compatibility.mismatches,
      });
    }

    const payload: DeepPartial<Project> = {
      name: dto.name,
      description: dto.description,
      projectType: ProjectType.RELAY,
      parentProjectId: dto.sourceProjectId,
      relaySourceStageId: dto.sourceStageId,
      status: WorkflowStatus.ACTIVE,
      knowledgeMeta: {
        parentKnowledgeGraph: {},
        recombinationType: 'sequential',
      },
    };

    const project = await this.projectRepo.save(
      this.projectRepo.create(payload),
    );

    const selectedTypes = dto.selectedDeliverableTypes || sourceDeliverables.map((item) => item.type);
    const relayInputs = await this.importDeliverablesAsInputs(project.id, sourceDeliverables, selectedTypes);

    await this.recordRelayRelation({
      sourceProjectId: dto.sourceProjectId,
      sourceStageId: dto.sourceStageId,
      targetProjectId: project.id,
      sourceDeliverableIds: relayInputs.map((input) => input.referenceDeliverableId).filter(Boolean) as string[],
    });

    const workflow = await this.stageOrchestrator.createWorkflow(project.id, dto.templateKey);
    await this.stageOrchestrator.startWorkflow(workflow.id);

    return project;
  }

  private validateInputs(inputs: ProjectInputDto[], contract: Record<string, unknown>) {
    const errors: Array<{ field: string; message: string }> = [];
    const requiresExternalInput = Boolean((contract as { requiresExternalInput?: unknown }).requiresExternalInput);

    if (requiresExternalInput && inputs.length === 0) {
      errors.push({ field: 'inputs', message: 'External input required' });
    }

    const rules = ((contract as { inputValidationRules?: unknown }).inputValidationRules || []) as Array<{
      field: string;
      minLength?: number;
    }>;

    for (const rule of rules) {
      const input = inputs.find((item) => item.type === rule.field || item.name === rule.field);
      if (!input) {
        errors.push({ field: rule.field, message: 'Required input missing' });
        continue;
      }

      if (rule.minLength && (!input.content || input.content.length < rule.minLength)) {
        errors.push({ field: rule.field, message: `Min length ${rule.minLength}` });
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private async saveProjectInputs(projectId: string, inputs: ProjectInputDto[]) {
    const saved: ProjectInput[] = [];

    for (const input of inputs) {
      saved.push(
        await this.inputRepo.save(
          this.inputRepo.create({
            projectId,
            name: input.name,
            type: input.type,
            description: input.description,
            content: input.content,
            filePath: input.filePath,
            inputSource: 'manual',
            validationStatus: 'valid',
          }),
        ),
      );
    }

    return saved;
  }

  private async importDeliverablesAsInputs(projectId: string, deliverables: Deliverable[], selectedTypes: string[]) {
    const filtered = deliverables.filter((item) => selectedTypes.includes(item.type));

    const inputs: ProjectInput[] = [];
    for (const deliverable of filtered) {
      inputs.push(
        await this.inputRepo.save(
          this.inputRepo.create({
            projectId,
            name: deliverable.name,
            type: deliverable.type,
            description: `Imported from project ${deliverable.projectId}`,
            referenceDeliverableId: deliverable.id,
            inputSource: 'imported_from_project',
            validationStatus: 'valid',
          }),
        ),
      );
    }

    return inputs;
  }

  private checkCompatibility(deliverables: Deliverable[], targetTemplate: StageTemplate) {
    const mismatches: string[] = [];
    const sourceTypes = new Set(deliverables.map((item) => item.type));

    const inputContract = (targetTemplate.inputContract || {}) as { allowedInputTypes?: string[] };
    const requiredInputs = inputContract.allowedInputTypes || [];

    if (requiredInputs.length > 0) {
      const hasMatch = requiredInputs.some((type) => sourceTypes.has(type));
      if (!hasMatch) {
        mismatches.push(`Types [${Array.from(sourceTypes).join(', ')}] don't match required [${requiredInputs.join(', ')}]`);
      }
    }

    return { compatible: mismatches.length === 0, mismatches };
  }

  private async recordRelayRelation(input: {
    sourceProjectId: string;
    sourceStageId: string;
    targetProjectId: string;
    sourceDeliverableIds: string[];
  }) {
    await this.relayRepo.save(
      this.relayRepo.create({
        sourceProjectId: input.sourceProjectId,
        sourceStageId: input.sourceStageId,
        targetProjectId: input.targetProjectId,
        sourceDeliverableIds: input.sourceDeliverableIds,
        relayType: 'full',
        syncStatus: 'active',
        lastSyncAt: new Date(),
      }),
    );
  }
}
