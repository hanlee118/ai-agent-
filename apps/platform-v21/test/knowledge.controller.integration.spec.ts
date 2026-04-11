import { Test } from '@nestjs/testing';
import { KnowledgeController } from '../src/modules/knowledge/controllers/knowledge.controller';
import { KnowledgeRetrievalService } from '../src/modules/knowledge/services/knowledge-retrieval.service';

describe('KnowledgeController Integration', () => {
  it('handles text knowledge creation and search with service wiring', async () => {
    const knowledgeService = {
      ingestDocument: jest.fn(),
      ingestText: jest.fn().mockResolvedValue({ id: 'k-1' }),
      retrieveForAgent: jest.fn().mockResolvedValue([{ id: 'k-1', title: 'demo', content: 'text', score: 0.9 }]),
      updateKnowledge: jest.fn(),
      deleteKnowledge: jest.fn(),
      getProjectSummary: jest.fn(),
      listForHermes: jest.fn(),
      syncFromHermes: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [{ provide: KnowledgeRetrievalService, useValue: knowledgeService }],
    }).compile();

    const controller = module.get(KnowledgeController);

    const createResult = await controller.addText({
      title: 'demo',
      content: 'knowledge text',
      scope: 'project',
      projectId: '11111111-1111-1111-1111-111111111111',
    } as never);
    expect(createResult).toEqual({ success: true, id: 'k-1' });

    const searchResult = await controller.search({
      query: 'knowledge',
      projectId: '11111111-1111-1111-1111-111111111111',
    } as never);
    expect(Array.isArray(searchResult)).toBe(true);
    expect(knowledgeService.retrieveForAgent).toHaveBeenCalled();
  });
});
