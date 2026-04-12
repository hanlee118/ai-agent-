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

test('project room should auto-advance after applying post-create draft on INIT stage', async ({ context, page }) => {
  test.setTimeout(120_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const now = new Date().toISOString();
  const projectId = 'P-STEP-AUTO-ADVANCE-MOCK';
  let projectDescription = '原始描述：需要补充需求';
  let updateCalled = false;
  let advanceCalled = false;
  let syncedMainIssue = false;

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
    await page.route('**/api/issues/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          issueId: 'ISSUE-AUTO-ADVANCE-001',
          title: '自动推进验收项目',
          summary: '用于验证 Step 1 写回后自动触发 Step 2。',
          industryCode: 'saas',
          recommendedRoleIds: ['ROLE_PM', 'ROLE_ANALYST', 'ROLE_DESIGN'],
          soulRoleId: 'ROLE_PM',
          conflicts: [],
          questions: [],
          refinement: {
            problemStatement: '验证自动推进联动',
            expectedOutcome: '写回后触发 advance',
            inScopeDraft: ['Step 1 完成写回'],
            outOfScopeDraft: [],
            acceptanceDraft: ['触发 advance'],
          },
          contextAlignment: {
            productName: 'Agent 协作平台',
            missionAnchor: '提升协作效率',
            matchedGoals: [],
            matchedPrinciples: [],
            contextNotes: [],
          },
          designBlueprint: {
            designTheme: '控制台',
            valueNarrative: '先补齐，再执行',
            targetUsers: ['PM'],
            coreScenarios: ['项目详情补齐'],
            proposedMilestones: ['补齐', '执行'],
          },
          suggestedAnswers: [],
          relatedHistory: [],
          requirementContract: {
            objective: '验证自动推进',
            inScope: ['写回项目'],
            outOfScope: [],
            acceptanceCriteria: ['触发 /advance'],
            artifacts: ['理解确认草案'],
          },
          discussion: [],
          discussionDraft: [],
          debate: {
            mode: 'model',
            generatedAt: now,
            consensus: ['先写回理解确认草案，再自动推进阶段执行'],
            divergences: [],
            note: 'auto-advance test',
            opinions: [
              {
                id: 'op-1',
                roleId: 'ROLE_ANALYST',
                roleLabel: '需求分析师',
                focus: '目标澄清',
                concern: '需求不完整',
                proposal: '写回确认草案后推进',
                provider: 'mock',
                model: 'mock-model',
                elapsedMs: 100,
                mode: 'model',
                rawPreview: 'ok',
              },
            ],
          },
          debateTask: null,
          analysisGate: {
            canProceed: true,
            canCreateProject: true,
            blockers: [],
            createBlockers: [],
            checks: [],
            runtimeMode: 'model',
            requestedRuntimeMode: 'model',
          },
          contentProvenance: {
            formalReady: true,
            note: 'mock',
            summary: 'model_debate',
            refinement: 'model_debate',
            contextAlignment: 'model_debate',
            designBlueprint: 'model_debate',
            suggestedAnswers: 'model_debate',
            requirementContract: 'model_debate',
            discussion: 'model_debate',
            discussionDraft: 'model_debate',
          },
          expectedArtifacts: [],
          workflow: null,
        }),
      });
    });

    await page.route('**/api/gitlab/harness/projects/*/sync', async (route) => {
      syncedMainIssue = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            projectId,
            projectPath: 'root/mock-project',
            projectIssueIid: 2026,
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

    await page.route('**/api/projects/*/advance', async (route) => {
      advanceCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.route('**/api/projects/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const match = url.pathname.match(/\/api\/projects\/([^/]+)$/);
      if (!match) {
        await route.continue();
        return;
      }

      const routeProjectId = decodeURIComponent(match[1] || '').trim() || projectId;

      if (request.method() === 'PATCH') {
        updateCalled = true;
        const payloadRaw = request.postData() || '{}';
        const payload = JSON.parse(payloadRaw) as { description?: string };
        projectDescription = String(payload.description || projectDescription);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: routeProjectId,
            name: '自动推进验收项目',
            description: projectDescription,
          }),
        });
        return;
      }

      if (request.method() !== 'GET') {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: routeProjectId,
          name: '自动推进验收项目',
          projectType: 'standalone',
          status: 'active',
          currentStage: 'INIT',
          progress: 8,
          updatedAt: now,
          pendingApproval: false,
          currentRole: 'ROLE_PM',
          summary: '用于验证写回后自动推进',
          openTaskCount: 2,
          description: projectDescription,
          parsedIntent: {
            keywords: ['step', 'auto'],
            constraints: [],
            risks: [],
            suggestedTeam: ['ROLE_PM', 'ROLE_ANALYST', 'ROLE_DESIGN'],
            summary: 'step auto advance',
          },
          team: ['ROLE_PM', 'ROLE_ANALYST', 'ROLE_DESIGN'],
          stages: [
            { type: 'INIT', label: '立项', assignee: 'ROLE_PM', status: 'active', progress: 28 },
            { type: 'ANALYSIS', label: '分析', assignee: 'ROLE_ANALYST', status: 'pending', progress: 0 },
            { type: 'DESIGN', label: '设计', assignee: 'ROLE_DESIGN', status: 'pending', progress: 0 },
          ],
          tasks: [
            {
              id: `${routeProjectId}-task-design`,
              projectId: routeProjectId,
              stageType: 'DESIGN',
              title: '设计执行准备',
              description: '等待 Step 1 完成后推进',
              assignee: 'ROLE_DESIGN',
              status: 'todo',
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
            ok: true,
            enforced: true,
            data: {
              projectId: routeProjectId,
              projectPath: 'root/mock-project',
              issueIid: 2026,
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
          projectName: '自动推进验收项目',
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
    await expect(page.getByRole('button', { name: '多Agent讨论并生成草案' })).toBeVisible();

    await page.getByRole('button', { name: '多Agent讨论并生成草案' }).click();
    await expect(page.getByText('理解确认草案', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: '写回项目并同步 Issue' }).click();

    await expect.poll(() => updateCalled).toBeTruthy();
    await expect.poll(() => syncedMainIssue).toBeTruthy();
    await expect.poll(() => advanceCalled).toBeTruthy();

    assert.ok(projectDescription.includes('## 多Agent需求讨论结论'));
    assert.ok(projectDescription.includes('## 项目详情理解确认草案'));
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
