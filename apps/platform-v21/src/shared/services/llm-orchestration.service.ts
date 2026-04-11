import { Injectable, Logger } from '@nestjs/common';
import { OpenAI } from 'openai';

@Injectable()
export class LLMOrchestrationService {
  private readonly logger = new Logger(LLMOrchestrationService.name);
  private readonly model = process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini';
  private readonly openai?: OpenAI;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  async complete(prompt: string): Promise<string> {
    if (!this.openai) {
      return JSON.stringify({
        shouldCreate: true,
        score: 8,
        name: 'Auto Extracted Skill',
        type: 'procedural',
        keySteps: ['Analyze context', 'Execute tools', 'Validate output'],
        pitfalls: ['Missing inputs', 'Low quality artifacts'],
      });
    }

    try {
      const response = await this.openai.responses.create({
        model: this.model,
        input: prompt,
      });
      return response.output_text || '{}';
    } catch (error) {
      this.logger.warn(`LLM call failed, fallback to deterministic response: ${(error as Error).message}`);
      return JSON.stringify({
        shouldCreate: false,
        score: 0,
        name: 'LLM unavailable',
        type: 'procedural',
        keySteps: [],
        pitfalls: [],
      });
    }
  }

  async completeJson<T extends object>(prompt: string, fallback: T): Promise<T> {
    const raw = await this.complete(prompt);
    try {
      return JSON.parse(raw) as T;
    } catch {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      try {
        return JSON.parse(cleaned) as T;
      } catch {
        return fallback;
      }
    }
  }
}
