import { request } from './core';

export type GitLabHarnessSyncResult = {
  projectId: string;
  projectName: string;
  projectPath: string;
  projectIssueIid?: number;
  stageType: string;
  closeOnComplete: boolean;
  taskTotal: number;
  created: number[];
  updated: number[];
  reused: number[];
  failed: Array<{
    taskId: string;
    taskTitle: string;
    reason: string;
  }>;
};

export const gitlabHarnessApi = {
  async syncProject(input: {
    occProjectId: string;
    projectPath?: string;
    stageType?: string;
    closeOnComplete?: boolean;
  }) {
    const projectId = encodeURIComponent(String(input.occProjectId || '').trim());
    return request<GitLabHarnessSyncResult>(`/gitlab/harness/projects/${projectId}/sync`, {
      method: 'POST',
      body: JSON.stringify({
        projectPath: input.projectPath,
        stageType: input.stageType,
        closeOnComplete: input.closeOnComplete,
      }),
    });
  },
};
