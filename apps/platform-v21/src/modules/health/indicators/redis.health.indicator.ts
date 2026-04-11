import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { createClient } from 'redis';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async isHealthy(key = 'redis'): Promise<HealthIndicatorResult> {
    const host = this.config.get<string>('redis.host') || 'localhost';
    const port = this.config.get<number>('redis.port') || 6379;
    const db = this.config.get<number>('redis.db') || 0;

    const client = createClient({
      socket: { host, port },
      database: db,
    });

    try {
      await client.connect();
      await client.ping();
      await client.quit();
      return this.getStatus(key, true);
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      const result = this.getStatus(key, false, { message: (error as Error).message });
      throw new HealthCheckError('Redis check failed', result);
    }
  }
}
