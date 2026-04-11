import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeItem } from './entities/knowledge-item.entity';
import { KnowledgeRelation } from './entities/knowledge-relation.entity';
import { KnowledgeController } from './controllers/knowledge.controller';
import { KnowledgeRetrievalService } from './services/knowledge-retrieval.service';
import { EmbeddingService } from '../../shared/services/embedding.service';
import { LLMOrchestrationService } from '../../shared/services/llm-orchestration.service';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeItem, KnowledgeRelation])],
  controllers: [KnowledgeController],
  providers: [KnowledgeRetrievalService, EmbeddingService, LLMOrchestrationService],
  exports: [KnowledgeRetrievalService, TypeOrmModule],
})
export class KnowledgeModule {}
