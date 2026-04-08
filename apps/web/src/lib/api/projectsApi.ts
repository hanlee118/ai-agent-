import { request } from './core';
import type { Deliverable, Pagination, Project, ProjectDetail, Stage } from './types';

const toProjectPathId = (id: string) => encodeURIComponent(String(id || '').trim());

export type ParsedProjectIntent = {
  name: string;
  description: string;
  phase: string;
  agents: string[];
  team: string[];
  priority: 'High' | 'Medium' | 'Low';
};

export type ProjectAcceptanceReport = {
  projectId: string;
  projectName: string;
  generatedAt: string;
  status: string;
  currentStage: string;
  progress: number;
  pendingApproval: boolean;
  summary: {
    stageCount: number;
    deliverableCount: number;
    approvedDeliverables: number;
    blockedTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    signoffApproved: number;
    signoffRejected: number;
    signoffPending: number;
  };
  stages: Array<{
    stageType: string;
    stageLabel: string;
    assignee: string;
    status: string;
    progress: number;
    startedAt?: string;
    endedAt?: string;
    deliverables: {
      total: number;
      approved: number;
      submitted: number;
      rejected: number;
      draft: number;
      latestUpdatedAt?: string;
    };
    acceptance: {
      result: 'approved' | 'rejected' | 'pending' | 'none';
      note: string;
    };
  }>;
  signoffHistory: Array<{
    id: string;
    timestamp: string;
    stageType?: string;
    stageLabel: string;
    decision: 'approved' | 'rejected' | 'pending';
    actor: string;
    reason: string;
  }>;
  archivedReports: Array<{
    id: string;
    name: string;
    version: number;
    updatedAt: string;
  }>;
  comparison?: {
    baselineName: string;
    baselineGeneratedAt: string;
    note: string;
    delta: {
      deliverableCount: number;
      approvedDeliverables: number;
      blockedTasks: number;
      inProgressTasks: number;
      completedTasks: number;
      signoffApproved: number;
      signoffRejected: number;
      signoffPending: number;
    };
  };
  recentTimeline: Array<{
    id: string;
    timestamp: string;
    type: string;
    title: string;
    content: string;
    priority: string;
    agentId?: string;
  }>;
  recentDeliverables: Array<{
    id: string;
    stageType: string;
    name: string;
    status: string;
    version: number;
    createdBy: string;
    updatedAt: string;
    suspicious?: boolean;
    suspicionReasons?: string[];
  }>;
  dataQuality: {
    timeline: {
      totalEvents: number;
      evidenceEvents: number;
      omittedLowSignalEvents: number;
      highSignalTypes: string[];
    };
    executions: {
      total: number;
      success: number;
      failed: number;
      latestByRole: Array<{
        role: string;
        status: string;
        model: string;
        updatedAt: string;
      }>;
    };
    deliverables: {
      total: number;
      suspiciousCount: number;
      suspiciousItems: Array<{
        id: string;
        name: string;
        stageType: string;
        reasons: string[];
      }>;
    };
    warnings: string[];
  };
  qualityGate: {
    source: 'lifecycle_audit' | 'report_only';
    pass: boolean;
    blockingStageCount: number;
    blockingStages: string[];
    blockingIssues: string[];
  };
  recommendations: string[];
};

export type ProjectFinalArtifactsReport = {
  projectId: string;
  projectName: string;
  status: string;
  currentStage: string;
  generatedAt: string;
  readyForAcceptance: boolean;
  blockingIssues: string[];
  coverage: {
    required: number;
    provided: number;
    missing: number;
  };
  artifacts: Array<{
    key: string;
    category: string;
    required: boolean;
    ready: boolean;
    issue?: string;
    source: 'deliverable' | 'link';
    deliverableId?: string;
    name: string;
    stageType?: string;
    status?: string;
    version?: number;
    updatedAt?: string;
    content?: string;
    excerpt?: string;
    url?: string;
    filePath?: string;
  }>;
  missingRequired: string[];
  checklist: string[];
  generation?: {
    jobId: string;
    projectId: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    progress: number;
    step: string;
    message?: string;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
  };
};

export type ProjectCleanupCandidate = {
  id: string;
  name: string;
  status: string;
  currentStage: string;
  updatedAt: string;
  reasons: string[];
  recommended: boolean;
};

export type ProjectExecutionRecord = {
  id: string;
  projectId: string;
  stageType: string;
  role: string;
  action: string;
  status: 'success' | 'failed' | string;
  provider?: string | null;
  model?: string | null;
  requestedMode?: string | null;
  runtimeMode?: string | null;
  promptSummary?: string | null;
  outputPreview?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRequiredAction = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  action:
    | 'submit_stage_deliverable'
    | 'open_design_review'
    | 'review_pending_stage'
    | 'resolve_blocked_tasks'
    | 'reconcile_deliverables'
    | 'refresh_runtime';
  ctaLabel: string;
  reasonCode?: 'design_ambiguity';
  prefillContent?: string;
};

