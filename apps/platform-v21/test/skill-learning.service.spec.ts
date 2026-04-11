import { StageStatus } from '../src/shared/enums';
import { SkillLearningService } from '../src/modules/skill/services/skill-learning.service';

describe('SkillLearningService', () => {
  const skillRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((payload) => payload),
    save: jest.fn(),
  };
  const logRepo = {
    create: jest.fn((payload) => payload),
    save: jest.fn(),
  };
  const templateRepo = {
    findOne: jest.fn(),
  };
  const workflowRepo = {
    findOne: jest.fn(),
  };
  const llmService = {
    complete: jest.fn(),
  };
  const embeddingService = {
    embed: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates skill when evaluation passes threshold', async () => {
    templateRepo.findOne.mockResolvedValue({
      skillExtractionConfig: {
        requiredToolCalls: 5,
        evaluationThreshold: 7,
      },
    });
    llmService.complete.mockResolvedValue(
      JSON.stringify({
        shouldCreate: true,
        score: 8.2,
        name: 'Reusable Debug Pattern',
        type: 'procedural',
        keySteps: ['inspect logs', 'add assertions'],
        pitfalls: ['missing reproduction'],
      }),
    );
    workflowRepo.findOne.mockResolvedValue({ projectId: 'project-1' });
    embeddingService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    skillRepo.save.mockImplementation(async (payload) => ({ id: 'skill-1', ...payload }));

    const service = new SkillLearningService(
      skillRepo as never,
      logRepo as never,
      templateRepo as never,
      workflowRepo as never,
      llmService as never,
      embeddingService as never,
    );

    const skill = await service.selfEvaluationCheckpoint({
      id: 'stage-1',
      workflowId: 'wf-1',
      templateKey: 'code_development',
      status: StageStatus.COMPLETED,
      startedAt: new Date(Date.now() - 30 * 60 * 1000),
      completedAt: new Date(),
      executionTrace: {
        toolCalls: [{ tool: 'terminal' }, { tool: 'git' }, { tool: 'grep' }, { tool: 'jest' }, { tool: 'node' }],
        decisions: [],
        errors: [],
        resolution: 'done',
      },
    } as never);

    expect(skill?.id).toBe('skill-1');
    expect(skillRepo.save).toHaveBeenCalled();
  });

  it('downgrades skill when success rate is too low at refinement checkpoint', async () => {
    const prevTrigger = process.env.SKILL_REFINEMENT_TRIGGER_USES;
    process.env.SKILL_REFINEMENT_TRIGGER_USES = '1';

    skillRepo.findOne.mockResolvedValue({
      id: 'skill-2',
      usageCount: 0,
      successHistory: [],
      manifest: {},
      isActive: true,
      refinementCount: 0,
    });
    skillRepo.save.mockImplementation(async (payload) => payload);

    const service = new SkillLearningService(
      skillRepo as never,
      logRepo as never,
      templateRepo as never,
      workflowRepo as never,
      llmService as never,
      embeddingService as never,
    );

    await service.recordUsage({
      skillId: 'skill-2',
      projectId: 'project-1',
      stageId: 'stage-1',
      agentType: 'openclaw',
      success: false,
      duration: 10,
      feedback: 'failed',
    });

    const lastSaveArg = skillRepo.save.mock.calls[skillRepo.save.mock.calls.length - 1][0];
    expect(lastSaveArg.isActive).toBe(false);
    process.env.SKILL_REFINEMENT_TRIGGER_USES = prevTrigger;
  });
});
