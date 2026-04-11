import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFileLike } from '../../../shared/interfaces/uploaded-file.interface';
import { CreateTextKnowledgeDto } from '../dto/create-text-knowledge.dto';
import { HermesMemoryDto } from '../dto/hermes-memory.dto';
import { HermesKnowledgeQueryDto } from '../dto/hermes-knowledge-query.dto';
import { KnowledgeRetrievalService } from '../services/knowledge-retrieval.service';
import { UploadKnowledgeDto } from '../dto/upload-knowledge.dto';
import { SearchKnowledgeDto } from '../dto/search-knowledge.dto';
import { UpdateKnowledgeDto } from '../dto/update-knowledge.dto';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeRetrievalService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: UploadedFileLike, @Body() dto: UploadKnowledgeDto) {
    return this.knowledgeService.ingestDocument(file, dto);
  }

  @Post('text')
  async addText(@Body() dto: CreateTextKnowledgeDto) {
    const item = await this.knowledgeService.ingestText(dto);
    return { success: true, id: item.id };
  }

  @Post('search')
  async search(@Body() dto: SearchKnowledgeDto) {
    return this.knowledgeService.retrieveForAgent(dto.query, {
      projectId: dto.projectId,
      memoryTypes: dto.memoryTypes,
      agentId: dto.agentId,
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateKnowledgeDto) {
    const item = await this.knowledgeService.updateKnowledge(id, dto);
    return { success: true, id: item.id };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.knowledgeService.deleteKnowledge(id);
    return { success: true };
  }

  @Get('project/:projectId/summary')
  async getSummary(@Param('projectId') projectId: string) {
    const summary = await this.knowledgeService.getProjectSummary(projectId);
    return { summary };
  }

  @Get('for-hermes')
  async listForHermes(@Query() query: HermesKnowledgeQueryDto) {
    const items = await this.knowledgeService.listForHermes({
      projectId: query.projectId,
      limit: query.limit,
      memoryTypes: query.memoryTypes,
      query: query.query,
    });
    return { items };
  }

  @Post('sync-from-hermes')
  async syncFromHermes(@Body() dto: HermesMemoryDto) {
    const item = await this.knowledgeService.syncFromHermes(dto);
    return { success: true, id: item.id };
  }
}
