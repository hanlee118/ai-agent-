export async function apiRequest<T>(
  apiUrl: string,
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: init?.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `occ_session=${token}`,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `api ${init?.method || 'GET'} ${path} failed: ${response.status}${detail ? ` body=${detail}` : ''}`,
    );
  }
  return await response.json() as T;
}

export async function loginAsAdminToken(apiUrl: string): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: process.env.ADMIN_PASSWORD || 'Admin123!@#',
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`admin login failed: ${response.status}${detail ? ` body=${detail}` : ''}`);
      }
      const rawSetCookie = response.headers.get('set-cookie') || '';
      const match = rawSetCookie.match(/occ_session=([^;]+)/);
      const token = match?.[1] || '';
      if (!token) {
        throw new Error('admin login did not return occ_session cookie');
      }
      return token;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
    }
  }
  throw lastError || new Error('admin login failed');
}

type ProjectCreatePayload = {
  name: string;
  description: string;
  workflowTemplateKey: string;
  autoStartWorkflow: boolean;
  projectType?: 'complete' | 'standalone' | 'relay';
};

function inferProjectType(payload: ProjectCreatePayload): 'complete' | 'standalone' | 'relay' {
  if (payload.projectType) {
    return payload.projectType;
  }
  const template = String(payload.workflowTemplateKey || '').trim().toLowerCase();
  if (template === 'visual_design' || template === 'code_development' || template === 'none') {
    return 'standalone';
  }
  return 'complete';
}

async function waitIssueDebateReady(
  apiUrl: string,
  token: string,
  issueId: string,
  timeoutMs = 180_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await apiRequest<any>(
      apiUrl,
      token,
      `/api/issues/${encodeURIComponent(issueId)}/debate`,
    );
    const data = response?.data || response;
    const status = String(data?.status || '').trim().toLowerCase();
    const canProceed = Boolean(data?.analysisGate?.canProceed);
    if (canProceed && status === 'completed') {
      return;
    }
    if (status === 'failed') {
      throw new Error(`issue debate failed: ${String(data?.error || 'unknown')}`);
    }
    const pollAfterMs = Number(data?.pollAfterMs ?? 2000);
    await new Promise((resolve) => setTimeout(resolve, Math.max(800, Math.min(5000, pollAfterMs || 2000))));
  }
  throw new Error(`issue debate timeout after ${timeoutMs}ms for ${issueId}`);
}

function buildClarificationAnswers(questions: Array<{ id?: string; required?: boolean }> = []) {
  return questions.reduce((acc: Record<string, string>, item) => {
    if (!item?.required) {
      return acc;
    }
    const id = String(item.id || '').trim();
    if (!id) {
      return acc;
    }
    if (/goal/i.test(id)) {
      acc[id] = '完成阶段交付并可验收';
    } else if (/scope/i.test(id)) {
      acc[id] = '仅覆盖当前阶段模板对应范围';
    } else if (/accept/i.test(id)) {
      acc[id] = '产出物满足模板要求并可通过门禁';
    } else {
      acc[id] = '已确认';
    }
    return acc;
  }, {});
}

function isDebateStillRunningConfirmError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /VALIDATION_ERROR/i.test(message)
    && /真实模型多角色讨论仍在进行中|debate.*进行中|discussion.*in progress/i.test(message);
}

export async function createProjectWithIssueFirstFallback(
  apiUrl: string,
  token: string,
  payload: ProjectCreatePayload,
  options?: {
    forceIssueFirst?: boolean;
  },
): Promise<{ id: string; name: string }> {
  const normalizedPayload: ProjectCreatePayload = {
    ...payload,
    projectType: inferProjectType(payload),
  };
  const forceIssueFirst = Boolean(options?.forceIssueFirst);
  if (!forceIssueFirst) {
    try {
      return await apiRequest<{ id: string; name: string }>(apiUrl, token, '/api/projects', {
        method: 'POST',
        body: normalizedPayload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/PROJECT_ISSUE_FIRST_REQUIRED/.test(message)) {
        throw error;
      }
    }
  }

  const preview = await apiRequest<any>(apiUrl, token, '/api/issues/preview', {
    method: 'POST',
      body: {
      input: normalizedPayload.description || normalizedPayload.name,
      industryCode: 'saas',
      sourceType: 'text',
      debateMode: 'model',
      workflowTemplateKey: normalizedPayload.workflowTemplateKey,
    },
  });
  const previewData = preview?.data || preview;
  const issueId = String(previewData?.issueId || '').trim();
  if (!issueId) {
    throw new Error('issue-first preview did not return issueId');
  }
  await waitIssueDebateReady(apiUrl, token, issueId);

  const questions = Array.isArray(previewData?.questions) ? previewData.questions : [];
  const clarificationAnswers = buildClarificationAnswers(questions);

  let confirm: any = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      confirm = await apiRequest<any>(apiUrl, token, `/api/issues/${encodeURIComponent(issueId)}/confirm`, {
        method: 'POST',
        body: {
          finalName: normalizedPayload.name,
          finalDescription: normalizedPayload.description,
          clarificationAnswers,
          projectType: normalizedPayload.projectType || 'complete',
          workflowTemplateKey: normalizedPayload.workflowTemplateKey,
          autoStartWorkflow: normalizedPayload.autoStartWorkflow,
        },
      });
      break;
    } catch (error) {
      if (attempt >= 6 || !isDebateStillRunningConfirmError(error)) {
        throw error;
      }
      await waitIssueDebateReady(apiUrl, token, issueId, 120_000);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  if (!confirm) {
    throw new Error(`issue confirm timeout for ${issueId}`);
  }
  const confirmData = confirm?.data || confirm;
  const project = confirmData?.project || confirmData;
  return {
    id: String(project?.id || '').trim(),
    name: String(project?.name || normalizedPayload.name),
  };
}
