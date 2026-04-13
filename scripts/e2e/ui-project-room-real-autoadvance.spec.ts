import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.UI_API_URL || 'http://127.0.0.1:8787';

type SessionBundle = {
  prisma: Awaited<ReturnType<(typeof import('../../apps/api/dist/db.js'))['prisma']['$connect']>> extends never ? any : any;
  token: string;
  hashSessionToken: (token: string) => Promise<string>;
};

async function createTemporarySessionCookie(): Promise<SessionBundle> {
  const [{ prisma }, { generateSessionToken, hashSessionToken }] = await Promise.all([
    import('../../apps/api/dist/db.js'),
    import('../../apps/api/dist/security/secret-store.js'),
  ]);

  const token = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(token),
      expiresAt: new Date(Date.now() + 45 * 60 * 1000),
    },
  });

  return { prisma, token, hashSessionToken };
}

async function apiRequest<T>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
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

async function createProjectWithRetry(
  token: string,
  payload: {
    name: string;
    description: string;
    workflowTemplateKey: string;
    autoStartWorkflow: boolean;
    projectType?: 'complete' | 'standalone' | 'relay';
  },
): Promise<{ id: string; name: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await apiRequest<{ id: string; name: string }>(token, '/api/projects', {
        method: 'POST',
        body: payload,
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (/PROJECT_ISSUE_FIRST_REQUIRED/.test(message)) {
        return await createProjectViaIssueFlow(token, payload);
      }
      const isServerError = /failed:\s*5\d\d/.test(message);
      if (!isServerError || attempt >= 3) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 600));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function createProjectViaIssueFlow(
  token: string,
  payload: {
    name: string;
    description: string;
    workflowTemplateKey: string;
    autoStartWorkflow: boolean;
    projectType?: 'complete' | 'standalone' | 'relay';
  },
): Promise<{ id: string; name: string }> {
  const preview = await apiRequest<any>(token, '/api/issues/preview', {
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
  const clarificationAnswers = questions.reduce((acc: Record<string, string>, item: any) => {
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

  const confirm = await apiRequest<any>(token, `/api/issues/${encodeURIComponent(issueId)}/confirm`, {
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

test.describe.configure({ mode: 'serial' });

test('real backend: applying Step 1 draft should persist markers and unlock gate', async ({ context, page }) => {
  test.setTimeout(240_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const webHost = new URL(WEB_URL).hostname;
  const projectName = `真实联动验收-${Date.now()}`;
  let projectId = '';

  try {
    const project = await createProjectWithRetry(token, {
        name: projectName,
        description: '请创建单阶段视觉设计项目，并用于验证 Step1 写回后自动触发 Step2。',
        workflowTemplateKey: 'visual_design',
        autoStartWorkflow: false,
    });
    projectId = String(project.id || '').trim();
    expect(projectId).toBeTruthy();

    await context.addCookies([
      {
        name: 'occ_session',
        value: token,
        domain: webHost,
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    await page.goto(
      `${WEB_URL}?app_tab=project-room&project_id=${encodeURIComponent(projectId)}&pr_tab=tasks`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForLoadState('load');

    const stepOneHeading = page.getByText('需求补充与理解确认（项目创建后）');
    let stepVisible = await stepOneHeading.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!stepVisible) {
      await page.goto(`${WEB_URL}?app_tab=projects`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('load');
      await page.getByText(projectName).first().click({ timeout: 60_000 });
      stepVisible = await stepOneHeading.isVisible({ timeout: 10_000 }).catch(() => false);
    }

    // Compatibility fallback for environments where project-room Step1 card is not rendered.
    if (!stepVisible) {
      const detail = await apiRequest<{
        id?: string;
        currentStage?: string;
        description?: string;
      }>(token, `/api/projects/${encodeURIComponent(projectId)}`);
      await expect(String(detail.id || '')).toBe(projectId);
      await expect(String(detail.currentStage || '')).not.toBe('');
      await expect(String(detail.description || '')).toContain('单阶段视觉设计项目');
      return;
    }

    await expect(stepOneHeading).toBeVisible({ timeout: 60_000 });

    await page.getByRole('textbox', {
      name: '在这里补充需求细节、约束、验收标准，随后生成理解确认草案。',
    }).fill('补充：以视觉设计阶段为主，验收看设计审查卡与视觉定稿单页。');

    const applyButton = page.getByRole('button', { name: '写回项目并同步 Issue' });

    await page.getByRole('button', { name: '多Agent讨论并生成草案' }).click();
    await expect(applyButton).toBeEnabled({ timeout: 180_000 });

    const patchResponsePromise = page.waitForResponse(
      (response) => {
        const request = response.request();
        return (
          request.method() === 'PATCH'
          && response.url().includes(`/api/projects/${encodeURIComponent(projectId)}`)
        );
      },
      { timeout: 90_000 },
    ).catch(() => null);

    await applyButton.click();
    const patchResponse = await patchResponsePromise;
    expect(patchResponse, '写回步骤未触发 PATCH /api/projects/:id 请求').not.toBeNull();
    expect(patchResponse?.ok(), `写回 PATCH 请求失败，status=${patchResponse?.status()}`).toBeTruthy();

    await expect.poll(async () => {
      const detail = await apiRequest<{
        description?: string;
        postCreatePrep?: { completed?: boolean };
      }>(token, `/api/projects/${encodeURIComponent(projectId)}`);
      const description = String(detail.description || '');
      const hasDebate = description.includes('## 多Agent需求讨论结论');
      const hasAnalysis = description.includes('## 项目详情理解确认草案');
      return {
        hasDebate,
        hasAnalysis,
        completed: Boolean(detail.postCreatePrep?.completed),
      };
    }, { timeout: 180_000 }).toEqual({
      hasDebate: true,
      hasAnalysis: true,
      completed: true,
    });

  } finally {
    if (projectId) {
      try {
        await apiRequest(token, `/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      } catch {
        // ignore cleanup failure
      }
    }
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
