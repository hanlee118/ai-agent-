import { request } from './core';

export type KnowledgeScope = 'global' | 'project' | 'agent' | 'template';
export type KnowledgeType = 'document' | 'text' | 'url' | 'code' | 'sop';
export type MemoryType = 'episodic' | 'semantic' | 'procedural';

export type KnowledgeListItem = {
  id: string;
  scope: KnowledgeScope;
  projectId: string | null;
  agentId: string | null;
  type: KnowledgeType;
  title: string;
  tags: string[];
  stageContext: string[];
  techStack: string[];
  memoryType: MemoryType | null;
  importanceScore: number | null;
  accessCount: number;
  createdAt: string;
};

export type KnowledgeDetailItem = {
  id: string;
  scope: KnowledgeScope;
  projectId: string | null;
  agentId: string | null;
  type: KnowledgeType;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  stageContext: string[];
  techStack: string[];
  memoryType: MemoryType | null;
  importanceScore: number | null;
  sourceUrl: string | null;
  filePath: string | null;
  fileType: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeCurationPreview = {
  totalItems: number;
  normalizationSuggestions: Array<{
    itemId: string;
    before: {
      title: string;
      tags: string[];
      stageContext: string[];
      techStack: string[];
    };
    after: {
      title: string;
      tags: string[];
      stageContext: string[];
      techStack: string[];
    };
    reasons: string[];
  }>;
  duplicateGroups: Array<{
    canonicalId: string;
    duplicateIds: string[];
    similarity: number;
    reason: string;
  }>;
};

export type KnowledgeCurationApplyResult = KnowledgeCurationPreview & {
  normalizedCount: number;
  mergedCount: number;
  deletedCount: number;
  operationId?: string;
};

export type KnowledgeOperationLog = {
  id: string;
  operationType: string;
  scope: string | null;
  projectId: string | null;
  agentId: string | null;
  triggeredBy: string | null;
  summary: string;
  canRollback: boolean;
  rolledBackAt: string | null;
  createdAt: string;
};

export const knowledgeApi = {
  async list(params?: {
    scope?: KnowledgeScope;
    projectId?: string;
    agentId?: string;
    type?: KnowledgeType;
    memoryType?: MemoryType;
    stageContext?: string;
    query?: string;
    limit?: number;
    offset?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.scope) query.set('scope', params.scope);
    if (params?.projectId) query.set('projectId', params.projectId);
    if (params?.agentId) query.set('agentId', params.agentId);
    if (params?.type) query.set('type', params.type);
    if (params?.memoryType) query.set('memoryType', params.memoryType);
    if (params?.stageContext) query.set('stageContext', params.stageContext);
    if (params?.query) query.set('query', params.query);
    if (typeof params?.limit === 'number') query.set('limit', String(params.limit));
    if (typeof params?.offset === 'number') query.set('offset', String(params.offset));
    const suffix = query.toString();
    return request<{ total: number; items: KnowledgeListItem[] }>(
      `/v1/knowledge${suffix ? `?${suffix}` : ''}`,
    );
  },

  async get(id: string) {
    return request<KnowledgeDetailItem>(`/v1/knowledge/${id}`);
  },

  async createText(payload: {
    title: string;
    content: string;
    scope?: KnowledgeScope;
    projectId?: string;
    agentId?: string;
    tags?: string[];
    importanceScore?: number;
  }) {
    return request<{ id: string }>('/v1/knowledge/text', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async uploadDocument(payload: {
    scope?: KnowledgeScope;
    projectId?: string;
    agentId?: string;
    tags?: string[];
    fileName?: string;
    fileContent?: string;
    file?: File;
    triggeredBy?: string;
  }) {
    if (payload.file) {
      const form = new FormData();
      form.append('file', payload.file, payload.fileName || payload.file.name || 'uploaded-file');
      if (payload.scope) form.append('scope', payload.scope);
      if (payload.projectId) form.append('projectId', payload.projectId);
      if (payload.agentId) form.append('agentId', payload.agentId);
      if (payload.tags && payload.tags.length > 0) form.append('tags', JSON.stringify(payload.tags));
      if (payload.triggeredBy) form.append('triggeredBy', payload.triggeredBy);
      return request<{ count: number; items: Array<{ id: string; title: string }> }>('/v1/knowledge/upload', {
        method: 'POST',
        body: form,
      });
    }

    return request<{ count: number; items: Array<{ id: string; title: string }> }>('/v1/knowledge/upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async update(id: string, payload: {
    scope?: KnowledgeScope;
    projectId?: string | null;
    agentId?: string | null;
    type?: KnowledgeType;
    title?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    tags?: string[];
    stageContext?: string[];
    techStack?: string[];
    memoryType?: MemoryType;
    importanceScore?: number;
    sourceUrl?: string | null;
    filePath?: string | null;
    fileType?: string | null;
  }) {
    return request<{ id: string; updatedAt: string }>(`/v1/knowledge/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async remove(id: string, options?: { triggeredBy?: string }) {
    const triggeredBy = String(options?.triggeredBy || '').trim();
    const suffix = triggeredBy ? `?triggeredBy=${encodeURIComponent(triggeredBy)}` : '';
    return request<{ id: string; deleted: boolean }>(`/v1/knowledge/${id}${suffix}`, {
      method: 'DELETE',
    });
  },

  async bulkDelete(ids: string[], triggeredBy?: string) {
    return request<{ count: number }>('/v1/knowledge/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids, triggeredBy }),
    });
  },

  async previewCuration(payload: {
    scope?: KnowledgeScope;
    projectId?: string;
    agentId?: string;
    limit?: number;
  }) {
    return request<KnowledgeCurationPreview>('/v1/knowledge/curation/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async applyCuration(payload: {
    scope?: KnowledgeScope;
    projectId?: string;
    agentId?: string;
    limit?: number;
    normalizeFields?: boolean;
    mergeDuplicates?: boolean;
    maxDuplicateGroups?: number;
    targetCanonicalIds?: string[];
    triggeredBy?: string;
  }) {
    return request<KnowledgeCurationApplyResult>('/v1/knowledge/curation/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async history(params?: {
    operationType?: string;
    projectId?: string;
    agentId?: string;
    limit?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.operationType) query.set('operationType', params.operationType);
    if (params?.projectId) query.set('projectId', params.projectId);
    if (params?.agentId) query.set('agentId', params.agentId);
    if (typeof params?.limit === 'number') query.set('limit', String(params.limit));
    const suffix = query.toString();
    return request<{ logs: KnowledgeOperationLog[] }>(`/v1/knowledge/history${suffix ? `?${suffix}` : ''}`);
  },

  async rollbackHistory(operationId: string, triggeredBy?: string) {
    return request<{ success: boolean; message: string; restoredCount: number }>(
      `/v1/knowledge/history/${operationId}/rollback`,
      {
        method: 'POST',
        body: JSON.stringify({
          triggeredBy,
        }),
      },
    );
  },

  async projectSummary(projectId: string) {
    return request<{ summary: string }>(`/v1/knowledge/project/${projectId}/summary`);
  },
};
