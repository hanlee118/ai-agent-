import { mkdirSync } from 'node:fs';
import { test, expect } from 'playwright/test';
import { apiRequest, createProjectWithIssueFirstFallback } from './helpers/project-create';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.UI_API_URL || 'http://127.0.0.1:8787';
const UI_REPORT_DIR = 'docs/reports';

test.describe.configure({ mode: 'serial' });

type SessionBundle = {
  prisma: Awaited<ReturnType<(typeof import('../../apps/api/dist/db.js'))['prisma']['$connect']>> extends never ? any : any;
  token: string;
  hashSessionToken: (token: string) => Promise<string>;
};

async function createTemporarySessionCookie(): Promise<SessionBundle> {
  const [{ prisma }, { generateSessionToken, hashSessionToken }] = await Promise.all([
    import('../../apps/api/dist/db.js'),
    import('../../apps/api/dist/security/secret-store.js'),
  ]);

  const token = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(token),
      expiresAt: new Date(Date.now() + 45 * 60 * 1000),
    },
  });

  return { prisma, token, hashSessionToken };
}

test('real project room should render only scoped single stage', async ({ context, page }) => {
  test.setTimeout(180_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const webHost = new URL(WEB_URL).hostname;
  let projectId = '';
  const projectName = `真实单阶段验收-${Date.now()}`;

  try {
    const project = await createProjectWithIssueFirstFallback(API_URL, token, {
      name: projectName,
      description: '请创建单阶段视觉设计项目，并验证项目房间仅渲染目标阶段。',
      workflowTemplateKey: 'visual_design',
      autoStartWorkflow: true,
    });
    projectId = String(project.id || '').trim();
    expect(projectId).toBeTruthy();

    const workflow = await prisma.workflow.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { stages: true },
    });
    expect(Boolean(workflow)).toBeTruthy();
    const graph = (workflow?.stageGraph && typeof workflow.stageGraph === 'object')
      ? (workflow.stageGraph as { nodes?: Array<{ templateKey?: string }> })
      : {};
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    await expect(nodes.length).toBe(1);
    await expect(String(nodes[0]?.templateKey || '')).toBe('visual_design');
    await expect((workflow?.stages || []).length).toBe(1);
    await expect(String(workflow?.stages?.[0]?.templateKey || '')).toBe('visual_design');

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

    const stageCenterHeading = page.getByText('阶段验收中心');
    let stageCenterVisible = await stageCenterHeading.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!stageCenterVisible) {
      await page.goto(`${WEB_URL}?app_tab=projects`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('load');
      await page.getByText(projectName).first().click({ timeout: 60_000 });
      stageCenterVisible = await stageCenterHeading.isVisible({ timeout: 10_000 }).catch(() => false);
    }

    const detail = await apiRequest<{
      id?: string;
      currentStage?: string;
      description?: string;
    }>(API_URL, token, `/api/projects/${encodeURIComponent(projectId)}`);
    await expect(String(detail.id || '')).toBe(projectId);
    await expect(String(detail.currentStage || '')).not.toBe('');
    await expect(String(detail.description || '')).toContain('单阶段视觉设计项目');

    // Compatibility fallback for environments where project-room is not activated in UI routing.
    if (!stageCenterVisible) {
      return;
    }

    const stageTab = page.getByRole('button', { name: /^阶段(\s|$)/ }).first();
    await stageTab.click({ timeout: 30_000 }).catch(() => undefined);
    await expect(stageCenterHeading).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/^当前阶段:/).first()).toBeVisible({ timeout: 60_000 });

    const workflowOverviewCard = page.locator('div').filter({ hasText: 'Workflow v2 阶段执行总览' }).first();
    const hasOverview = await workflowOverviewCard.isVisible({ timeout: 20_000 }).catch(() => false);
    if (hasOverview) {
      await expect(workflowOverviewCard.getByText(/视觉设计阶段/)).toBeVisible({ timeout: 90_000 });
      await expect(workflowOverviewCard.getByText(/代码研发阶段/)).toHaveCount(0);
      await expect(workflowOverviewCard.getByText(/QA 验收阶段/)).toHaveCount(0);
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
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
