import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.UI_API_URL || 'http://127.0.0.1:8787';
const UI_REPORT_DIR = 'docs/reports';

type ConfirmPayload = {
  workflowTemplateKey?: string;
  autoStartWorkflow?: boolean;
};

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

test('new project modal should follow selected stage template and submit none correctly', async ({ context, page }) => {
  test.setTimeout(180_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  let capturedConfirmPayload: ConfirmPayload | null = null;

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
        issueId: 'ISSUE-UI-TEMPLATE-001',
        title: 'UI 模板切换验收',
        summary: '用于校验确认卡是否随模板实时更新产出物与 SOP。',
        industryCode: 'saas',
        recommendedRoleIds: ['ROLE_PM', 'ROLE_ANALYST', 'ROLE_DESIGN', 'ROLE_ARCH', 'ROLE_DEV', 'ROLE_QA'],
        soulRoleId: 'ROLE_PM',
        conflicts: [],
        questions: [
          { id: 'goal', question: '本次项目目标是什么？', required: true, placeholder: '例如：提升转化率' },
          { id: 'scope', question: '本次交付范围边界是什么？', required: true, placeholder: '例如：仅 Web 端' },
          { id: 'acceptance', question: '验收标准是什么？', required: true, placeholder: '例如：关键路径可演示' },
        ],
        refinement: {
          problemStatement: '需要验证模板切换后产出不再固定为全流程。',
          expectedOutcome: '确认卡目标产出物与角色要求随模板切换实时变化。',
          inScopeDraft: ['创建项目流程模板切换', '确认卡产出展示'],
          outOfScopeDraft: ['后端模型优化'],
          acceptanceDraft: ['视觉模板仅展示设计产出', 'none 模板不自动初始化 workflow'],
        },
        contextAlignment: {
          productName: 'Agent 协作平台',
          missionAnchor: '提升项目协作效率',
          matchedGoals: ['模板可配置'],
          matchedPrinciples: ['可解释'],
          contextNotes: ['UI 验收脚本模拟'],
        },
        designBlueprint: {
          designTheme: '平台控制台',
          valueNarrative: '按阶段驱动协作',
          targetUsers: ['项目经理'],
          coreScenarios: ['创建项目并选择阶段模板'],
          proposedMilestones: ['分析', '确认'],
        },
        suggestedAnswers: [
          { questionId: 'goal', answer: '验证阶段模板编排', reason: 'UI 验收预填' },
          { questionId: 'scope', answer: '聚焦创建弹窗流程', reason: 'UI 验收预填' },
          { questionId: 'acceptance', answer: '模板切换生效且提交 payload 正确', reason: 'UI 验收预填' },
        ],
        relatedHistory: [],
        requirementContract: {
          objective: '验证 UI 模板编排能力',
          inScope: ['阶段模板选择', '确认卡展示同步'],
          outOfScope: ['模型训练'],
          acceptanceCriteria: ['模板切换后产出同步'],
          artifacts: ['需求分析文档', '项目排期', '设计审查卡', '视觉定稿单页', '技术方案与选型', '实现结果说明', '运行地址与部署说明', '测试报告'],
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
            id: 'artifact-analysis-doc',
            name: '需求分析文档',
            description: '分析文档',
            stageType: 'ANALYSIS',
            ownerRoleId: 'ROLE_ANALYST',
          },
          {
            id: 'artifact-impl-result',
            name: '实现结果说明',
            description: '研发产出',
            stageType: 'DEV',
            ownerRoleId: 'ROLE_DEV',
          },
          {
            id: 'artifact-test-report',
            name: '测试报告',
            description: '验收产出',
            stageType: 'ACCEPT',
            ownerRoleId: 'ROLE_QA',
          },
        ],
        workflow: {
          id: 'workflow-standard_software_development',
          name: '标准软件开发协作流程',
          steps: [
            { order: 1, roleId: 'ROLE_ANALYST', title: '需求理解', input: 'Issue', output: '分析文档' },
            { order: 2, roleId: 'ROLE_DEV', title: '研发实现', input: '技术方案', output: '实现结果' },
            { order: 3, roleId: 'ROLE_QA', title: '验收', input: '实现结果', output: '测试报告' },
          ],
        },
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data }),
      });
    });

    await page.route('**/api/issues/*/confirm', async (route) => {
      const raw = route.request().postData() || '{}';
      capturedConfirmPayload = JSON.parse(raw) as ConfirmPayload;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            issue: { id: 'ISSUE-UI-TEMPLATE-001', status: 'confirmed', createdProjectId: 'P-UI-TEMPLATE-001' },
            project: { id: 'P-UI-TEMPLATE-001', name: 'UI 模板验收项目' },
            backfill: { summary: 'ok', teamRoleIds: ['ROLE_PM'] },
          },
        }),
      });
    });

    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await expect(page.getByRole('button', { name: '新建项目' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: '新建项目' }).click();

    await expect(page.getByText('创建新项目')).toBeVisible();
    await expect(page.getByText('项目策略模式')).toBeVisible();

    await page.getByRole('button', { name: /仅创建项目/ }).first().click();
    await page.getByPlaceholder('例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。')
      .fill('请验证创建项目弹窗中模板切换是否正确影响产出物与创建 payload。');
    await page.getByRole('button', { name: 'AI 分析并分配 Agent' }).click();

    await expect(page.getByText('需求分析与自动分配')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '下一步：团队分配与扩展信息' }).click();

    await expect(page.getByText('团队分配与扩展信息')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/当前行业最少需要\s*\d+\s*个角色/)).toHaveCount(0);
    await page.getByRole('button', { name: '下一步：创建确认卡' }).click();

    await expect(page.getByText('创建前理解确认卡')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /全流程编排（推荐）/ }).click();

    const artifactSectionLabel = page.getByText('目标产出物', { exact: true });
    await expect(artifactSectionLabel).toBeVisible();
    const artifactSection = artifactSectionLabel.locator('xpath=..');
    await expect(artifactSection.getByText('实现结果说明')).toBeVisible();

    await page.getByRole('button', { name: /视觉设计阶段/ }).click();
    await expect(artifactSection.getByText('设计审查卡')).toBeVisible();
    await expect(artifactSection.getByText('视觉定稿单页')).toBeVisible();
    await expect(artifactSection.getByText('实现结果说明')).toHaveCount(0);
    await expect(page.getByText(/当前阶段模板关键角色:\s*需求分析(师)?、视觉设计(总监)?/)).toBeVisible();

    await page.getByRole('button', { name: /代码研发阶段/ }).click();
    await expect(artifactSection.getByText('实现结果说明')).toBeVisible();
    await expect(page.getByText(/当前阶段模板关键角色:\s*需求分析(师)?、(研发总监|架构设计)、(研发经理|研发实现)/)).toBeVisible();
    mkdirSync(UI_REPORT_DIR, { recursive: true });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-workflow-template-visual.png`, fullPage: true });

    await page.getByRole('button', { name: /仅创建项目/ }).first().click();
    await expect(page.getByText('目标产出物', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-workflow-template-none.png`, fullPage: true });

    await page.getByRole('button', { name: '确认创建并启动执行' }).click();

    await expect.poll(() => capturedConfirmPayload !== null).toBeTruthy();
    assert.equal(capturedConfirmPayload?.workflowTemplateKey, 'none');
    assert.equal(capturedConfirmPayload?.autoStartWorkflow, false);
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
