import { Injectable, Logger } from '@nestjs/common';
import { OpenAI } from 'openai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large';
  private readonly dimension = 1536;
  private readonly openai?: OpenAI;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  async embed(text: string): Promise<number[]> {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return new Array(this.dimension).fill(0);
    }

    if (!this.openai) {
      return this.fallbackVector(normalized);
    }

    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: normalized,
        dimensions: this.dimension,
      });
      return response.data[0]?.embedding || this.fallbackVector(normalized);
    } catch (error) {
      this.logger.warn(`Embedding failed, fallback to local hash vector: ${(error as Error).message}`);
      return this.fallbackVector(normalized);
    }
  }

  private fallbackVector(text: string): number[] {
    const vector = new Array(this.dimension).fill(0);
    for (let i = 0; i < text.length; i += 1) {
      const idx = i % this.dimension;
      vector[idx] = (vector[idx] + text.charCodeAt(i)) / 255;
    }
    return vector;
  }
}
