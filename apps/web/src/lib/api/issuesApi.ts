import { request } from './core';

export type IssueSourceType =
  | 'text'
  | 'meeting_notes'
  | 'journey'
  | 'competitor'
  | 'file_import'
  | 'prd';
export type ConflictSeverity = 'critical' | 'warning' | 'info';
export type IssueDebateTaskStatus = 'queued' | 'running' | 'completed' | 'failed';
export type IssueContentSource = 'model_debate' | 'rule_draft' | 'fallback';

export interface IssueAnalysisGate {
  canProceed: boolean;
  blockers: string[];
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
  runtimeMode: string;
  requestedRuntimeMode: string;
}

export interface IssueListItem {
  id: string;
  title: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  industryCode?: string;
  createdProjectId?: string;
  updatedAt?: string;
  debateStatus?: IssueDebateTaskStatus | string;
}

export interface IssueConflict {
  id: string;
  severity: ConflictSeverity;
  title: string;
  detail: string;
  suggestion?: string;
}

export interface IssueQuestion {
  id: string;
  question: string;
  required: boolean;
  placeholder?: string;
}

export interface IssueContentProvenance {
  formalReady: boolean;
  note: string;
  summary: IssueContentSource;
  refinement: IssueContentSource;
  contextAlignment: IssueContentSource;
  designBlueprint: IssueContentSource;
  suggestedAnswers: IssueContentSource;
  requirementContract: IssueContentSource;
  discussion: IssueContentSource;
  discussionDraft: IssueContentSource;
}

export interface IssuePreview {
  issueId: string;
  title: string;
  summary: string;
  industryCode: string;
  recommendedRoleIds: string[];
  soulRoleId: string;
  conflicts: IssueConflict[];
  questions: IssueQuestion[];
  refinement: {
    problemStatement: string;
    expectedOutcome: string;
    inScopeDraft: string[];
    outOfScopeDraft: string[];
    acceptanceDraft: string[];
  };
  contextAlignment: {
    productName: string;
    missionAnchor: string;
    matchedGoals: string[];
    matchedPrinciples: string[];
    contextNotes: string[];
  };
  designBlueprint: {
    designTheme: string;
    valueNarrative: string;
    targetUsers: string[];
    coreScenarios: string[];
    proposedMilestones: string[];
  };
  suggestedAnswers: Array<{
    questionId: string;
    answer: string;
    reason: string;
  }>;
  relatedHistory: Array<{
    id: string;
    issueId: string;
    projectId: string;
    title: string;
    status: 'planned' | 'in_progress' | 'done';
    validationStatus: 'pending' | 'matched' | 'mismatch';
    relevance: number;
    hint: string;
  }>;
  requirementContract: {
    objective: string;
    inScope: string[];
    outOfScope: string[];
    acceptanceCriteria: string[];
    artifacts: string[];
    designTheme?: string;
    valueNarrative?: string;
  };
  discussion: Array<{
    id: string;
    roleId: string;
    roleLabel: string;
    focus: string;
    concern: string;
    proposal: string;
  }>;
  discussionDraft: Array<{
    id: string;
    roleId: string;
    roleLabel: string;
    focus: string;
    concern: string;
    proposal: string;
  }>;
  debate?: {
    mode: 'model' | 'fallback';
    generatedAt: string;
    consensus: string[];
    divergences: string[];
    note?: string;
    opinions: Array<{
      id: string;
      roleId: string;
      roleLabel: string;
      focus: string;
      concern: string;
      proposal: string;
      provider: string;
      model: string;
      elapsedMs: number;
      mode: 'model' | 'scripted' | 'fallback';
      rawPreview: string;
    }>;
  } | null;
  debateTask?: {
    taskId: string;
    status: IssueDebateTaskStatus;
    pollAfterMs?: number;
  } | null;
  analysisGate: IssueAnalysisGate;
  contentProvenance: IssueContentProvenance;
  expectedArtifacts: Array<{
    id: string;
    name: string;
    description: string;
    stageType: 'INIT' | 'ANALYSIS' | 'DESIGN' | 'DEV' | 'ACCEPT';
    ownerRoleId: string;
  }>;
  workflow: {
    id: string;
    name: string;
    steps: Array<{
      order: number;
      roleId: string;
      title: string;
      input: string;
      output: string;
    }>;
  } | null;
}

export interface IssueDebatePollingResult {
  issueId: string;
  taskId: string | null;
  status: IssueDebateTaskStatus;
  summary: IssuePreview['summary'];
  refinement: IssuePreview['refinement'] | null;
  contextAlignment: IssuePreview['contextAlignment'] | null;
  designBlueprint: IssuePreview['designBlueprint'] | null;
  suggestedAnswers: IssuePreview['suggestedAnswers'];
  requirementContract: IssuePreview['requirementContract'] | null;
  discussion: IssuePreview['discussion'];
  discussionDraft: IssuePreview['discussionDraft'];
  debate: IssuePreview['debate'];
  contentProvenance: IssueContentProvenance;
  analysisGate: IssuePreview['analysisGate'];
  error?: string | null;
  updatedAt: string;
  pollAfterMs?: number;
}

export const issuesApi = {
  async list(status?: 'draft' | 'confirmed' | 'cancelled') {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return request<IssueListItem[]>(`/issues${query}`);
  },

  async preview(payload: {
    input: string;
    industryCode: string;
    sourceType?: IssueSourceType;
    debateMode?: 'auto' | 'model' | 'off';
  }) {
    return request<IssuePreview>('/issues/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async confirm(issueId: string, payload: {
    clarificationAnswers?: Record<string, string>;
    finalName?: string;
    finalDescription?: string;
    teamRoleIds?: string[];
    conflictResolution?: string;
    projectType?: 'complete' | 'standalone' | 'relay';
    parentProjectId?: string;
    relaySourceStageId?: string;
    projectInputs?: Array<{
      name: string;
      type: string;
      description?: string;
      content?: string;
      filePath?: string;
      referenceDeliverableId?: string;
      inputSource?: 'manual' | 'imported_from_project' | 'template_generated';
    }>;
    workflowTemplateKey?: string;
    autoStartWorkflow?: boolean;
  }) {
    return request<{
      issue: {
        id: string;
        status: string;
        createdProjectId?: string;
      };
      project: {
        id: string;
        name: string;
      };
      backfill: {
        summary: string;
        teamRoleIds: string[];
      };
    }>(`/issues/${encodeURIComponent(issueId)}/confirm`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async cancel(issueId: string) {
    return request(`/issues/${encodeURIComponent(issueId)}/cancel`, {
      method: 'POST',
    });
  },

  async getDebate(issueId: string, taskId?: string) {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
    return request<IssueDebatePollingResult>(`/issues/${encodeURIComponent(issueId)}/debate${query}`);
  },
};
