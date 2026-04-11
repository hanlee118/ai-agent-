import { request } from './core';

export type HermesKnowledgeItem = {
  id: string;
  projectId: string | null;
  title: string;
  content: string;
  memoryType: 'episodic' | 'semantic' | 'procedural' | string | null;
  importanceScore: number | null;
  tags: string[];
  stageContext: string[];
  techStack: string[];
};

export type HermesSkillItem = {
  id: string;
  hermesSkillId: string | null;
  skillKey: string;
  name: string;
  type: string;
  instruction: string;
  manifest: Record<string, unknown>;
  sourceProjectId: string | null;
  source: string;
  isCertified: boolean;
  updatedAt: string;
};

function buildHermesHeaders(apiKey?: string) {
  const normalized = String(apiKey || '').trim();
  if (!normalized) {
    return undefined;
  }
  return {
    'x-hermes-api-key': normalized,
  };
}

export const hermesApi = {
  async exportKnowledge(params: {
    projectId?: string;
    limit?: number;
    apiKey?: string;
  }) {
    const search = new URLSearchParams();
    if (params.projectId?.trim()) {
      search.set('projectId', params.projectId.trim());
    }
    if (Number.isFinite(params.limit)) {
      search.set('limit', String(Math.max(1, Math.floor(Number(params.limit)))));
    }
    const suffix = search.toString();
    return request<{ items: HermesKnowledgeItem[] }>(
      `/v1/knowledge/for-hermes${suffix ? `?${suffix}` : ''}`,
      { headers: buildHermesHeaders(params.apiKey) },
    );
  },

  async exportSkills(params: {
    projectId?: string;
    stageType?: string;
    limit?: number;
    apiKey?: string;
  }) {
    const search = new URLSearchParams();
    if (params.projectId?.trim()) {
      search.set('projectId', params.projectId.trim());
    }
    if (params.stageType?.trim()) {
      search.set('stageType', params.stageType.trim());
    }
    if (Number.isFinite(params.limit)) {
      search.set('limit', String(Math.max(1, Math.floor(Number(params.limit)))));
    }
    const suffix = search.toString();
    return request<{ skills: HermesSkillItem[] }>(
      `/v1/skills/for-hermes${suffix ? `?${suffix}` : ''}`,
      { headers: buildHermesHeaders(params.apiKey) },
    );
  },

  async syncMemory(input: {
    title: string;
    content: string;
    memoryType?: 'episodic' | 'semantic' | 'procedural';
    projectId?: string;
    tags?: string[];
    stageContext?: string[];
    techStack?: string[];
    importanceScore?: number;
    apiKey?: string;
  }) {
    return request<{ id: string }>('/v1/knowledge/sync-from-hermes', {
      method: 'POST',
      headers: buildHermesHeaders(input.apiKey),
      body: JSON.stringify({
        projectId: input.projectId?.trim() || undefined,
        memoryType: input.memoryType || 'semantic',
        title: input.title,
        content: input.content,
        tags: input.tags || [],
        stageContext: input.stageContext || [],
        techStack: input.techStack || [],
        importanceScore: input.importanceScore,
      }),
    });
  },

  async importSkill(input: {
    projectId?: string;
    hermesSkillId?: string;
    skillData: {
      name: string;
      skillKey: string;
      instruction: string;
      type: string;
      manifest?: Record<string, unknown>;
    };
    apiKey?: string;
  }) {
    return request<{ skill: HermesSkillItem }>('/v1/skills/import/hermes', {
      method: 'POST',
      headers: buildHermesHeaders(input.apiKey),
      body: JSON.stringify({
        projectId: input.projectId?.trim() || undefined,
        hermesSkillId: input.hermesSkillId?.trim() || undefined,
        skillData: {
          ...input.skillData,
          manifest: input.skillData.manifest || {},
        },
      }),
    });
  },
};

