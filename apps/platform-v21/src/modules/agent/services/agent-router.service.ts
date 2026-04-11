import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentType } from '../../../shared/enums';
import {
  AgentResult,
  AgentTask,
  RoutingContext,
  RoutingDecision,
} from '../../../shared/interfaces/agent.interface';
import { HermesAdapter } from '../adapters/hermes.adapter';
import { OpenClawAdapter } from '../adapters/openclaw.adapter';
import { AgentInstance } from '../entities/agent-instance.entity';

@Injectable()
export class AgentRouterService {
  constructor(
    private readonly hermesAdapter: HermesAdapter,
    private readonly openClawAdapter: OpenClawAdapter,
    @InjectRepository(AgentInstance)
    private readonly agentRepo: Repository<AgentInstance>,
  ) {}

  async determineRouting(context: RoutingContext): Promise<RoutingDecision> {
    if (context.preferredAgent && context.preferredAgent !== 'auto') {
      return this.getAgentByType(context.preferredAgent);
    }

    if (context.complexity > Number(process.env.ROUTING_HYBRID_COMPLEXITY_THRESHOLD || 7)) {
      const hermes = await this.pickAgents(AgentType.HERMES, 1);
      const openclaw = await this.pickAgents(AgentType.OPENCLAW, 1);
      if (hermes.length > 0 && openclaw.length > 0) {
        return {
          agentIds: [hermes[0].agentId, openclaw[0].agentId],
          strategy: 'hybrid_sequential',
          reason: 'Complex task: Hermes planning + OpenClaw execution',
        };
      }
    }

    if (['requirements_design', 'visual_design', 'tech_design'].includes(context.stageType)) {
      const hermes = await this.pickAgents(AgentType.HERMES, 1);
      if (hermes.length > 0) {
        return {
          agentIds: [hermes[0].agentId],
          strategy: 'hermes',
          reason: 'Reasoning-oriented stage routed to Hermes',
        };
      }
    }

    if (['code_development', 'code_dev', 'qa_acceptance'].includes(context.stageType)) {
      const openclaw = await this.pickAgents(AgentType.OPENCLAW, 1);
      if (openclaw.length > 0) {
        return {
          agentIds: [openclaw[0].agentId],
          strategy: 'openclaw',
          reason: 'Execution-oriented stage routed to OpenClaw',
        };
      }
    }

    const fallback = await this.pickFallbackAgent();
    if (fallback) {
      return {
        agentIds: [fallback.agentId],
        strategy: fallback.agentType === AgentType.HERMES ? 'hermes' : 'openclaw',
        reason: 'Fallback to healthiest available agent',
      };
    }

    return {
      agentIds: ['openclaw-agent-1'],
      strategy: 'openclaw',
      reason: 'No healthy agent registered, using static fallback',
    };
  }

  async execute(routing: RoutingDecision, task: AgentTask): Promise<AgentResult> {
    await this.reserveAgents(routing.agentIds);
    try {
      if (routing.strategy === 'hybrid' || routing.strategy === 'hybrid_sequential') {
        const planner = await this.getAdapter(routing.agentIds[0]);
        const executor = await this.getAdapter(routing.agentIds[1]);

        const planResult = await planner.execute(
          { ...task, description: `[Planning] ${task.description}` },
          task.context || {},
        );

        if (!planResult.success) {
          return planResult;
        }

        return executor.execute(
          {
            ...task,
            description: `[Execution] ${task.description}`,
            plan: planResult.artifacts,
          },
          task.context || {},
        );
      }

      const adapter = await this.getAdapter(routing.agentIds[0]);
      return adapter.execute(task, task.context || {});
    } finally {
      await this.releaseAgents(routing.agentIds);
    }
  }

  async healthSnapshot() {
    const agents = await this.agentRepo.find({ order: { updatedAt: 'DESC' } });
    return Promise.all(
      agents.map(async (agent) => {
        const healthy = agent.agentType === AgentType.HERMES
          ? await this.hermesAdapter.isHealthy()
          : await this.openClawAdapter.isHealthy();

        if (agent.isHealthy !== healthy) {
          agent.isHealthy = healthy;
          agent.lastHealthCheck = new Date();
          await this.agentRepo.save(agent);
        }

        return {
          agentId: agent.agentId,
          type: agent.agentType,
          healthy,
          currentLoad: agent.currentLoad,
          maxConcurrent: agent.maxConcurrent,
          capabilities: agent.capabilities,
        };
      }),
    );
  }

