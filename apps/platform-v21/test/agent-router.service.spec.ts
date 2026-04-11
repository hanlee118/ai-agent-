import { AgentType } from '../src/shared/enums';
import { AgentRouterService } from '../src/modules/agent/services/agent-router.service';

describe('AgentRouterService', () => {
  const hermesAdapter = {
    execute: jest.fn(),
    isHealthy: jest.fn(),
  };
  const openClawAdapter = {
    execute: jest.fn(),
    isHealthy: jest.fn(),
  };

  const queryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };

  const agentRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes visual design to Hermes when healthy Hermes is available', async () => {
    agentRepo.find.mockResolvedValueOnce([
      {
        agentId: 'hermes-agent-1',
        agentType: AgentType.HERMES,
        isHealthy: true,
        currentLoad: 0,
        maxConcurrent: 2,
      },
    ]);

    const service = new AgentRouterService(
      hermesAdapter as never,
      openClawAdapter as never,
      agentRepo as never,
    );

    const decision = await service.determineRouting({
      stageType: 'visual_design',
      preferredAgent: 'auto',
      complexity: 5,
    });

    expect(decision.strategy).toBe('hermes');
    expect(decision.agentIds).toEqual(['hermes-agent-1']);
  });

  it('executes hybrid strategy as planning then execution', async () => {
    const service = new AgentRouterService(
      hermesAdapter as never,
      openClawAdapter as never,
      agentRepo as never,
    );

    agentRepo.findOne
      .mockResolvedValueOnce({
        agentId: 'hermes-agent-1',
        agentType: AgentType.HERMES,
      })
      .mockResolvedValueOnce({
        agentId: 'openclaw-agent-1',
        agentType: AgentType.OPENCLAW,
      });

    hermesAdapter.execute.mockResolvedValueOnce({
      success: true,
      artifacts: [{ name: 'plan' }],
      executionTrace: {},
    });
    openClawAdapter.execute.mockResolvedValueOnce({
      success: true,
      artifacts: [{ name: 'code' }],
      executionTrace: {},
    });

    const result = await service.execute(
      {
        strategy: 'hybrid_sequential',
        agentIds: ['hermes-agent-1', 'openclaw-agent-1'],
        reason: 'test',
      },
      {
        stageId: 'stage-1',
        templateKey: 'code_development',
        description: 'implement feature',
      },
    );

    expect(hermesAdapter.execute).toHaveBeenCalledTimes(1);
    expect(openClawAdapter.execute).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(queryBuilder.execute).toHaveBeenCalled();
  });

  it('returns failed result instead of throwing when adapter execution throws', async () => {
    const service = new AgentRouterService(
      hermesAdapter as never,
      openClawAdapter as never,
      agentRepo as never,
    );

    agentRepo.findOne.mockResolvedValueOnce({
      agentId: 'hermes-agent-1',
      agentType: AgentType.HERMES,
    });

    hermesAdapter.execute.mockRejectedValueOnce(new Error('hermes unavailable'));

    const result = await service.execute(
      {
        strategy: 'hermes',
        agentIds: ['hermes-agent-1'],
        reason: 'test-error-path',
      },
      {
        stageId: 'stage-err',
        templateKey: 'requirements_design',
        description: 'plan feature',
      },
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('hermes unavailable');
    expect(queryBuilder.execute).toHaveBeenCalled();
  });

  it('falls back to OpenClaw when Hermes execution fails', async () => {
    const service = new AgentRouterService(
      hermesAdapter as never,
      openClawAdapter as never,
      agentRepo as never,
    );

    agentRepo.findOne
      .mockResolvedValueOnce({
        agentId: 'hermes-agent-1',
        agentType: AgentType.HERMES,
      })
      .mockResolvedValueOnce({
        agentId: 'openclaw-agent-1',
        agentType: AgentType.OPENCLAW,
      });

    agentRepo.find.mockResolvedValueOnce([
      {
        agentId: 'openclaw-agent-1',
        agentType: AgentType.OPENCLAW,
        isHealthy: true,
        currentLoad: 0,
        maxConcurrent: 2,
      },
    ]);

    hermesAdapter.execute.mockRejectedValueOnce(new Error('hermes down'));
    openClawAdapter.execute.mockResolvedValueOnce({
      success: true,
      artifacts: [{ name: 'fallback-result' }],
      executionTrace: { decisions: [] },
    });

    const result = await service.execute(
      {
        strategy: 'hermes',
        agentIds: ['hermes-agent-1'],
        reason: 'fallback-test',
      },
      {
        stageId: 'stage-fallback',
        templateKey: 'requirements_design',
        description: 'design with fallback',
      },
    );

    expect(result.success).toBe(true);
    expect(openClawAdapter.execute).toHaveBeenCalledTimes(1);
    expect(result.executionTrace.decisions?.some((d) => d.type === 'agent_fallback')).toBe(true);
  });
});