export type ProjectTemplateGatePrecheck = {
  projectId: string;
  stageType: string;
  stageLabel: string;
  pass: boolean;
  generatedAt: string;
  expectedNames: string[];
  items: Array<{
    expectedName: string;
    pass: boolean;
    reason: string;
    matched?: {
      id: string;
      name: string;
      stageType: string;
      version: number;
      status: string;
      createdBy: string;
      updatedAt: string;
      matchScore: number;
    };
    gate?: {
      templateKind: string;
      templateLabel: string;
      pass: boolean;
      issues: string[];
      missingSections: string[];
      missingChecklist: string[];
      hasChecklistHeading: boolean;
      contentLength: number;
      professionalRuleEnabled?: boolean;
      professionalSectionsMissing?: string[];
      professionalChecks?: Array<{
        key: string;
        label: string;
        passed: boolean;
        detail: string;
        hits: number;
        expectedMinHits: number;
      }>;
    };
    candidates: Array<{
      id: string;
      name: string;
      stageType: string;
      version: number;
      status: string;
      updatedAt: string;
      matchScore: number;
    }>;
  }>;
};

export type ProjectLifecycleQualityAudit = {
  projectId: string;
  projectName: string;
  currentStage: string;
  generatedAt: string;
  pass: boolean;
  blockingStageCount: number;
  blockingStages: string[];
  stageAudits: Array<{
    stageType: string;
    stageLabel: string;
    stageStatus: string;
    stageProgress: number;
    pass: boolean;
    issues: string[];
    deliverableChecks: Array<{
      expectedName: string;
      pass: boolean;
      status: string;
      matchedName?: string;
      matchedVersion?: number;
      issues: string[];
      gate?: {
        templateKind: string;
        templateLabel: string;
        professionalRuleEnabled: boolean;
        professionalChecks: Array<{
          key: string;
          label: string;
          passed: boolean;
          detail: string;
          hits: number;
          expectedMinHits: number;
        }>;
      };
    }>;
    executionChecks: Array<{
      role: string;
      pass: boolean;
      reason: string;
      latestStatus?: string;
      latestModel?: string;
      latestAt?: string;
    }>;
  }>;
};

export type ProjectExecutionProtocolPrecheck = {
  projectId: string;
  stageType: string;
  stageLabel: string;
  generatedAt: string;
  pass: boolean;
  issues: string[];
  blockingIssues: string[];
  protocolChecks: Array<{
    key: string;
    label: string;
    passed: boolean;
    category: 'collaboration' | 'skill' | 'content';
    detail?: string;
  }>;
  requiredSkills: string[];
  collaborationRequired: boolean;
  skillEvidenceRequired: boolean;
  collaborationSatisfiedBy: 'metadata' | 'content' | 'not_required' | 'missing';
  skillEvidenceSatisfiedBy: 'metadata' | 'content' | 'not_required' | 'missing';
  deliverableCount: number;
  executionCount: number;
  contentChecks: Array<{
    key: string;
    label: string;
    passed: boolean;
  }>;
};