  private async getAgentByType(type: 'hermes' | 'openclaw' | 'hybrid'): Promise<RoutingDecision> {
    if (type === 'hybrid') {
      const hermes = await this.pickAgents(AgentType.HERMES, 1);
      const openclaw = await this.pickAgents(AgentType.OPENCLAW, 1);
      if (hermes.length > 0 && openclaw.length > 0) {
        return {
          agentIds: [hermes[0].agentId, openclaw[0].agentId],
          strategy: 'hybrid_sequential',
          reason: 'Template preferred hybrid',
        };
      }
      if (hermes.length > 0) {
        return { agentIds: [hermes[0].agentId], strategy: 'hermes', reason: 'Hybrid fallback to Hermes' };
      }
      if (openclaw.length > 0) {
        return { agentIds: [openclaw[0].agentId], strategy: 'openclaw', reason: 'Hybrid fallback to OpenClaw' };
      }
    }

    const targetType = type === 'hermes' ? AgentType.HERMES : AgentType.OPENCLAW;
    const candidates = await this.pickAgents(targetType, 1);
    if (candidates.length > 0) {
      return {
        agentIds: [candidates[0].agentId],
        strategy: type,
        reason: `Template preferred ${type}`,
      };
    }

    const fallback = await this.pickFallbackAgent();
    if (fallback) {
      return {
        agentIds: [fallback.agentId],
        strategy: fallback.agentType === AgentType.HERMES ? 'hermes' : 'openclaw',
        reason: `No ${type} agent available, fallback applied`,
      };
    }

    return {
      agentIds: [type === 'hermes' ? 'hermes-agent-1' : 'openclaw-agent-1'],
      strategy: type,
      reason: 'No registered agent, static fallback',
    };
  }

  private async pickAgents(agentType: AgentType, count: number): Promise<AgentInstance[]> {
    const agents = await this.agentRepo.find({
      where: {
        agentType,
        isHealthy: true,
      },
      order: {
        currentLoad: 'ASC',
        updatedAt: 'ASC',
      },
      take: count * 3,
    });

    return agents.filter((agent) => agent.currentLoad < agent.maxConcurrent).slice(0, count);
  }

  private async pickFallbackAgent(): Promise<AgentInstance | null> {
    const agents = await this.agentRepo.find({
      where: { isHealthy: true },
      order: { currentLoad: 'ASC', updatedAt: 'ASC' },
      take: 5,
    });

    const available = agents.find((agent) => agent.currentLoad < agent.maxConcurrent);
    return available || null;
  }

  private async getAdapter(agentId: string) {
    const instance = await this.agentRepo.findOne({ where: { agentId } });
    if (!instance) {
      if (agentId.includes('hermes')) {
        return this.hermesAdapter;
      }
      return this.openClawAdapter;
    }

    return instance.agentType === AgentType.HERMES ? this.hermesAdapter : this.openClawAdapter;
  }

  private async reserveAgents(agentIds: string[]) {
    if (agentIds.length === 0) {
      return;
    }

    await Promise.all(
      agentIds.map(async (agentId) => {
        await this.agentRepo
          .createQueryBuilder()
          .update(AgentInstance)
          .set({
            currentLoad: () => '"current_load" + 1',
            updatedAt: () => 'CURRENT_TIMESTAMP',
          })
          .where('agent_id = :agentId', { agentId })
          .execute();
      }),
    );
  }

  private async releaseAgents(agentIds: string[]) {
    if (agentIds.length === 0) {
      return;
    }

    await Promise.all(
      agentIds.map(async (agentId) => {
        await this.agentRepo
          .createQueryBuilder()
          .update(AgentInstance)
          .set({
            currentLoad: () => 'GREATEST("current_load" - 1, 0)',
            updatedAt: () => 'CURRENT_TIMESTAMP',
          })
          .where('agent_id = :agentId', { agentId })
          .execute();
      }),
    );
  }
}
