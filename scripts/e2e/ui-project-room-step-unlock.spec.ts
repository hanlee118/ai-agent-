import assert from 'node:assert/strict';
import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';

async function createTemporarySessionCookie() {
  const [{ prisma }, { generateSessionToken, hashSessionToken }] = await Promise.all([
    import('../../apps/api/dist/db.js'),
    import('../../apps/api/dist/security/secret-store.js'),
  ]);

  const token = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  return { prisma, token, hashSessionToken };
}

test.describe.configure({ mode: 'serial' });

test('project room should unlock Step 2 and trigger advance when Step 1 is complete', async ({ context, page }) => {
  test.setTimeout(120_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const now = new Date().toISOString();
  const projectId = 'P-STEP-UNLOCK-MOCK';
  let advanceCalled = false;

  await context.addCookies([
    {
      name: 'occ_session',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  try {
    await page.route('**/api/projects/*/advance', async (route) => {
      if (route.request().method() === 'POST') {
        advanceCalled = true;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.route('**/api/projects/*', async (route) => {
      const request = route.request();
      if (request.method() !== 'GET') {
        await route.continue();
        return;
      }
      const url = new URL(request.url());
      const match = url.pathname.match(/\/api\/projects\/([^/]+)$/);
      if (!match) {
        await route.continue();
        return;
      }
      const routeProjectId = decodeURIComponent(match[1] || '').trim() || projectId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: routeProjectId,
          name: 'Step 解锁验收项目',
          projectType: 'standalone',
          status: 'active',
          currentStage: 'INIT',
          progress: 6,
          updatedAt: now,
          pendingApproval: false,
          currentRole: 'ROLE_PM',
          summary: '用于验证 Step 2 解锁后触发阶段执行',
          openTaskCount: 1,
          description: [
            '## 多Agent需求讨论结论',
            '- 需求分析师 | 关注: 业务目标',
            '',
            '## 项目详情理解确认草案',
            '- 标题: Step 解锁验收项目',
          ].join('\n'),
          parsedIntent: {
            keywords: ['step', 'unlock'],
            constraints: [],
            risks: [],
            suggestedTeam: ['ROLE_PM', 'ROLE_ANALYST', 'ROLE_DESIGN'],
            summary: 'step unlock',
          },
          team: ['ROLE_PM', 'ROLE_ANALYST', 'ROLE_DESIGN'],
          stages: [
            { type: 'INIT', label: '立项', assignee: 'ROLE_PM', status: 'active', progress: 26 },
            { type: 'ANALYSIS', label: '分析', assignee: 'ROLE_ANALYST', status: 'pending', progress: 0 },
            { type: 'DESIGN', label: '设计', assignee: 'ROLE_DESIGN', status: 'pending', progress: 0 },
          ],
          tasks: [
            {
              id: `${routeProjectId}-task-init`,
              projectId: routeProjectId,
              stageType: 'INIT',
              title: '立项排程确认',
              description: '用于验证未进入后续阶段时 Step 2 可手动触发',
              assignee: 'ROLE_PM',
              status: 'in_progress',
              priority: 'normal',
              updatedAt: now,
            },
          ],
          deliverables: [],
          timeline: [],
          liveSession: {
            activeRole: 'ROLE_PM',
            title: '立项中',
            startedAt: now,
            body: '准备进入下一阶段',
            provider: 'scripted',
          },
          requiredActions: [],
          issueFirst: {
            ok: true,
            enforced: true,
            data: {
              projectId: routeProjectId,
              projectPath: 'root/mock-project',
              issueIid: 1099,
            },
          },
          workflowScope: {
            mode: 'single',
            templateKey: 'visual_design',
            templateKeys: ['visual_design'],
            allowedStages: ['DESIGN'],
          },
        }),
      });
    });

    await page.route('**/api/projects/*/executions?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projectId,
          total: 0,
          executions: [],
        }),
      });
    });

    await page.route('**/api/projects/*/final-artifacts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projectId,
          projectName: 'Step 解锁验收项目',
          status: 'active',
          currentStage: 'INIT',
          generatedAt: now,
          readyForAcceptance: false,
          blockingIssues: [],
          coverage: { required: 1, provided: 0, missing: 1 },
          artifacts: [],
          missingRequired: [],
          checklist: [],
        }),
      });
    });

    await page.route('**/api/v1/workflows/projects/*/overview', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'No active workflow',
          },
        }),
      });
    });

    await page.goto(WEB_URL, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('load');

    const activeProjectsPanel = page.locator('div').filter({
      has: page.getByRole('heading', { name: '活跃项目' }),
    }).first();
    await expect(activeProjectsPanel.getByText(/•\s*\d+\s*个 Agent/).first()).toBeVisible({ timeout: 60_000 });
    await activeProjectsPanel.getByText(/•\s*\d+\s*个 Agent/).first().click({ force: true });

    await expect(page.getByText('Step 1', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Step 2', { exact: true })).toBeVisible();
    await expect(page.getByText('执行阶段已解锁')).toBeVisible();

    const startExecutionButton = page.getByRole('button', { name: '开始阶段执行' }).first();
    await expect(startExecutionButton).toBeEnabled();
    await startExecutionButton.click();

    await expect.poll(() => advanceCalled).toBeTruthy();
    await expect(page.getByText('阶段执行已启动（Step 2）')).toBeVisible({ timeout: 15_000 });

    const stageTab = page.getByRole('button', { name: /^阶段\s*\d+$/ }).first();
    await expect(stageTab).toBeEnabled();

    assert.ok(true);
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
