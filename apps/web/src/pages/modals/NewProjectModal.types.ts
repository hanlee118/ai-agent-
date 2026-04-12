export type NewProjectModalProps = {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onProjectCreated?: (
    project: { id: string; name?: string },
    meta?: {
      issueId?: string;
      deferredDebateTask?: {
        taskId: string;
        status: 'queued' | 'running' | 'completed' | 'failed';
      } | null;
    },
  ) => Promise<void> | void;
};

export type Priority = 'High' | 'Medium' | 'Low';

export type ParsedProjectDraft = {
  name: string;
  description: string;
  phase: string;
  agents: string[];
  priority: Priority;
  team: string[];
};

export type IssueEditableDraft = {
  summary: string;
  problemStatement: string;
  expectedOutcome: string;
  inScopeDraft: string;
  outOfScopeDraft: string;
  acceptanceDraft: string;
  missionAnchor: string;
  matchedGoals: string;
  matchedPrinciples: string;
  contextNotes: string;
  designTheme: string;
  valueNarrative: string;
  targetUsers: string;
  coreScenarios: string;
  contractObjective: string;
  contractInScope: string;
  contractOutOfScope: string;
  contractAcceptance: string;
};

export type AgentRecommendation = {
  agentId: string;
  roleId: string;
  name: string;
  role: string;
  reason: string;
  score: number;
};

export type ClarificationAnswers = {
  deliveryDepth: '' | 'MVP闭环' | '核心流程+管理后台' | '完整一期';
  timeline: '' | '1小时内' | '24小时内' | '1周内' | '2周内' | '1个月内' | '排期待定' | '自定义';
  customTimeline: string;
  collaboration: '' | '并行推进' | '串行推进' | '先分析后研发';
  confirmScope: boolean;
  confirmExecution: boolean;
  successCriteria: string;
  extraConstraints: string;
};

export type NewProjectFormData = {
  name: string;
  description: string;
  priority: Priority;
  dueDate: string;
  agentIds: string[];
};

export type ModalStep = 'input' | 'analysis' | 'team' | 'confirm';
