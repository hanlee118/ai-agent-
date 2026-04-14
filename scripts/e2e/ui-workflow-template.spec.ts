import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const UI_REPORT_DIR = 'docs/reports';

type CreatePayload = {
  name?: string;
  description?: string;
  workflowTemplateKey?: string;
  autoStartWorkflow?: boolean;
  projectType?: 'complete' | 'standalone' | 'relay';
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

test('new project modal should submit selected workflow template in create-first flow', async ({ context, page }) => {
  test.setTimeout(180_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  let capturedCreatePayload: CreatePayload | null = null;

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
    await page.route('**/api/projects', async (route) => {
      if (route.request().method().toUpperCase() !== 'POST') {
        await route.continue();
        return;
      }
      const raw = route.request().postData() || '{}';
      capturedCreatePayload = JSON.parse(raw) as CreatePayload;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'P-UI-TEMPLATE-001',
            name: capturedCreatePayload.name || 'UI 模板验收项目',
            description: capturedCreatePayload.description || '',
            status: 'active',
            phase: '规划中',
            progress: 0,
            owner: '系统',
            agents: [],
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
    await expect(page.getByText('执行阶段模板')).toBeVisible();

    await page.getByRole('button', { name: /视觉设计阶段/ }).click();
    await expect(page.getByText(/当前选择：视觉设计阶段/)).toBeVisible();
    await expect(page.getByText(/关键角色: 需求分析师、视觉设计总监/).first()).toBeVisible();

    await page.getByRole('button', { name: /代码研发阶段/ }).click();
    await expect(page.getByText(/当前选择：代码研发阶段/)).toBeVisible();
    await expect(page.getByText(/关键角色: 需求分析师、研发总监、研发经理/).first()).toBeVisible();

    await page.getByRole('button', { name: /仅创建项目/ }).first().click();
    await expect(page.getByText(/当前选择：仅创建项目/)).toBeVisible();
    await expect(page.getByLabel('创建后自动启动 workflow')).toBeDisabled();

    await page
      .getByPlaceholder('例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。')
      .fill('请验证创建项目弹窗中模板切换是否正确影响创建 payload。');
    await page.getByRole('button', { name: '创建项目（先创建后分析）' }).click();

    await expect.poll(() => capturedCreatePayload !== null).toBeTruthy();
    assert.equal(capturedCreatePayload?.workflowTemplateKey, 'none');
    assert.equal(capturedCreatePayload?.autoStartWorkflow, false);
    assert.equal(capturedCreatePayload?.projectType, 'standalone');

    mkdirSync(UI_REPORT_DIR, { recursive: true });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-workflow-template-create-first.png`, fullPage: true });
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
