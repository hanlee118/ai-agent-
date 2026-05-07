import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { test, expect } from 'playwright/test';
import { loginAsAdminToken } from './helpers/project-create';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const UI_REPORT_DIR = 'docs/reports';

type CreatePayload = {
  name?: string;
  description?: string;
  workflowTemplateKey?: string;
  autoStartWorkflow?: boolean;
  projectType?: 'complete' | 'standalone' | 'relay';
};

test.describe.configure({ mode: 'serial' });

test('new project modal should submit selected workflow template in create-first flow', async ({ context, page }) => {
  test.setTimeout(180_000);

  const token = await loginAsAdminToken(process.env.UI_API_URL || 'http://127.0.0.1:8787');
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

    await page.goto(`${WEB_URL}?app_tab=projects`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    const openCreateModal = async () => {
      const trigger = page.getByRole('button', { name: /新建项目|创建项目/ }).first();
      await expect(trigger).toBeVisible({ timeout: 60_000 });
      await trigger.click({ force: true });
      const modal = page.locator('[role="dialog"]').filter({ hasText: '创建新项目' }).first();
      const opened = await modal.isVisible({ timeout: 4000 }).catch(() => false);
      if (!opened) {
        await trigger.click({ force: true });
        await expect(modal).toBeVisible({ timeout: 20_000 });
      }
      return modal;
    };

    const createModal = await openCreateModal();
    await expect(createModal.getByText('项目策略模式').first()).toBeVisible();
    await expect(createModal.getByText('执行阶段模板').first()).toBeVisible();

    const pickStandaloneMode = createModal.getByRole('button', { name: /单阶段交付/ }).first();
    await expect(pickStandaloneMode).toBeVisible({ timeout: 30_000 });
    await pickStandaloneMode.click({ force: true });

    const pickVisual = createModal.getByRole('button', { name: /视觉设计阶段/ }).first();
    await expect(pickVisual).toBeVisible({ timeout: 30_000 });
    await pickVisual.click({ force: true });
    await expect(createModal.getByText(/当前选择：视觉设计阶段/)).toBeVisible();
    await expect(createModal.getByText(/关键角色: 需求分析师、视觉设计总监/).first()).toBeVisible();

    const pickDev = createModal.getByRole('button', { name: /代码研发阶段/ }).first();
    await expect(pickDev).toBeVisible({ timeout: 30_000 });
    await pickDev.click({ force: true });
    await expect(createModal.getByText(/当前选择：代码研发阶段/)).toBeVisible();
    await expect(createModal.getByText(/关键角色: 需求分析师、研发总监、研发经理/).first()).toBeVisible();

    const pickStandalone = createModal.getByRole('button', { name: /仅创建项目/ }).first();
    await expect(pickStandalone).toBeVisible({ timeout: 30_000 });
    await pickStandalone.click({ force: true });
    await expect(createModal.getByText(/当前选择：仅创建项目/)).toBeVisible();
    await expect(createModal.getByLabel('创建后自动启动 workflow')).toBeDisabled();

    await createModal
      .getByPlaceholder('例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。')
      .fill('请验证创建项目弹窗中模板切换是否正确影响创建 payload。');
    await createModal.getByRole('button', { name: '创建项目（先创建后分析）' }).click();

    await expect.poll(() => capturedCreatePayload !== null).toBeTruthy();
    assert.equal(capturedCreatePayload?.workflowTemplateKey, 'none');
    assert.equal(capturedCreatePayload?.autoStartWorkflow, false);
    assert.equal(capturedCreatePayload?.projectType, 'standalone');

    mkdirSync(UI_REPORT_DIR, { recursive: true });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-workflow-template-create-first.png`, fullPage: true });
  } finally {
    // no-op
  }
});
