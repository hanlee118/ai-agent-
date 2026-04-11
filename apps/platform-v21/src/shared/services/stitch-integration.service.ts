import { Injectable, Logger } from '@nestjs/common';

export type StitchConfig = {
  useStitch?: boolean;
  requiredTools?: string[];
  webhookUrls?: string[];
};

@Injectable()
export class StitchIntegrationService {
  private readonly logger = new Logger(StitchIntegrationService.name);

  private get endpoint() {
    return process.env.STITCH_API || 'http://localhost:3010/stitch';
  }

  async maybeEnrichArtifacts(input: {
    stageKey: string;
    projectId: string;
    artifacts: Array<Record<string, unknown>>;
    config?: StitchConfig;
  }): Promise<Array<Record<string, unknown>>> {
    if (!input.config?.useStitch) {
      return input.artifacts;
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: input.projectId,
          stageKey: input.stageKey,
          artifacts: input.artifacts,
          requiredTools: input.config.requiredTools || [],
          webhookUrls: input.config.webhookUrls || [],
        }),
      });

      if (!response.ok) {
        throw new Error(`Stitch returned ${response.status}`);
      }

      const body = (await response.json()) as { artifacts?: Array<Record<string, unknown>>; meta?: unknown };
      const stitchedArtifacts = Array.isArray(body.artifacts) ? body.artifacts : [];
      const next = stitchedArtifacts.length > 0 ? stitchedArtifacts : input.artifacts;

      return [
        ...next,
        {
          name: 'stitch_trace',
          type: 'stitch',
          format: 'json',
          content: JSON.stringify({ meta: body.meta || {}, endpoint: this.endpoint }),
        },
      ];
    } catch (error) {
      this.logger.warn(`Stitch integration failed: ${(error as Error).message}`);
      return [
        ...input.artifacts,
        {
          name: 'stitch_trace',
          type: 'stitch',
          format: 'json',
          content: JSON.stringify({ failed: true, reason: (error as Error).message }),
        },
      ];
    }
  }
}
