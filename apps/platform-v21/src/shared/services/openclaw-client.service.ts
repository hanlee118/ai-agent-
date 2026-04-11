import { Injectable } from '@nestjs/common';

@Injectable()
export class OpenClawClientService {
  private get endpoint() {
    return process.env.OPENCLAW_API || process.env.OPENCLAW_API_ENDPOINT || 'http://localhost:3002/api';
  }

  async executeTask(payload: Record<string, unknown>) {
    const response = await fetch(`${this.endpoint}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        success: false,
        artifacts: [],
        executionTrace: { errors: [{ message: `OpenClaw API ${response.status}` }] },
      };
    }

    return response.json();
  }

  async uploadSOP(skillKey: string, sop: string) {
    await fetch(`${this.endpoint}/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillKey, sop }),
    });
  }

  async healthCheck() {
    try {
      const response = await fetch(`${this.endpoint}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
