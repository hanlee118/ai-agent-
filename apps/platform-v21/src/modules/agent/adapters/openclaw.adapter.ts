import { Injectable } from '@nestjs/common';
import { IAgentAdapter, AgentTask, AgentResult } from '../../../shared/interfaces/agent.interface';
import { OpenClawClientService } from '../../../shared/services/openclaw-client.service';

@Injectable()
export class OpenClawAdapter implements IAgentAdapter {
  constructor(private readonly openClawClient: OpenClawClientService) {}

  async execute(task: AgentTask, context: Record<string, unknown>): Promise<AgentResult> {
    const response = (await this.openClawClient.executeTask({
      task: task.description,
      stageId: task.stageId,
      templateKey: task.templateKey,
      context,
      tools: task.tools || [],
      plan: task.plan,
      timeout: task.timeout,
    })) as Record<string, unknown>;

    return {
      success: Boolean(response?.success),
      artifacts: (Array.isArray(response?.artifacts) ? response.artifacts : []) as Array<Record<string, unknown>>,
      executionTrace: {
        toolCalls: Array.isArray(response?.toolCalls) ? (response.toolCalls as Array<Record<string, unknown>>) : [],
        decisions: Array.isArray(response?.decisions) ? (response.decisions as Array<Record<string, unknown>>) : [],
        errors: Array.isArray(response?.errors) ? (response.errors as Array<Record<string, unknown>>) : [],
        resolution: typeof response?.resolution === 'string' ? response.resolution : undefined,
      },
      errorMessage: typeof response?.errorMessage === 'string' ? response.errorMessage : undefined,
    };
  }

  async syncSkill(skill: { id: string; skillKey: string; name: string; instruction: string }): Promise<void> {
    const sop = `## SOP: ${skill.name}\n\n${skill.instruction}`;
    await this.openClawClient.uploadSOP(skill.skillKey, sop);
  }

  async isHealthy(): Promise<boolean> {
    return this.openClawClient.healthCheck();
  }
}
