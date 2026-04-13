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

test('visual design template prefers Hermes agent selection for design role', async ({ context, page }) => {
  test.setTimeout(180_000);
  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const webHost = new URL(WEB_URL).hostname;

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

  try {
    await page.route('**/api/issues/preview', async (route) => {
      const data = {
        issueId: 'ISSUE-UI-HERMES-001',
        title: '视觉阶段 Hermes 偏好验收',
        summary: '验证视觉设计阶段自动分配优先使用 Hermes 视觉角色',
        industryCode: 'saas',
        recommendedRoleIds: ['ROLE_ANALYST', 'ROLE_DESIGN'],
        soulRoleId: 'ROLE_ANALYST',
        conflicts: [],
        questions: [],
        refinement: {
          problemStatement: '验证视觉模板下的角色分配偏好',
          expectedOutcome: '团队分配页中 Hermes 视觉角色默认被选中',
          inScopeDraft: ['视觉阶段模板选择', '团队分配默认勾选'],
          outOfScopeDraft: ['后端路由联调'],
          acceptanceDraft: ['Hermes 视觉角色存在且默认勾选'],
        },
        contextAlignment: {
          productName: 'Agent 协作平台',
          missionAnchor: '阶段模板驱动协作',
          matchedGoals: ['模板角色映射'],
          matchedPrinciples: ['可解释'],
          contextNotes: ['UI E2E mocked preview'],
        },
        designBlueprint: {
          designTheme: '控制台',
          valueNarrative: '按阶段精准分配 Agent',
          targetUsers: ['项目经理'],
          coreScenarios: ['选择视觉模板并自动分配 Agent'],
          proposedMilestones: ['分析', '团队分配'],
        },
        suggestedAnswers: [],
        relatedHistory: [],
        requirementContract: {
          objective: '确保视觉阶段优先使用 Hermes 视觉角色',
          inScope: ['视觉阶段模板', '团队角色默认勾选'],
          outOfScope: ['创建确认卡提交'],
          acceptanceCriteria: ['Hermes 角色可见且默认选中'],
          artifacts: ['设计审查卡', '视觉定稿单页'],
        },
        discussion: [],
        discussionDraft: [],
        debate: null,
        debateTask: null,
        analysisGate: {
          canProceed: true,
          blockers: [],
          checks: [{ id: 'ready', label: 'ready', passed: true, detail: 'ok' }],
          runtimeMode: 'scripted',
          requestedRuntimeMode: 'scripted',
        },
        contentProvenance: {
          formalReady: true,
          note: 'UI 测试模拟正式结果',
          summary: 'model_debate',
          refinement: 'model_debate',
          contextAlignment: 'model_debate',
          designBlueprint: 'model_debate',
          suggestedAnswers: 'model_debate',
          requirementContract: 'model_debate',
          discussion: 'model_debate',
          discussionDraft: 'model_debate',
        },
        expectedArtifacts: [
          {
            id: 'artifact-design-review',
            name: '设计审查卡',
            description: '视觉设计阶段产出',
            stageType: 'DESIGN',
            ownerRoleId: 'ROLE_DESIGN',
          },
        ],
        workflow: {
          id: 'workflow-visual_design',
          name: '视觉设计阶段协作流程',
          steps: [
            { order: 1, roleId: 'ROLE_ANALYST', title: '需求澄清', input: 'Issue', output: '设计约束' },
            { order: 2, roleId: 'ROLE_DESIGN', title: '视觉设计', input: '设计约束', output: '视觉定稿' },
          ],
        },
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data }),
      });
    });

    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    const modal = page.getByRole('dialog', { name: '创建新项目' });

    const openProjectModal = async () => {
      await expect(page.getByRole('button', { name: '新建项目' })).toBeVisible({ timeout: 60_000 });
      await page.getByRole('button', { name: '新建项目' }).click();
      await expect(modal).toBeVisible({ timeout: 30_000 });
    };

    const ensureInputStep = async () => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const visible = await modal.isVisible({ timeout: 1_500 }).catch(() => false);
        if (!visible) {
          await openProjectModal();
        }

        const visualStageButton = modal.getByRole('button', { name: /视觉设计阶段/ }).first();
        const ready = await visualStageButton.isVisible({ timeout: 4_000 }).catch(() => false);
        if (ready) {
          return;
        }

        const closeButton = modal.getByRole('button', { name: '关闭弹窗' });
        const closeVisible = await closeButton.isVisible({ timeout: 1_000 }).catch(() => false);
        if (closeVisible) {
          await closeButton.click();
        } else {
          await page.keyboard.press('Escape').catch(() => undefined);
        }
        await modal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
      }

      throw new Error('创建项目弹窗未进入可选择阶段模板的输入步骤');
    };

    await ensureInputStep();

    await modal.getByRole('button', { name: /视觉设计阶段/ }).first().click();
    await modal
      .getByPlaceholder('例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。')
      .fill('验证视觉阶段默认由 Hermes 承担视觉设计角色');

    const parseButton = modal.getByRole('button', {
      name: /AI 分析并分配 Agent|AI 分析中|加载行业配置中/,
    });
    await expect(parseButton).toBeVisible({ timeout: 30_000 });
    const parseEnabled = await parseButton.isEnabled().catch(() => false);
    if (!parseEnabled) {
      await expect(parseButton).toBeEnabled({ timeout: 60_000 });
    }
    await parseButton.click();

    await expect(modal.getByText('需求分析与自动分配')).toBeVisible({ timeout: 60_000 });
    const toTeamButton = modal.getByRole('button', { name: '下一步：团队分配与扩展信息' });
    await expect(toTeamButton).toBeVisible({ timeout: 30_000 });
    const toTeamEnabled = await toTeamButton.isEnabled().catch(() => false);
    if (!toTeamEnabled) {
      await expect(toTeamButton).toBeEnabled({ timeout: 60_000 });
    }
    await toTeamButton.click();

    await expect(modal.getByRole('button', { name: '下一步：创建确认卡' })).toBeVisible({ timeout: 60_000 });
    const hermesCheckboxes = modal.locator('label:has-text("Hermes") input[type="checkbox"]');
    await expect(hermesCheckboxes.first()).toBeVisible({ timeout: 60_000 });
    const total = await hermesCheckboxes.count();
    assert.equal(total > 0, true);

    let hasCheckedHermes = false;
    for (let i = 0; i < total; i += 1) {
      if (await hermesCheckboxes.nth(i).isChecked()) {
        hasCheckedHermes = true;
        break;
      }
    }
    assert.equal(hasCheckedHermes, true);
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
