import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { extname } from 'node:path';
import * as mammoth from 'mammoth';
import pdf from 'pdf-parse';
import { MemoryType } from '../../../shared/enums';
import { UploadedFileLike } from '../../../shared/interfaces/uploaded-file.interface';
import { EmbeddingService } from '../../../shared/services/embedding.service';
import { LLMOrchestrationService } from '../../../shared/services/llm-orchestration.service';
import { UploadKnowledgeDto } from '../dto/upload-knowledge.dto';
import { KnowledgeItem } from '../entities/knowledge-item.entity';
import { KnowledgeRelation } from '../entities/knowledge-relation.entity';

type KnowledgeSearchOptions = {
  projectId?: string;
  memoryTypes?: string[];
  agentId?: string;
};

type ExtractedMetadata = {
  title?: string;
  tags?: string[];
  stageContext?: string[];
  techStack?: string[];
  memoryType?: 'episodic' | 'semantic' | 'procedural';
  importanceScore?: number;
};

@Injectable()
export class KnowledgeRetrievalService {
  private readonly logger = new Logger(KnowledgeRetrievalService.name);

  constructor(
    @InjectRepository(KnowledgeItem)
    private readonly knowledgeRepo: Repository<KnowledgeItem>,
    @InjectRepository(KnowledgeRelation)
    private readonly relationRepo: Repository<KnowledgeRelation>,
    private readonly embeddingService: EmbeddingService,
    private readonly llmService: LLMOrchestrationService,
  ) {}

  async ingestDocument(file: UploadedFileLike, dto: UploadKnowledgeDto) {
    const text = await this.extractText(file);
    const chunks = this.chunk(text, 1200, 120);
    const scope = dto.scope || 'project';

    const saved: KnowledgeItem[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const content = chunks[i];
      const extracted = await this.extractKnowledgeMetadata(content, {
        fallbackTitle: `${file.originalname} - part ${i + 1}`,
      });

      const item = this.knowledgeRepo.create({
        scope,
        projectId: dto.projectId,
        agentId: dto.agentId,
        type: 'document',
        title: extracted.title || `${file.originalname} - part ${i + 1}`,
        content,
        memoryType: extracted.memoryType as MemoryType,
        importanceScore: extracted.importanceScore ?? 0.6,
        metadata: {
          chunkIndex: i,
          totalChunks: chunks.length,
          sourceFile: file.originalname,
        },
        tags: [...new Set([...(dto.tags || []), ...(extracted.tags || [])])],
        stageContext: extracted.stageContext || [],
        techStack: extracted.techStack || [],
        accessCount: 0,
        fileType: file.mimetype,
      });

      item.contentVector = await this.embeddingService.embed(content);
      saved.push(await this.knowledgeRepo.save(item));
    }

    for (let i = 0; i < saved.length - 1; i += 1) {
      await this.relationRepo.save(
        this.relationRepo.create({
          sourceId: saved[i].id,
          targetId: saved[i + 1].id,
          relationType: 'relates_to',
          strength: 0.8,
        }),
      );
    }

    return {
      count: saved.length,
      items: saved.map((item) => ({ id: item.id, title: item.title })),
    };
  }

  async ingestText(input: {
    title: string;
    content: string;
    scope: 'global' | 'project' | 'agent' | 'template';
    projectId?: string;
    agentId?: string;
    tags?: string[];
    stageContext?: string[];
    techStack?: string[];
    importanceScore?: number;
    memoryType?: 'episodic' | 'semantic' | 'procedural';
  }) {
    const extracted = await this.extractKnowledgeMetadata(input.content, {
      fallbackTitle: input.title,
    });

    const item = this.knowledgeRepo.create({
      scope: input.scope,
      projectId: input.projectId,
      agentId: input.agentId,
      type: 'text',
      title: input.title || extracted.title || 'Manual text knowledge',
      content: input.content,
      memoryType: (input.memoryType || extracted.memoryType || MemoryType.SEMANTIC) as MemoryType,
      importanceScore: input.importanceScore ?? extracted.importanceScore ?? 0.5,
      tags: [...new Set([...(input.tags || []), ...(extracted.tags || [])])],
      stageContext: [...new Set([...(input.stageContext || []), ...(extracted.stageContext || [])])],
      techStack: [...new Set([...(input.techStack || []), ...(extracted.techStack || [])])],
      metadata: { source: 'manual_text' },
      accessCount: 0,
    });

    item.contentVector = await this.embeddingService.embed(item.content);
    return this.knowledgeRepo.save(item);
  }

