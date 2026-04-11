import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class HermesMcpClientService {
  private readonly logger = new Logger(HermesMcpClientService.name);

  private get mcpEndpoint() {
    return process.env.HERMES_MCP || process.env.HERMES_MCP_ENDPOINT || 'http://localhost:3001/mcp';
  }

  private get fallbackUrl() {
    return process.env.HERMES_FALLBACK_URL || 'http://localhost:3001/fallback';
  }

  async call(method: string, payload: Record<string, unknown>) {
    try {
      const rpcResponse = await fetch(this.mcpEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params: payload,
        }),
      });

      if (!rpcResponse.ok) {
        throw new Error(`MCP endpoint returned ${rpcResponse.status}`);
      }

      const result = (await rpcResponse.json()) as { result?: unknown };
      return result.result;
    } catch (error) {
      this.logger.warn(`MCP call failed, fallback to HTTP: ${(error as Error).message}`);
      return this.callFallback(method, payload);
    }
  }

  async executeTask(payload: {
    task: string;
    stageId: string;
    templateKey: string;
    inputs?: unknown[];
    soul_md?: string;
    memory_md?: string;
    skills?: unknown[];
    enable_self_evaluation?: boolean;
  }) {
    try {
      const response = await fetch(`${this.mcpEndpoint}/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Hermes /mcp/execute returned ${response.status}`);
      }
      return response.json();
    } catch (error) {
      this.logger.warn(`Hermes /mcp/execute failed: ${(error as Error).message}`);
      return this.callFallback('execute_task', payload);
    }
  }

  async importSkill(skill: { id: string; skillKey: string; name: string; instruction: string }) {
    try {
      const response = await fetch(`${this.mcpEndpoint}/skills/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill }),
      });
      if (!response.ok) {
        throw new Error(`Hermes /mcp/skills/import returned ${response.status}`);
      }
      return response.json();
    } catch (error) {
      this.logger.warn(`Hermes skill import failed: ${(error as Error).message}`);
      return this.callFallback('import_skill', { skill });
    }
  }

  async exportSkills() {
    const response = await fetch(`${this.mcpEndpoint}/skills/export`);
    if (!response.ok) {
      throw new Error(`Hermes /mcp/skills/export returned ${response.status}`);
    }
    return response.json() as Promise<{ skills: unknown[] }>;
  }

  async exportMemory(projectId: string) {
    const response = await fetch(`${this.mcpEndpoint}/memory/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: projectId }),
    });
    if (!response.ok) {
      throw new Error(`Hermes /mcp/memory/export returned ${response.status}`);
    }
    return response.json() as Promise<{ memories: unknown[] }>;
  }

  async health() {
    try {
      const response = await fetch(`${this.mcpEndpoint}/health`);
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as { status?: string };
      return body.status ? body.status === 'healthy' : true;
    } catch {
      return false;
    }
  }

  private async callFallback(method: string, payload: Record<string, unknown>) {
    const response = await fetch(this.fallbackUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, payload }),
    });
    if (!response.ok) {
      throw new Error(`Hermes fallback failed with ${response.status}`);
    }
    return response.json();
  }
}
