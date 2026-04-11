import { WorkflowStatus } from '../src/shared/enums';
import { StageOrchestratorService } from '../src/modules/stage/services/stage-orchestrator.service';

describe('StageOrchestratorService', () => {
  const workflowRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    findOneOrFail: jest.fn(),
  };

  const stageRepo = {
    create: jest.fn((payload) => payload),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const templateRepo = {
    findOne: jest.fn(),
  };

  const transitionRepo = {
    create: jest.fn((payload) => payload),
    save: jest.fn(),
  };

  const agentRouter = {
    determineRouting: jest.fn(),
    execute: jest.fn(),
  };

  const skillLearning = {
    loadSkillsForExecution: jest.fn(),
    selfEvaluationCheckpoint: jest.fn(),
  };

  const qualityGateService = {
    evaluate: jest.fn(),
  };

  const knowledgeService = {
    buildExecutionContext: jest.fn(),
    ingestStageArtifacts: jest.fn(),
  };

  const stitchService = {
    maybeEnrichArtifacts: jest.fn(),
  };

  const deliverableService = {
    createFromStageOutput: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not overwrite standalone completion after stage activation', async () => {
    const workflow = {
      id: 'wf-1',
      stageGraph: {
        nodes: [{ id: 'standalone-stage', templateKey: 'ui_design_standalone_hermes' }],
        edges: [],
      },
      stages: [{ id: 'stage-1', nodeId: 'standalone-stage' }],
      status: WorkflowStatus.DRAFT,
      currentStageIds: [],
    };

    workflowRepo.findOne.mockResolvedValue(workflow);
    workflowRepo.save.mockImplementation(async (payload) => payload);

    const service = new StageOrchestratorService(
      workflowRepo as never,
      stageRepo as never,
      templateRepo as never,
      transitionRepo as never,
      agentRouter as never,
      skillLearning as never,
      qualityGateService as never,
      knowledgeService as never,
      stitchService as never,
      deliverableService as never,
    );

    jest.spyOn(service as any, 'activateStage').mockImplementation(async () => {
      workflow.status = WorkflowStatus.COMPLETED;
      workflow.currentStageIds = [];
    });

    await service.startWorkflow('wf-1');

    expect(workflowRepo.save).toHaveBeenCalled();
    expect(workflow.status).toBe(WorkflowStatus.COMPLETED);
    expect(workflow.currentStageIds).toEqual([]);
  });
});
