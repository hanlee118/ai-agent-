import { mkdirSync } from 'node:fs';
import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.UI_API_URL || 'http://127.0.0.1:8787';
const TOKEN = String(process.env.UI_TEST_TOKEN || '').trim();
const PROJECT_ID = String(process.env.UI_TEST_PROJECT_ID || '').trim();
const UI_REPORT_DIR = 'docs/reports';

test.describe.configure({ mode: 'serial' });

async function fetchProjectNameById() {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(PROJECT_ID)}`, {
    headers: {
      Cookie: `occ_session=${TOKEN}`,
    },
  });
  if (!response.ok) {
    throw new Error(`fetch project failed: ${response.status}`);
  }
  const payload = await response.json() as { name?: string };
  const name = String(payload?.name || '').trim();
  if (!name) {
    throw new Error('project name is empty');
  }
  return name;
}

test('real project room should render only scoped single stage', async ({ context, page }) => {
  test.setTimeout(120_000);

  if (!TOKEN || !PROJECT_ID) {
    test.skip(true, 'UI_TEST_TOKEN and UI_TEST_PROJECT_ID are required');
    return;
  }

  const webHost = new URL(WEB_URL).hostname;
  const projectName = await fetchProjectNameById();

  await context.addCookies([
    {
      name: 'occ_session',
      value: TOKEN,
      domain: webHost,
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  await page.goto(`${WEB_URL}?app_tab=project-room&project_id=${encodeURIComponent(PROJECT_ID)}&pr_tab=stages`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForLoadState('load');

  const stageTab = page.getByRole('button', { name: /^阶段\s*\d+$/ }).first();
  const stageTabVisible = await stageTab.isVisible({ timeout: 8_000 }).catch(() => false);
  if (!stageTabVisible) {
    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    const activeProjectsPanel = page.locator('div').filter({
      has: page.getByRole('heading', { name: '活跃项目' }),
    }).first();
    await expect(activeProjectsPanel).toBeVisible({ timeout: 60_000 });

    const namedProjectHeading = activeProjectsPanel.getByRole('heading', { name: projectName }).first();
    const hasNamedProject = await namedProjectHeading.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasNamedProject) {
      await namedProjectHeading.click({ force: true });
    } else {
      await activeProjectsPanel.getByText(/•\s*\d+\s*个 Agent/).first().click({ force: true });
    }
  }

  await expect(stageTab).toBeVisible({ timeout: 60_000 });
  await expect(stageTab).toContainText('1');
  const hasLockedBadge = await page.getByText('执行阶段暂未解锁').isVisible({ timeout: 5_000 }).catch(() => false);
  const isStageLocked = hasLockedBadge || (await stageTab.isDisabled());
  if (isStageLocked) {
    await expect(page.getByText('执行阶段暂未解锁')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('第 2 步暂时锁定')).toBeVisible();
  } else {
    await stageTab.click();
    await expect(page.getByText('指派给: 视觉设计总监').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('指派给: 研发经理')).toHaveCount(0);
    await expect(page.getByText('指派给: 测试工程师')).toHaveCount(0);
  }

  mkdirSync(UI_REPORT_DIR, { recursive: true });
  await page.screenshot({ path: `${UI_REPORT_DIR}/ui-project-room-real-single-stage.png`, fullPage: true });
});
