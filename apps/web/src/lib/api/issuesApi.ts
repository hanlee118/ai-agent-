import { request } from './core';

export type IssueSourceType = 'text' | 'meeting_notes' | 'journey' | 'competitor';
export type ConflictSeverity = 'critical' | 'warning' | 'info';

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

export const issuesApi = {
  async preview(payload: {
    input: string;
    industryCode: string;
    sourceType?: IssueSourceType;
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
};
