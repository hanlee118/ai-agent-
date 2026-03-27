import type {
  AgentProfile,
  AuditLogItem,
  AuthLoginInput,
  OpenClawBatchAgentCommandResult,
  OpenClawBatchAgentMessageInput,
  OpenClawBatchTaskUpdateInput,
  OpenClawAgentCommandResult,
  OpenClawCreateAgentInput,
  OpenClawAgentSlaItem,
  OpenClawAgentMessageInput,
  OpenClawMemoryEntryInput,
  OpenClawAgentSettingsInput,
  AuthSetupInput,
  AuthStatus,
  CreateProjectInput,
  OpenClawAgentDetail,
  OpenClawInstructionPreview,
  OpenClawInstructionPreviewInput,
  OpenClawAgentSummary,
  OpenClawDocumentUpdateInput,
  OpenClawProjectDetail,
  OpenClawProjectReport,
  OpenClawStatusSummary,
  OpenClawTaskUpdateInput,
  OpenClawWorkspaceOverview,
  ParsedIntent,
  ProjectMessageInput,
  ProjectDetail,
  ProjectSummary,
  RuntimeSettings,
  RuntimeSettingsInput,
  RuntimeStatus,
  RuntimeValidationResult,
  StageRejectInput,
  StageSubmissionInput,
  SystemHealth,
  LocalAgentMonitorOverview,
  NotificationInboxItem,
  NotificationInboxUpdateInput,
  PromptTemplate,
  PromptTemplateChannel,
  PromptTemplateUpsertInput,
  Task,
  TaskBoardItem,
  TaskUpdateInput,
  SystemReadiness
} from "@occ/shared";

const configuredApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
const API_BASE_URL = configuredApiBaseUrl || resolveDefaultApiBaseUrl();

function resolveDefaultApiBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  if (window.location.port === "5173") {
    return "http://localhost:8787";
  }

  return window.location.origin;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    credentials: "include",
    ...init
  });

  if (!response.ok) {
    const body = await response.text();
    let message = body || "Request failed";

    try {
      const payload = JSON.parse(body) as { message?: string };
      message = payload.message || message;
    } catch {
      // keep original body text
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

async function requestRuntimeValidation(path: string, init?: RequestInit): Promise<RuntimeValidationResult> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    credentials: "include",
    ...init
  });

  const payload = (await response.json()) as RuntimeValidationResult;
  return payload;
}

