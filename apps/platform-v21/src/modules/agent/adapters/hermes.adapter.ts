import { Injectable } from '@nestjs/common';
import { IAgentAdapter, AgentTask, AgentResult } from '../../../shared/interfaces/agent.interface';
import { HermesMcpClientService } from '../../../shared/services/hermes-mcp-client.service';

@Injectable()
export class HermesAdapter implements IAgentAdapter {
  constructor(private readonly hermesClient: HermesMcpClientService) {}

  async execute(task: AgentTask, context: Record<string, unknown>): Promise<AgentResult> {
    const soulMd = this.buildSoulMd(context);
    const memoryMd = this.buildMemoryMd(context);

    const result = (await this.hermesClient.executeTask({
      task: task.description,
      stageId: task.stageId,
      templateKey: task.templateKey,
      inputs: task.inputs || [],
      soul_md: soulMd,
      memory_md: memoryMd,
      skills: Array.isArray(context.skills) ? context.skills : [],
      enable_self_evaluation: true,
    })) as Record<string, unknown>;

    const success = Boolean(result?.success ?? true);
    return {
      success,
      artifacts: (Array.isArray(result?.artifacts) ? result.artifacts : []) as Array<Record<string, unknown>>,
      executionTrace: {
        toolCalls: Array.isArray(result?.tool_calls) ? (result.tool_calls as Array<Record<string, unknown>>) : [],
        decisions: Array.isArray(result?.decisions) ? (result.decisions as Array<Record<string, unknown>>) : [],
        errors: Array.isArray(result?.errors) ? (result.errors as Array<Record<string, unknown>>) : [],
        resolution: typeof result?.resolution === 'string' ? result.resolution : undefined,
      },
      errorMessage: typeof result?.error === 'string' ? result.error : undefined,
    };
  }

  async syncSkill(skill: { id: string; skillKey: string; name: string; instruction: string }): Promise<void> {
    await this.hermesClient.importSkill(skill);
  }

  async isHealthy(): Promise<boolean> {
    return this.hermesClient.health();
  }

  private buildSoulMd(context: Record<string, unknown>) {
    return [
      '# SOUL.md',
      `Role: ${String(context.agentRole || 'Engineer')}`,
      'Objective: Deliver high-quality outputs for current stage.',
    ].join('\n');
  }

  private buildMemoryMd(context: Record<string, unknown>) {
    return [
      '# MEMORY.md',
      `Project: ${String(context.projectId || '-')}`,
      `Stage: ${String(context.stageType || '-')}`,
      String(context.projectMemorySummary || 'No memory summary.'),
    ].join('\n');
  }
}
