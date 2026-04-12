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

test('selected agents can be unchecked in team step and stay unchecked', async ({ context, page }) => {
  test.setTimeout(120_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();

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
      const data = {
        issueId: 'ISSUE-AGENT-TOGGLE-001',
        title: 'Agent 取消勾选验证',
        summary: '验证团队分配中可以取消已选 Agent。',
        industryCode: 'saas',
        recommendedRoleIds: ['ROLE_ANALYST', 'ROLE_DESIGN'],
        soulRoleId: 'ROLE_ANALYST',
        conflicts: [],
        questions: [],
        refinement: {
          problemStatement: '',
          expectedOutcome: '',
          inScopeDraft: [],
          outOfScopeDraft: [],
          acceptanceDraft: [],
        },
        contextAlignment: {
          productName: 'Agent 协作平台',
          missionAnchor: '',
          matchedGoals: [],
          matchedPrinciples: [],
          contextNotes: [],
        },
        designBlueprint: {
          designTheme: '',
          valueNarrative: '',
          targetUsers: [],
          coreScenarios: [],
          proposedMilestones: [],
        },
        suggestedAnswers: [],
        relatedHistory: [],
        requirementContract: {
          objective: '',
          inScope: [],
          outOfScope: [],
          acceptanceCriteria: [],
          artifacts: [],
        },
        discussion: [],
        discussionDraft: [],
        debate: null,
        debateTask: null,
        analysisGate: {
          canProceed: true,
          canCreateProject: true,
          blockers: [],
          createBlockers: [],
          checks: [{ id: 'ready', label: 'ready', passed: true, detail: 'ok' }],
          runtimeMode: 'scripted',
          requestedRuntimeMode: 'scripted',
        },
        contentProvenance: {
          formalReady: true,
          note: 'scripted',
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
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data }),
      });
    });

    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '新建项目' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: '新建项目' }).click();

    await expect(page.getByText('创建新项目')).toBeVisible();
    await page.getByPlaceholder('例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。')
      .fill('验证团队分配中已选 Agent 可以取消并保持取消状态');
    const continueButton = page.getByRole('button', { name: '可选：生成 AI 建议' });
    await expect(continueButton).toBeEnabled({ timeout: 30_000 });
    await continueButton.click();

    await expect(page.getByText('团队分配与扩展信息')).toBeVisible({ timeout: 30_000 });
    const checkedLocator = page.locator('input[type="checkbox"]:checked');
    const checkedBefore = await checkedLocator.count();
    assert.ok(checkedBefore > 0, `expected at least one checked agent, got ${checkedBefore}`);

    await checkedLocator.first().click();
    await page.waitForTimeout(1200);

    const checkedAfter = await page.locator('input[type="checkbox"]:checked').count();
    assert.ok(
      checkedAfter < checkedBefore,
      `expected checked count to decrease after uncheck, before=${checkedBefore}, after=${checkedAfter}`,
    );
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