export const api = {
  getAuthStatus: () => request<AuthStatus>("/api/auth/status"),
  setupAuth: (payload: AuthSetupInput) =>
    request<AuthStatus>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  loginAuth: (payload: AuthLoginInput) =>
    request<AuthStatus>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  logoutAuth: () =>
    request<{ ok: boolean }>("/api/auth/logout", {
      method: "POST"
    }),
  getProjects: () => request<ProjectSummary[]>("/api/projects"),
  previewProject: (description: string) =>
    request<ParsedIntent>("/api/projects/preview", {
      method: "POST",
      body: JSON.stringify({ description })
    }),
  createProject: (payload: CreateProjectInput) =>
    request<ProjectDetail>("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getRuntime: () => request<RuntimeStatus>("/api/system/runtime"),
  getAuditLogs: (limit = 50) => request<AuditLogItem[]>(`/api/system/audit-logs?limit=${limit}`),
  getRuntimeSettings: () => request<RuntimeSettings>("/api/system/runtime/config"),
  updateRuntimeSettings: (payload: RuntimeSettingsInput) =>
    request<RuntimeSettings>("/api/system/runtime/config", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  validateRuntimeSettings: () =>
    requestRuntimeValidation("/api/system/runtime/validate", {
      method: "POST"
    }),
  getSystemHealth: () => request<SystemHealth>("/api/system/health"),
  getSystemReadiness: () => request<SystemReadiness>("/api/system/readiness"),
  getLocalAgentMonitor: () => request<LocalAgentMonitorOverview>("/api/system/local-agent-monitor"),
  localAgentMonitorLiveUrl: () => `${API_BASE_URL}/api/system/local-agent-monitor/live`,
  getNotifications: (locale: "zh-CN" | "en-US") => request<NotificationInboxItem[]>(`/api/notifications?locale=${encodeURIComponent(locale)}`),
  updateNotification: (sourceKey: string, payload: NotificationInboxUpdateInput) =>
    request<NotificationInboxItem>(`/api/notifications/${encodeURIComponent(sourceKey)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  getPromptTemplates: (channel: PromptTemplateChannel, locale: "zh-CN" | "en-US", projectId?: string) =>
    request<PromptTemplate[]>(`/api/prompt-templates?channel=${encodeURIComponent(channel)}&locale=${encodeURIComponent(locale)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`),
  createPromptTemplate: (payload: PromptTemplateUpsertInput) =>
    request<PromptTemplate>("/api/prompt-templates", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  markPromptTemplateUsed: (templateId: string) =>
    request<PromptTemplate>(`/api/prompt-templates/${encodeURIComponent(templateId)}/use`, {
      method: "POST"
    }),
  getProject: (projectId: string) => request<ProjectDetail>(`/api/projects/${projectId}`),
  getProjectTasks: (projectId: string) => request<Task[]>(`/api/projects/${projectId}/tasks`),
  getTasks: () => request<TaskBoardItem[]>("/api/tasks"),
  getOpenClawWorkspace: () => request<OpenClawWorkspaceOverview>("/api/openclaw/workspace"),
  getOpenClawStatus: (refresh = false) =>
    request<OpenClawStatusSummary>(`/api/openclaw/status${refresh ? "?refresh=true" : ""}`),
  getOpenClawProjects: () => request<OpenClawProjectDetail[]>("/api/openclaw/projects"),
  getOpenClawProject: (projectId: string) =>
    request<OpenClawProjectDetail>(`/api/openclaw/projects/${projectId}`),
  updateOpenClawTask: (projectId: string, taskId: string, payload: OpenClawTaskUpdateInput) =>
    request<OpenClawProjectDetail>(`/api/openclaw/projects/${projectId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  updateOpenClawTasks: (projectId: string, payload: OpenClawBatchTaskUpdateInput) =>
    request<OpenClawProjectDetail>(`/api/openclaw/projects/${projectId}/tasks`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  getOpenClawProjectReport: (projectId: string) =>
    request<OpenClawProjectReport>(`/api/openclaw/projects/${projectId}/report`),
  getOpenClawAgents: () => request<OpenClawAgentSummary[]>("/api/openclaw/agents"),
  createOpenClawAgent: (payload: OpenClawCreateAgentInput) =>
    request<OpenClawAgentDetail>("/api/openclaw/agents", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getOpenClawAgent: (agentId: string) =>
    request<OpenClawAgentDetail>(`/api/openclaw/agents/${agentId}`),
  updateOpenClawAgentSettings: (agentId: string, payload: OpenClawAgentSettingsInput) =>
    request<OpenClawAgentDetail>(`/api/openclaw/agents/${agentId}/settings`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  previewOpenClawAgentInstruction: (agentId: string, payload: OpenClawInstructionPreviewInput) =>
    request<OpenClawInstructionPreview>(`/api/openclaw/agents/${agentId}/preview`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateOpenClawSoul: (agentId: string, payload: OpenClawDocumentUpdateInput) =>
    request<OpenClawAgentDetail>(`/api/openclaw/agents/${agentId}/soul`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  updateOpenClawSop: (agentId: string, payload: OpenClawDocumentUpdateInput) =>
    request<OpenClawAgentDetail>(`/api/openclaw/agents/${agentId}/sop`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  sendOpenClawAgentMessage: (agentId: string, payload: OpenClawAgentMessageInput) =>
    request<OpenClawAgentCommandResult>(`/api/openclaw/agents/${agentId}/message`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  addOpenClawAgentMemory: (agentId: string, payload: OpenClawMemoryEntryInput) =>
    request<OpenClawAgentDetail>(`/api/openclaw/agents/${agentId}/memory`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  sendOpenClawBatchAgentMessage: (payload: OpenClawBatchAgentMessageInput) =>
    request<OpenClawBatchAgentCommandResult>("/api/openclaw/agents/batch-message", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getOpenClawSla: () => request<OpenClawAgentSlaItem[]>("/api/openclaw/sla"),
  approveProject: (projectId: string) =>
    request<ProjectDetail>(`/api/projects/${projectId}/approve`, { method: "POST" }),
  rejectProject: (projectId: string, payload: StageRejectInput) =>
    request<ProjectDetail>(`/api/projects/${projectId}/reject`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  submitStage: (projectId: string, payload: StageSubmissionInput) =>
    request<ProjectDetail>(`/api/projects/${projectId}/stages/submit`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  sendMessage: (projectId: string, payload: ProjectMessageInput) =>
    request<ProjectDetail>(`/api/projects/${projectId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  interveneProject: (projectId: string, command: string) =>
    request<ProjectDetail>(`/api/projects/${projectId}/intervene`, {
      method: "POST",
      body: JSON.stringify({ command })
    }),
  resumeProject: (projectId: string) =>
    request<ProjectDetail>(`/api/projects/${projectId}/resume`, { method: "POST" }),
  getAgents: () => request<AgentProfile[]>("/api/agents"),
  updateTask: (taskId: string, payload: TaskUpdateInput) =>
    request<Task>(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  liveUrl: (projectId: string) => `${API_BASE_URL}/api/projects/${projectId}/live`
};
