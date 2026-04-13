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

type ProjectCreatePayload = {
  name: string;
  description: string;
  workflowTemplateKey: string;
  autoStartWorkflow: boolean;
  projectType?: 'complete' | 'standalone' | 'relay';
};

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

export async function createProjectWithIssueFirstFallback(
  apiUrl: string,
  token: string,
  payload: ProjectCreatePayload,
): Promise<{ id: string; name: string }> {
  try {
    return await apiRequest<{ id: string; name: string }>(apiUrl, token, '/api/projects', {
      method: 'POST',
      body: payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/PROJECT_ISSUE_FIRST_REQUIRED/.test(message)) {
      throw error;
    }
  }

  const preview = await apiRequest<any>(apiUrl, token, '/api/issues/preview', {
    method: 'POST',
    body: {
      input: payload.description || payload.name,
      industryCode: 'saas',
      sourceType: 'text',
      debateMode: 'off',
      workflowTemplateKey: payload.workflowTemplateKey,
    },
  });
  const previewData = preview?.data || preview;
  const issueId = String(previewData?.issueId || '').trim();
  if (!issueId) {
    throw new Error('issue-first preview did not return issueId');
  }

  const questions = Array.isArray(previewData?.questions) ? previewData.questions : [];
  const clarificationAnswers = buildClarificationAnswers(questions);

  const confirm = await apiRequest<any>(apiUrl, token, `/api/issues/${encodeURIComponent(issueId)}/confirm`, {
    method: 'POST',
    body: {
      finalName: payload.name,
      finalDescription: payload.description,
      clarificationAnswers,
      projectType: payload.projectType || 'complete',
      workflowTemplateKey: payload.workflowTemplateKey,
      autoStartWorkflow: payload.autoStartWorkflow,
    },
  });
  const confirmData = confirm?.data || confirm;
  const project = confirmData?.project || confirmData;
  return {
    id: String(project?.id || '').trim(),
    name: String(project?.name || payload.name),
  };
}
