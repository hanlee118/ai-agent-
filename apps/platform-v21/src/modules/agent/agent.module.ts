import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentInstance } from './entities/agent-instance.entity';
import { AgentRouterService } from './services/agent-router.service';
import { HermesAdapter } from './adapters/hermes.adapter';
import { OpenClawAdapter } from './adapters/openclaw.adapter';
import { HermesMcpClientService } from '../../shared/services/hermes-mcp-client.service';
import { OpenClawClientService } from '../../shared/services/openclaw-client.service';

@Module({
  imports: [TypeOrmModule.forFeature([AgentInstance])],
  providers: [
    AgentRouterService,
    HermesAdapter,
    OpenClawAdapter,
    HermesMcpClientService,
    OpenClawClientService,
  ],
  exports: [AgentRouterService, HermesAdapter, OpenClawAdapter, TypeOrmModule],
})
export class AgentModule {}
