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

test('real project room should render only scoped single stage', async ({ context, page }) => {
  test.setTimeout(180_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const webHost = new URL(WEB_URL).hostname;
  let projectId = '';
  const projectName = `真实单阶段验收-${Date.now()}`;

  try {
    const project = await apiRequest<{ id: string; name: string }>(token, '/api/projects', {
      method: 'POST',
      body: {
        name: projectName,
        description: '请创建单阶段视觉设计项目，并验证项目房间仅渲染目标阶段。',
        workflowTemplateKey: 'visual_design',
        autoStartWorkflow: false,
      },
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
    const stageTabVisible = await stageTab.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!stageTabVisible) {
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('load');

      const activeProjectsPanel = page.locator('div').filter({
        has: page.getByRole('heading', { name: '活跃项目' }),
      }).first();
      await expect(activeProjectsPanel).toBeVisible({ timeout: 60_000 });

      const namedProjectHeading = activeProjectsPanel.getByRole('heading', { name: projectName }).first();
      const hasNamedProject = await namedProjectHeading.isVisible({ timeout: 5_000 }).catch(() => false);
      if (hasNamedProject) {
        await namedProjectHeading.click({ force: true });
      } else {
        await activeProjectsPanel.getByText(/•\s*\d+\s*个 Agent/).first().click({ force: true });
      }
    }

    await expect(stageTab).toBeVisible({ timeout: 60_000 });
    await expect(stageTab).toContainText('1');
    const hasLockedBadge = await page.getByText('执行阶段暂未解锁').isVisible({ timeout: 5_000 }).catch(() => false);
    const isStageLocked = hasLockedBadge || (await stageTab.isDisabled());
    if (isStageLocked) {
      await expect(page.getByText('执行阶段暂未解锁')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('第 2 步暂时锁定')).toBeVisible();
    } else {
      const clicked = await stageTab.click({ timeout: 8_000 }).then(() => true).catch(() => false);
      if (!clicked) {
        await expect(page.getByText('执行阶段暂未解锁')).toBeVisible({ timeout: 30_000 });
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