  async updateKnowledge(
    id: string,
    input: Partial<{
      title: string;
      content: string;
      tags: string[];
      stageContext: string[];
      techStack: string[];
      importanceScore: number;
      memoryType: 'episodic' | 'semantic' | 'procedural';
    }>,
  ) {
    const entity = await this.knowledgeRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Knowledge item not found: ${id}`);
    }

    if (typeof input.title === 'string') {
      entity.title = input.title;
    }

    if (typeof input.content === 'string') {
      entity.content = input.content;
      entity.contentVector = await this.embeddingService.embed(input.content);
    }

    if (Array.isArray(input.tags)) {
      entity.tags = input.tags;
    }

    if (Array.isArray(input.stageContext)) {
      entity.stageContext = input.stageContext;
    }

    if (Array.isArray(input.techStack)) {
      entity.techStack = input.techStack;
    }

    if (typeof input.importanceScore === 'number') {
      entity.importanceScore = Math.max(0, Math.min(1, input.importanceScore));
    }

    if (input.memoryType) {
      entity.memoryType = input.memoryType as MemoryType;
    }

    return this.knowledgeRepo.save(entity);
  }

  async deleteKnowledge(id: string): Promise<void> {
    const result = await this.knowledgeRepo.delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Knowledge item not found: ${id}`);
    }
  }

  async retrieveForAgent(query: string, options: KnowledgeSearchOptions) {
    const queryEmbedding = await this.embeddingService.embed(query);
    const where: Array<FindOptionsWhere<KnowledgeItem>> = [{ scope: 'global' }];
    if (options.projectId) {
      where.push({ scope: 'project', projectId: options.projectId });
    }
    if (options.agentId) {
      where.push({ scope: 'agent', agentId: options.agentId });
    }

    const records = await this.knowledgeRepo.find({
      where,
      order: { updatedAt: 'DESC' },
      take: 200,
    });

    const filtered = records.filter((item) => {
      if (options.memoryTypes && options.memoryTypes.length > 0) {
        return item.memoryType ? options.memoryTypes.includes(item.memoryType) : false;
      }
      return true;
    });

    const scored = filtered
      .map((item) => {
        const embeddingScore = this.cosine(queryEmbedding, item.contentVector || []);
        const keywordScore = this.keywordScore(query, `${item.title} ${item.content}`);
        const finalScore = embeddingScore * 0.7 + keywordScore * 0.3;
        return {
          id: item.id,
          title: item.title,
          content: item.content,
          memoryType: item.memoryType,
          score: Number(finalScore.toFixed(4)),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    this.bumpAccessCount(scored.map((item) => item.id)).catch((error) => {
      this.logger.warn(`Failed to bump access count: ${(error as Error).message}`);
    });

    return scored;
  }

  async buildExecutionContext(input: {
    projectId?: string;
    stageType: string;
    agentId?: string;
    taskDescription: string;
  }): Promise<Record<string, unknown>> {
    const related = await this.retrieveForAgent(input.taskDescription, {
      projectId: input.projectId,
      agentId: input.agentId,
      memoryTypes: ['episodic', 'semantic', 'procedural'],
    });

    const compact = related.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.content.slice(0, 350),
      score: item.score,
    }));

    const contextSummary = await this.llmService.complete(
      [
        '你是 Agent 执行上下文压缩器。请将以下知识条目压缩为任务可执行上下文。',
        `Stage: ${input.stageType}`,
        `Task: ${input.taskDescription}`,
        `Knowledge: ${JSON.stringify(compact)}`,
        '输出控制在 180 字以内，聚焦执行约束、风险、可复用经验。',
      ].join('\n'),
    );

    return {
      stageType: input.stageType,
      task: input.taskDescription,
      summary: contextSummary,
      knowledge: compact,
    };
  }

  async ingestStageArtifacts(input: {
    projectId: string;
    stageKey: string;
    stageId: string;
    agentId?: string;
    artifacts: Array<Record<string, unknown>>;
  }): Promise<string[]> {
    const savedIds: string[] = [];

    for (const artifact of input.artifacts) {
      const rawContent =
        typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content || artifact, null, 2);
      const content = rawContent.slice(0, 3000);

      const extracted = await this.extractKnowledgeMetadata(content, {
        fallbackTitle: `${input.stageKey} - ${String(artifact.name || artifact.type || 'artifact')}`,
      });

      const entity = this.knowledgeRepo.create({
        scope: 'project',
        projectId: input.projectId,
        agentId: input.agentId,
        type: 'text',
        title: extracted.title || `${input.stageKey} knowledge`,
        content,
        memoryType: MemoryType.EPISODIC,
        importanceScore: extracted.importanceScore ?? 0.7,
        tags: [...new Set([...(extracted.tags || []), input.stageKey, 'stage-output'])],
        stageContext: [...new Set([...(extracted.stageContext || []), input.stageKey])],
        techStack: extracted.techStack || [],
        metadata: {
          source: 'stage_output',
          stageId: input.stageId,
          artifactName: artifact.name,
          artifactType: artifact.type,
        },
        accessCount: 0,
      });

      entity.contentVector = await this.embeddingService.embed(content);
      const saved = await this.knowledgeRepo.save(entity);
      savedIds.push(saved.id);
    }

    return savedIds;
  }

  async getProjectSummary(projectId: string): Promise<string> {
    const items = await this.knowledgeRepo.find({
      where: { projectId, scope: 'project' },
      order: { updatedAt: 'DESC' },
      take: 20,
    });

    if (items.length === 0) {
      return '暂无项目知识记录。';
    }

    const synopsis = items.map((item) => `- ${item.title}: ${item.content.slice(0, 100)}`).join('\n');
    return this.llmService.complete(
      `请总结该项目的历史经验，100字以内：\n${synopsis}`,
    );
  }

  async listForHermes(input: {
    projectId?: string;
    limit?: number;
    memoryTypes?: Array<'episodic' | 'semantic' | 'procedural'>;
    query?: string;
  }) {
    const where = input.projectId
      ? [{ scope: 'global' as const }, { scope: 'project' as const, projectId: input.projectId }]
      : [{ scope: 'global' as const }];
    const items = await this.knowledgeRepo.find({
      where,
      order: { updatedAt: 'DESC' },
      take: Math.min(input.limit || 20, 100),
    });

    const queryTerm = String(input.query || '').trim().toLowerCase();
    return items
      .filter((item) => {
        const memoryPass = input.memoryTypes?.length
          ? Boolean(item.memoryType && input.memoryTypes.includes(item.memoryType as 'episodic' | 'semantic' | 'procedural'))
          : true;
        if (!memoryPass) {
          return false;
        }
        if (!queryTerm) {
          return true;
        }
        const target = `${item.title} ${item.content}`.toLowerCase();
        return target.includes(queryTerm);
      })
      .map((item) => ({
      id: item.id,
      scope: item.scope,
      projectId: item.projectId,
      title: item.title,
      content: item.content,
      tags: item.tags,
      memoryType: item.memoryType,
      stageContext: item.stageContext,
      techStack: item.techStack,
    }));
  }

  async syncFromHermes(input: {
    projectId?: string;
    title?: string;
    content: string;
    tags?: string[];
    stageContext?: string[];
    techStack?: string[];
    memoryType?: 'episodic' | 'semantic' | 'procedural';
    importanceScore?: number;
  }) {
    return this.ingestText({
      title: input.title || 'Synced from Hermes',
      content: input.content,
      scope: input.projectId ? 'project' : 'global',
      projectId: input.projectId,
      tags: [...new Set([...(input.tags || []), 'synced-hermes'])],
      stageContext: input.stageContext,
      techStack: input.techStack,
      memoryType: input.memoryType,
      importanceScore: input.importanceScore,
    });
  }

  private async extractKnowledgeMetadata(
    content: string,
    input: { fallbackTitle: string },
  ): Promise<ExtractedMetadata> {
    const fallback: ExtractedMetadata = {
      title: input.fallbackTitle,
      tags: this.detectTags(content),
      stageContext: [],
      techStack: this.detectTags(content),
      memoryType: 'semantic',
      importanceScore: 0.5,
    };

    const prompt = [
      '你是知识提取器。将下面文本提取为结构化 JSON。',
      '返回 JSON 字段：title, tags(string[]), stageContext(string[]), techStack(string[]), memoryType, importanceScore(0-1)。',
      '若无法判断请返回合理默认值。',
      '文本如下：',
      content.slice(0, 1800),
    ].join('\n');

    return this.llmService.completeJson<ExtractedMetadata>(prompt, fallback);
  }

  private async extractText(file: UploadedFileLike): Promise<string> {
    const extension = extname(file.originalname).toLowerCase();

    if (extension === '.pdf') {
      const result = await pdf(file.buffer);
      return result.text || '';
    }

    if (extension === '.docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return result.value || '';
    }

    return file.buffer.toString('utf-8');
  }

  private chunk(text: string, size: number, overlap: number): string[] {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return [];
    }

    const output: string[] = [];
    let start = 0;
    while (start < normalized.length) {
      const end = Math.min(start + size, normalized.length);
      output.push(normalized.slice(start, end));
      if (end === normalized.length) {
        break;
      }
      start = Math.max(0, end - overlap);
    }

    return output;
  }

  private detectTags(content: string): string[] {
    const dictionary = ['typescript', 'nestjs', 'react', 'vue', 'postgres', 'redis', 'docker', 'qa', 'api'];
    const text = content.toLowerCase();
    return dictionary.filter((tag) => text.includes(tag));
  }

  private keywordScore(query: string, text: string): number {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
      return 0;
    }

    const target = text.toLowerCase();
    const hit = terms.filter((term) => target.includes(term)).length;
    return hit / terms.length;
  }

  private cosine(a: number[], b: number[]) {
    if (!a.length || !b.length) {
      return 0;
    }

    const length = Math.min(a.length, b.length);
    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < length; i += 1) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    if (magA === 0 || magB === 0) {
      return 0;
    }

    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  private async bumpAccessCount(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    await this.knowledgeRepo
      .createQueryBuilder()
      .update(KnowledgeItem)
      .set({
        accessCount: () => '"access_count" + 1',
        lastAccessedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id IN (:...ids)', { ids })
      .execute();
  }
}
