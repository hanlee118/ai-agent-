import { BadRequestException } from '@nestjs/common';
import { ProjectType, StageStatus, WorkflowStatus } from '../src/shared/enums';
import { ProjectFactoryService } from '../src/modules/project/services/project-factory.service';

describe('ProjectFactoryService', () => {
  const projectRepo = {
    create: jest.fn((payload) => payload),
    save: jest.fn(),
  };
  const inputRepo = {
    create: jest.fn((payload) => payload),
    save: jest.fn(),
  };
  const templateRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const deliverableRepo = {
    find: jest.fn(),
  };
  const stageRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const relayRepo = {
    create: jest.fn((payload) => payload),
    save: jest.fn(),
  };
  const stageOrchestrator = {
    createWorkflow: jest.fn(),
    createStandaloneWorkflow: jest.fn(),
    startWorkflow: jest.fn(),
  };
  const fileService = {
    save: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates complete project and initializes workflow', async () => {
    projectRepo.save.mockResolvedValue({
      id: 'project-1',
      projectType: ProjectType.COMPLETE,
      status: WorkflowStatus.ACTIVE,
    });
    stageOrchestrator.createWorkflow.mockResolvedValue({ id: 'wf-1' });
    stageOrchestrator.startWorkflow.mockResolvedValue(undefined);

    const service = new ProjectFactoryService(
      projectRepo as never,
      inputRepo as never,
      templateRepo as never,
      deliverableRepo as never,
      stageRepo as never,
      relayRepo as never,
      stageOrchestrator as never,
      fileService as never,
    );

    const project = await service.createProject({
      name: 'Demo',
      projectType: ProjectType.COMPLETE,
    } as never);

    expect(project.id).toBe('project-1');
    expect(stageOrchestrator.createWorkflow).toHaveBeenCalledWith('project-1', 'standard_software_development');
    expect(stageOrchestrator.startWorkflow).toHaveBeenCalledWith('wf-1');
  });

  it('throws for relay project when source stage is not completed', async () => {
    stageRepo.findOne.mockResolvedValue({
      id: 'stage-1',
      status: StageStatus.RUNNING,
    });

    const service = new ProjectFactoryService(
      projectRepo as never,
      inputRepo as never,
      templateRepo as never,
      deliverableRepo as never,
      stageRepo as never,
      relayRepo as never,
      stageOrchestrator as never,
      fileService as never,
    );

    await expect(
      service.createProject({
        name: 'Relay Demo',
        projectType: ProjectType.RELAY,
        sourceProjectId: 'project-source',
        sourceStageId: 'stage-1',
        templateKey: 'qa_acceptance',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
