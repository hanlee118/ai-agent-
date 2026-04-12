import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const UI_REPORT_DIR = 'docs/reports';

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

test('project room should only show scoped stage for single-stage workflow template', async ({ context, page }) => {
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
      const projectId = decodeURIComponent(match[1] || '').trim() || 'P-STAGE-SCOPE-MOCK';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: projectId,
          name: '单阶段视觉设计项目',
          projectType: 'standalone',
          status: 'active',
          currentStage: 'INIT',
          progress: 28,
          updatedAt: now,
          pendingApproval: false,
          currentRole: 'ROLE_PM',
          summary: '单阶段模板验收',
          openTaskCount: 2,
          description: '用于验证 ProjectRoom 单阶段显示裁剪。',
          parsedIntent: {
            keywords: ['视觉设计'],
            constraints: [],
            risks: [],
            suggestedTeam: ['ROLE_ANALYST', 'ROLE_DESIGN'],
            summary: '单阶段视觉设计',
          },
          team: ['ROLE_PM', 'ROLE_ANALYST', 'ROLE_DESIGN', 'ROLE_DEV', 'ROLE_QA'],
          stages: [
            { type: 'INIT', label: '立项', assignee: 'ROLE_PM', status: 'active', progress: 30 },
            { type: 'ANALYSIS', label: '分析', assignee: 'ROLE_ANALYST', status: 'pending', progress: 0 },
            { type: 'DESIGN', label: '设计', assignee: 'ROLE_DESIGN', status: 'pending', progress: 0 },
            { type: 'DEV', label: '开发', assignee: 'ROLE_DEV', status: 'pending', progress: 0 },
            { type: 'ACCEPT', label: '验收', assignee: 'ROLE_QA', status: 'pending', progress: 0 },
          ],
          tasks: [
            {
              id: `${projectId}-task-design`,
              projectId,
              stageType: 'DESIGN',
              title: '视觉方向与布局策略',
              description: '产出视觉方向和布局规范',
              assignee: 'ROLE_DESIGN',
              status: 'in_progress',
              priority: 'high',
              updatedAt: now,
            },
            {
              id: `${projectId}-task-dev`,
              projectId,
              stageType: 'DEV',
              title: '实现落地（不应显示）',
              description: '此任务用于验证过滤',
              assignee: 'ROLE_DEV',
              status: 'todo',
              priority: 'normal',
              updatedAt: now,
            },
          ],
          deliverables: [
            {
              id: `${projectId}-d-design`,
              stageType: 'DESIGN',
              name: '设计审查卡.md',
              type: 'markdown',
              content: '## 设计审查\n可读内容'.padEnd(260, 'x'),
              version: 1,
              status: 'submitted',
              createdBy: 'ROLE_DESIGN',
              updatedAt: now,
            },
            {
              id: `${projectId}-d-dev`,
              stageType: 'DEV',
              name: '实现结果说明.md',
              type: 'markdown',
              content: '这条 DEV 交付物不应在单阶段视觉项目中展示。'.padEnd(260, 'x'),
              version: 1,
              status: 'draft',
              createdBy: 'ROLE_DEV',
              updatedAt: now,
            },
          ],
          timeline: [],
          liveSession: {
            activeRole: 'ROLE_PM',
            title: '单阶段执行中',
            startedAt: now,
            body: 'Project Room 单阶段验收',
            provider: 'scripted',
          },
          requiredActions: [],
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
      const projectId = decodeURIComponent(match?.[1] || '').trim() || 'P-STAGE-SCOPE-MOCK';
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
      const projectId = decodeURIComponent(match?.[1] || '').trim() || 'P-STAGE-SCOPE-MOCK';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projectId,
          projectName: '单阶段视觉设计项目',
          status: 'active',
          currentStage: 'DESIGN',
          generatedAt: now,
          readyForAcceptance: false,
          blockingIssues: [],
          coverage: { required: 1, provided: 1, missing: 0 },
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

    await expect(page.getByRole('button', { name: /^阶段\s*\d+$/ }).first()).toBeVisible({ timeout: 60_000 });
    const stageTab = page.getByRole('button', { name: /^阶段\s*\d+$/ }).first();
    await expect(stageTab).toContainText('1');
    await stageTab.click();

    await expect(page.getByText('负责人: 视觉设计总监')).toBeVisible();
    await expect(page.getByText('阶段交付物 (1)')).toBeVisible();
    await expect(page.getByText('负责人: 研发经理')).toHaveCount(0);
    await expect(page.getByText('实现结果说明.md')).toHaveCount(0);

    mkdirSync(UI_REPORT_DIR, { recursive: true });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-project-room-stage-scope.png`, fullPage: true });

    assert.ok(true);
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
