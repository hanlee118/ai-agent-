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

test('issue create-first gate should allow project creation while formal debate is deferred', async ({ context, page }) => {
  test.setTimeout(180_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  let capturedCreatePayload: Record<string, unknown> | null = null;

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
        issueId: 'ISSUE-CREATE-FIRST-001',
        title: '创建优先流程验收',
        summary: '验证正式辩论未完成时，依旧可创建项目骨架。',
        industryCode: 'saas',
        recommendedRoleIds: ['ROLE_ANALYST', 'ROLE_DESIGN'],
        soulRoleId: 'ROLE_ANALYST',
        conflicts: [],
        questions: [
          { id: 'goal', question: '目标是什么？', required: true, placeholder: '例如：验证创建链路' },
          { id: 'scope', question: '范围是什么？', required: true, placeholder: '例如：仅创建流程' },
          { id: 'acceptance', question: '验收标准是什么？', required: true, placeholder: '例如：可创建+可跳转' },
        ],
        refinement: {
          problemStatement: '正式辩论偶发超时会阻塞 Issue 到项目落地。',
          expectedOutcome: '项目先创建，辩论后置补齐。',
          inScopeDraft: ['Issue 解析', '团队分配', '项目创建'],
          outOfScopeDraft: ['模型能力优化'],
          acceptanceDraft: ['可先创建项目骨架', '正式辩论后置执行'],
        },
        contextAlignment: {
          productName: 'Agent 协作平台',
          missionAnchor: '保障流程稳定落地',
          matchedGoals: ['创建不阻塞'],
          matchedPrinciples: ['先落地后增强'],
          contextNotes: ['UI 自动化 mock'],
        },
        designBlueprint: {
          designTheme: '运营控制台',
          valueNarrative: '先交付可执行骨架',
          targetUsers: ['项目经理'],
          coreScenarios: ['Issue 到项目创建'],
          proposedMilestones: ['创建', '后置辩论'],
        },
        suggestedAnswers: [
          { questionId: 'goal', answer: '先创建项目骨架', reason: '创建优先策略' },
          { questionId: 'scope', answer: '仅覆盖创建与跳转', reason: '缩小首轮范围' },
          { questionId: 'acceptance', answer: '创建成功且辩论后置', reason: '稳定性优先' },
        ],
        relatedHistory: [],
        requirementContract: {
          objective: '创建优先 + 辩论后置',
          inScope: ['创建项目', '分配团队'],
          outOfScope: ['辩论结果质量优化'],
          acceptanceCriteria: ['创建链路不阻断'],
          artifacts: ['需求分析文档', '项目排期'],
        },
        discussion: [],
        discussionDraft: [
          {
            id: 'd1',
            roleId: 'ROLE_ANALYST',
            roleLabel: '需求分析师',
            focus: '先创建后补齐',
            concern: '避免超时阻塞主链路',
            proposal: '创建后异步补齐正式辩论',
          },
        ],
        debate: null,
        debateTask: {
          taskId: 'debate-ISSUE-CREATE-FIRST-001-aaaa1111',
          status: 'running',
          pollAfterMs: 1200,
        },
        analysisGate: {
          canProceed: false,
          canCreateProject: true,
          blockers: ['真实模型多角色讨论仍在进行中，需等待完成后再推进。'],
          createBlockers: [],
          checks: [
            { id: 'runtime-real-model', label: '运行时必须启用真实模型', passed: true, detail: 'ok' },
            { id: 'debate-enabled', label: '必须启用真实多角色讨论', passed: true, detail: 'ok' },
            {
              id: 'debate-model-completed',
              label: '正式讨论必须由真实模型完成',
              passed: false,
              detail: '真实模型多角色讨论仍在进行中，需等待完成后再推进。',
            },
          ],
          runtimeMode: 'model',
          requestedRuntimeMode: 'model',
        },
        contentProvenance: {
          formalReady: false,
          note: '正式辩论尚未完成，可先创建项目骨架。',
          summary: 'rule_draft',
          refinement: 'rule_draft',
          contextAlignment: 'rule_draft',
          designBlueprint: 'rule_draft',
          suggestedAnswers: 'rule_draft',
          requirementContract: 'rule_draft',
          discussion: 'rule_draft',
          discussionDraft: 'rule_draft',
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

    await page.route('**/api/projects', async (route) => {
      const raw = route.request().postData() || '{}';
      capturedCreatePayload = JSON.parse(raw) as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'P-CREATE-FIRST-001',
          name: '创建优先验收项目',
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
            projectId: 'P-CREATE-FIRST-001',
            projectName: '创建优先验收项目',
            projectPath: 'root/ai-agent-workbench',
            projectIssueIid: 1001,
            stageType: 'ANALYSIS',
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

    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    await expect(page.getByRole('button', { name: '新建项目' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: '新建项目' }).click();

    await expect(page.getByText('创建新项目')).toBeVisible();
    await expect(page.getByText('主流程已切换为创建优先：先完成团队分配并创建项目骨架，分析草案为可选补充步骤。')).toBeVisible();
    await page.getByRole('button', { name: /视觉设计阶段/ }).first().click();
    await page.getByPlaceholder('例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。')
      .fill('请按“先创建项目骨架，再后置正式辩论”的策略落地。');
    await page.getByRole('button', { name: '可选：生成 AI 建议' }).click();

    await expect(page.getByText('团队分配与扩展信息')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '查看分析草案（可选）' }).click();
    await expect(page.getByText('需求分析与自动分配')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Create-first 已启用', { exact: true })).toBeVisible();
    await expect(page.getByText('可先创建项目骨架', { exact: true })).toBeVisible();
    await expect(page.getByText('可先创建项目骨架，正式辩论后置')).toBeVisible();
    await page.getByText('Create-first 已启用', { exact: true }).scrollIntoViewIfNeeded();
    mkdirSync(UI_REPORT_DIR, { recursive: true });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-issue-create-first-analysis.png`, fullPage: true });

    await page.getByRole('button', { name: '下一步：团队分配与扩展信息' }).click();
    await expect(page.getByText('团队分配与扩展信息')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-issue-create-first-team.png`, fullPage: true });

    await page.getByRole('button', { name: '下一步：创建确认卡' }).click();
    await expect(page.getByText('创建确认卡（需求确认后置）')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Create-first 模式：项目骨架将先创建，正式辩论后置补齐')).toBeVisible();
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-issue-create-first-confirm.png`, fullPage: true });

    const createButton = page.getByRole('button', { name: '确认创建并启动执行' });
    await expect(createButton).toBeEnabled();
    await createButton.click();

    await expect.poll(() => capturedCreatePayload !== null).toBeTruthy();
    assert.equal(capturedCreatePayload?.workflowTemplateKey, 'visual_design');
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