export const projectsApi = {
  async list(params?: { status?: string; page?: number; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    const query = searchParams.toString();
    return request<{ data: Project[]; pagination: Pagination }>(`/projects${query ? `?${query}` : ''}`);
  },

  async get(id: string) {
    return request<Project>(`/projects/${toProjectPathId(id)}`);
  },

  async getAcceptanceReport(id: string) {
    return request<ProjectAcceptanceReport>(`/projects/${toProjectPathId(id)}/acceptance-report`);
  },

  async getFinalArtifacts(id: string) {
    return request<ProjectFinalArtifactsReport>(`/projects/${toProjectPathId(id)}/final-artifacts`);
  },

  async generateFinalArtifacts(id: string, force = false) {
    return request<{
      projectId: string;
      queued: boolean;
      generation: NonNullable<ProjectFinalArtifactsReport['generation']>;
    }>(`/projects/${toProjectPathId(id)}/final-artifacts/generate`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
  },

  async getFinalArtifactsJob(id: string, jobId: string) {
    return request<{
      projectId: string;
      generation: ProjectFinalArtifactsReport['generation'] | null;
      report?: ProjectFinalArtifactsReport;
    }>(`/projects/${toProjectPathId(id)}/final-artifacts/jobs/${encodeURIComponent(jobId)}`);
  },

  async getExecutions(id: string, limit = 120) {
    return request<{
      projectId: string;
      total: number;
      executions: ProjectExecutionRecord[];
    }>(`/projects/${toProjectPathId(id)}/executions?limit=${encodeURIComponent(String(limit))}`);
  },

  async getExecutionProtocolPrecheck(id: string) {
    return request<ProjectExecutionProtocolPrecheck>(`/projects/${toProjectPathId(id)}/execution-protocol-precheck`);
  },

  async getLifecycleQualityAudit(id: string) {
    return request<ProjectLifecycleQualityAudit>(`/projects/${toProjectPathId(id)}/lifecycle-quality-audit`);
  },

  async getCleanupCandidates() {
    return request<ProjectCleanupCandidate[]>('/projects/cleanup/candidates');
  },

  async cleanupProjects(input: { ids?: string[]; mode?: 'recommended' | 'all_candidates'; dryRun?: boolean }) {
    return request<{
      requested: number;
      deleted: Array<{ id: string; name: string }>;
      failed: Array<{ id: string; error: string }>;
      remaining: number;
    }>('/projects/cleanup', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async exportAcceptanceReportMarkdown(id: string) {
    return request<string>(`/projects/${toProjectPathId(id)}/acceptance-report.md`);
  },

  async archiveAcceptanceReport(id: string, title?: string) {
    return request<{
      projectId: string;
      archived: boolean;
      deliverableName: string;
    }>(`/projects/${toProjectPathId(id)}/acceptance-report/archive`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  },

  async getDetail(id: string) {
    return request<ProjectDetail & {
      requiredActions?: ProjectRequiredAction[];
    }>(`/projects/${toProjectPathId(id)}`);
  },

  async create(data: {
    name: string;
    description?: string;
    requirements?: string;
    team?: string[];
  }) {
    return request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async parse(input: string) {
    return request<ParsedProjectIntent>('/projects/parse', {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
  },

  async update(id: string, data: Partial<Project>) {
    return request<Project>(`/projects/${toProjectPathId(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async getStages(id: string) {
    return request<Stage[]>(`/projects/${toProjectPathId(id)}/stages`);
  },

  async getDeliverables(id: string) {
    return request<Deliverable[]>(`/projects/${toProjectPathId(id)}/deliverables`);
  },

  async submitDeliverable(
    projectId: string,
    data: {
      stage: string;
      title: string;
      content: string;
      attachments?: string[];
    },
  ) {
    return request<Deliverable>(`/projects/${toProjectPathId(projectId)}/deliverables`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async intervene(id: string, command: string) {
    return request(`/projects/${toProjectPathId(id)}/intervene`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  },

  async sendMessage(id: string, message: string) {
    return request(`/projects/${toProjectPathId(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  async resume(id: string) {
    return request(`/projects/${toProjectPathId(id)}/resume`, {
      method: 'POST',
    });
  },

  async close(id: string) {
    return request(`/projects/${toProjectPathId(id)}/close`, {
      method: 'POST',
    });
  },

  async remove(id: string) {
    return request<{ success: boolean; id: string }>(`/projects/${toProjectPathId(id)}`, {
      method: 'DELETE',
    });
  },

  async advance(id: string) {
    return request(`/projects/${toProjectPathId(id)}/advance`, {
      method: 'POST',
    });
  },

  async reconcileDeliverables(id: string) {
    return request(`/projects/${toProjectPathId(id)}/reconcile-deliverables`, {
      method: 'POST',
    });
  },

  async getTemplateGatePrecheck(id: string) {
    return request<ProjectTemplateGatePrecheck>(`/projects/${toProjectPathId(id)}/template-gate-precheck`);
  },

  async getAutomation() {
    return request<{
      enabled: boolean;
      intervalMs: number;
      running: boolean;
      lastRunAt: string | null;
      lastError: string | null;
      lastSummary: string;
    }>('/projects/automation');
  },

  async setAutomation(data: { enabled: boolean; intervalMs?: number }) {
    return request<{
      enabled: boolean;
      intervalMs: number;
      running: boolean;
      lastRunAt: string | null;
      lastError: string | null;
      lastSummary: string;
    }>('/projects/automation', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async runAutomationOnce() {
    return request<{
      enabled: boolean;
      intervalMs: number;
      running: boolean;
      lastRunAt: string | null;
      lastError: string | null;
      lastSummary: string;
    }>('/projects/automation/run', {
      method: 'POST',
    });
  },

  async submitStage(
    id: string,
    data: {
      title?: string;
      content: string;
      finalizeApproval?: boolean;
      designReview?: {
        visualDirection: string;
        brandTone: string;
        uxPrinciples: string[];
        accessibilityChecklist: string[];
        approvedBy: string;
        approved: boolean;
        notes?: string;
      };
    },
  ) {
    return request(`/projects/${toProjectPathId(id)}/stages/submit`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async approve(id: string) {
    return request(`/projects/${toProjectPathId(id)}/approve`, {
      method: 'POST',
    });
  },

  async reject(id: string, reason: string) {
    return request(`/projects/${toProjectPathId(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};
