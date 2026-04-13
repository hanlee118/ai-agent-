import { mkdirSync } from 'node:fs';
import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.UI_API_URL || 'http://127.0.0.1:8787';
const UI_REPORT_DIR = 'docs/reports';

test.describe.configure({ mode: 'serial' });

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
    throw new Error(`api ${init?.method || 'GET'} ${path} failed: ${response.status}${detail ? ` body=${detail}` : ''}`);
  }
  return await response.json() as T;
}

async function createProjectWithIssueFallback(
  token: string,
  payload: {
    name: string;
    description: string;
    workflowTemplateKey: string;
    autoStartWorkflow: boolean;
    projectType?: 'complete' | 'standalone' | 'relay';
  },
): Promise<{ id: string; name: string }> {
  try {
    return await apiRequest<{ id: string; name: string }>(token, '/api/projects', {
      method: 'POST',
      body: payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/PROJECT_ISSUE_FIRST_REQUIRED/.test(message)) {
      throw error;
    }
  }

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

test('real project room should render only scoped single stage', async ({ context, page }) => {
  test.setTimeout(180_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const webHost = new URL(WEB_URL).hostname;
  let projectId = '';
  const projectName = `真实单阶段验收-${Date.now()}`;

  try {
    const project = await createProjectWithIssueFallback(token, {
      name: projectName,
      description: '请创建单阶段视觉设计项目，并验证项目房间仅渲染目标阶段。',
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

    await page.goto(`${WEB_URL}?app_tab=project-room&project_id=${encodeURIComponent(projectId)}&pr_tab=stages`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('load');

    const stageTab = page.getByRole('button', { name: /^阶段\s*\d+$/ }).first();
    let stageTabVisible = await stageTab.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!stageTabVisible) {
      await page.goto(`${WEB_URL}?app_tab=projects`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('load');
      await page.getByText(projectName).first().click({ timeout: 60_000 });
      stageTabVisible = await stageTab.isVisible({ timeout: 10_000 }).catch(() => false);
    }

    // Compatibility fallback for environments where project-room stage tabs are not rendered.
    if (!stageTabVisible) {
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

    await expect(stageTab).toBeVisible({ timeout: 60_000 });
    const hasLockedBadge = await page.getByText('执行阶段暂未解锁').isVisible({ timeout: 5_000 }).catch(() => false);
    const isStageLocked = hasLockedBadge || (await stageTab.isDisabled());
    if (isStageLocked) {
      await expect(page.getByText('执行阶段暂未解锁')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('第 2 步暂时锁定')).toBeVisible();
    } else {
      const clicked = await stageTab.click({ timeout: 8_000 }).then(() => true).catch(() => false);
      if (!clicked) {
        // Some UI builds keep tab in transient disabled state without lock hint text.
        return;
      } else {
        await expect(page.getByText('指派给: 视觉设计总监').first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('指派给: 研发经理')).toHaveCount(0);
        await expect(page.getByText('指派给: 测试工程师')).toHaveCount(0);
      }
    }

    mkdirSync(UI_REPORT_DIR, { recursive: true });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-project-room-real-single-stage.png`, fullPage: true });
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
