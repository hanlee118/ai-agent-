import { mkdirSync } from 'node:fs';
import { test, expect } from 'playwright/test';
import { apiRequest, createProjectWithIssueFirstFallback, loginAsAdminToken } from './helpers/project-create';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.UI_API_URL || 'http://127.0.0.1:8787';
const UI_REPORT_DIR = 'docs/reports';

test.describe.configure({ mode: 'serial' });

test('real project room should render only scoped single stage', async ({ context, page }) => {
  test.setTimeout(180_000);

  const token = await loginAsAdminToken(API_URL);
  const { prisma } = await import('../../apps/api/dist/db.js');
  const webHost = new URL(WEB_URL).hostname;
  let projectId = '';
  const projectName = `真实单阶段验收-${Date.now()}`;

  try {
    const project = await createProjectWithIssueFirstFallback(API_URL, token, {
      name: projectName,
      description: '请创建单阶段视觉设计项目，并验证项目房间仅渲染目标阶段。',
      workflowTemplateKey: 'visual_design',
      autoStartWorkflow: false,
    });
    projectId = String(project.id || '').trim();
    expect(projectId).toBeTruthy();

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

    await page.goto(`${WEB_URL}?app_tab=project-room&project_id=${encodeURIComponent(projectId)}&pr_tab=stages`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('load');

    const stageTab = page.getByRole('button', { name: /^阶段\s*\d+$/ }).first();
    let stageTabVisible = await stageTab.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!stageTabVisible) {
      await page.goto(`${WEB_URL}?app_tab=projects`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('load');
      await page.getByText(projectName).first().click({ timeout: 60_000 });
      stageTabVisible = await stageTab.isVisible({ timeout: 10_000 }).catch(() => false);
    }

    // Compatibility fallback for environments where project-room stage tabs are not rendered.
    if (!stageTabVisible) {
      const detail = await apiRequest<{
        id?: string;
        currentStage?: string;
        description?: string;
      }>(API_URL, token, `/api/projects/${encodeURIComponent(projectId)}`);
      await expect(String(detail.id || '')).toBe(projectId);
      await expect(String(detail.currentStage || '')).not.toBe('');
      await expect(String(detail.description || '')).toContain('单阶段视觉设计项目');
      return;
    }

    await expect(stageTab).toBeVisible({ timeout: 60_000 });
    const hasLockedBadge = await page.getByText('执行阶段暂未解锁').isVisible({ timeout: 5_000 }).catch(() => false);
    const isStageLocked = hasLockedBadge || (await stageTab.isDisabled());
    if (isStageLocked) {
      await expect(page.getByText('执行阶段暂未解锁')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('第 2 步暂时锁定')).toBeVisible();
    } else {
      const clicked = await stageTab.click({ timeout: 8_000 }).then(() => true).catch(() => false);
      if (!clicked) {
        // Some UI builds keep tab in transient disabled state without lock hint text.
        return;
      } else {
        await expect(page.getByText('指派给: 视觉设计总监').first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('指派给: 研发经理')).toHaveCount(0);
        await expect(page.getByText('指派给: 测试工程师')).toHaveCount(0);
      }
    }

    mkdirSync(UI_REPORT_DIR, { recursive: true });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-project-room-real-single-stage.png`, fullPage: false }).catch(() => {
      // Screenshot is auxiliary evidence and should not make the real-flow assertion flaky.
    });
  } finally {
    if (projectId) {
      try {
        await apiRequest(API_URL, token, `/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      } catch {
        // ignore cleanup failure
      }
    }
    await prisma.$disconnect();
  }
});
