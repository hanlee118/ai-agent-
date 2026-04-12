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

test('project room should lock Step 2 execution before Step 1 is completed', async ({ context, page }) => {
  test.setTimeout(120_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const now = new Date().toISOString();

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
      const projectId = decodeURIComponent(match[1] || '').trim() || 'P-STEP-GATE-MOCK';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: projectId,
          name: 'Step 门禁验收项目',
          projectType: 'standalone',
          status: 'active',
          currentStage: 'INIT',
          progress: 4,
          updatedAt: now,
          pendingApproval: false,
          currentRole: 'ROLE_PM',
          summary: '用于验证 Step 1 / Step 2 门禁',
          openTaskCount: 1,
          description: '尚未完成需求补齐与多 Agent 讨论写回。',
          parsedIntent: {
            keywords: ['门禁'],
            constraints: [],
            risks: [],
            suggestedTeam: ['ROLE_PM', 'ROLE_ANALYST', 'ROLE_DESIGN'],
            summary: '门禁验收',
          },
          team: ['ROLE_PM', 'ROLE_ANALYST', 'ROLE_DESIGN'],
          stages: [
            { type: 'INIT', label: '立项', assignee: 'ROLE_PM', status: 'active', progress: 20 },
            { type: 'ANALYSIS', label: '分析', assignee: 'ROLE_ANALYST', status: 'pending', progress: 0 },
            { type: 'DESIGN', label: '设计', assignee: 'ROLE_DESIGN', status: 'pending', progress: 0 },
          ],
          tasks: [
            {
              id: `${projectId}-task-init`,
              projectId,
              stageType: 'INIT',
              title: '项目立项登记',
              description: '仅立项阶段任务，不应视为 Step 2 执行已开始',
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
            body: '等待需求补齐',
            provider: 'scripted',
          },
          requiredActions: [],
          issueFirst: {
            ok: false,
            enforced: true,
            code: 'PROJECT_MAIN_ISSUE_REQUIRED',
            message: '需要先补齐主 Issue',
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
      const url = new URL(route.request().url());
      const match = url.pathname.match(/\/api\/projects\/([^/]+)\/executions$/);
      const projectId = decodeURIComponent(match?.[1] || '').trim() || 'P-STEP-GATE-MOCK';
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
      const url = new URL(route.request().url());
      const match = url.pathname.match(/\/api\/projects\/([^/]+)\/final-artifacts$/);
      const projectId = decodeURIComponent(match?.[1] || '').trim() || 'P-STEP-GATE-MOCK';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projectId,
          projectName: 'Step 门禁验收项目',
          status: 'active',
          currentStage: 'INIT',
          generatedAt: now,
          readyForAcceptance: false,
          blockingIssues: [],
          coverage: { required: 1, provided: 0, missing: 1 },
          artifacts: [],
          missingRequired: ['设计审查卡'],
          checklist: [],
        }),
      });
    });

    await page.route('**/api/gitlab/harness/projects/*/sync', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            projectId: 'P-STEP-GATE-MOCK',
            projectPath: 'root/mock-project',
            projectIssueIid: 1024,
            stageType: 'INIT',
            closeOnComplete: false,
            taskTotal: 0,
            created: [],
            updated: [],
            reused: [],
            failed: [],
          },
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
    await expect(page.getByText('执行阶段暂未解锁')).toBeVisible();
    await expect(page.getByText('第 2 步暂时锁定')).toBeVisible();

    const startExecutionButton = page.getByRole('button', { name: '开始阶段执行' }).first();
    await expect(startExecutionButton).toBeDisabled();

    const stageTab = page.getByRole('button', { name: /^阶段\s*\d+$/ }).first();
    await expect(stageTab).toBeDisabled();

    assert.ok(true);
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
