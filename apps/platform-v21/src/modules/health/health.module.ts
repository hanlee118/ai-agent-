import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './indicators/redis.health.indicator';

@Module({
  imports: [ConfigModule, TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
