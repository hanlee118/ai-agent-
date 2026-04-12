import { mkdirSync } from 'node:fs';
import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.UI_API_URL || 'http://127.0.0.1:8787';
const UI_REPORT_DIR = 'docs/reports';

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

async function apiRequest<T>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: init?.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `occ_session=${token}`,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!response.ok) {
    throw new Error(`api ${init?.method || 'GET'} ${path} failed: ${response.status}`);
  }
  return await response.json() as T;
}

test.describe.configure({ mode: 'serial' });

test('page-level acceptance should keep all major pages reachable without 5xx api', async ({ context, page }) => {
  test.setTimeout(240_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const webHost = new URL(WEB_URL).hostname;
  let projectId = '';
  const projectName = `页面级验收-${Date.now()}`;
  const api5xxErrors: Array<{ status: number; url: string }> = [];

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 500 && /\/api\//.test(url)) {
      api5xxErrors.push({ status, url });
    }
  });

  try {
    const project = await apiRequest<{ id: string }>(token, '/api/projects', {
      method: 'POST',
      body: {
        name: projectName,
        description: '用于页面级验收：逐页检查平台主页面是否可访问并可渲染。',
        workflowTemplateKey: 'visual_design',
        autoStartWorkflow: false,
      },
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

    mkdirSync(UI_REPORT_DIR, { recursive: true });
    const openSidebarTab = async (label: string) => {
      await page.getByRole('button', { name: label }).first().click();
      await page.waitForLoadState('load');
    };

    await page.goto(`${WEB_URL}?app_tab=dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await expect(page.getByRole('heading', { name: '控制面板' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-dashboard.png`, fullPage: true });

    await openSidebarTab('项目组合');
    await expect(page.getByRole('heading', { name: '项目组合' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-projects.png`, fullPage: true });

    await page.getByText(projectName).first().click();
    await expect(page.getByText('需求补充与理解确认（项目创建后）')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-project-room.png`, fullPage: true });

    await openSidebarTab('Agent 名册');
    await expect(page.getByRole('heading', { name: 'Agent 名册' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-agents.png`, fullPage: true });

    await page.getByRole('button', { name: '命令' }).first().click();
    await expect(page.getByPlaceholder('输入命令或提出问题...')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-agent-commander.png`, fullPage: true });

    await openSidebarTab('模型中心');
    await expect(page.getByRole('heading', { name: '模型资源中心' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-model-nexus.png`, fullPage: true });

    await openSidebarTab('实时监控');
    await expect(page.getByRole('heading', { name: '实时监控 (Nexus)' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-monitoring.png`, fullPage: true });

    await openSidebarTab('工作区');
    await expect(page.getByRole('heading', { name: 'OpenClaw 工作区' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-workspace.png`, fullPage: true });

    await openSidebarTab('知识库（上传/编辑）');
    await expect(page.getByRole('heading', { name: '知识治理中心' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-knowledge-hub.png`, fullPage: true });

    await openSidebarTab('系统运行');
    await expect(page.getByRole('heading', { name: '系统运行' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-system-health.png`, fullPage: true });

    await openSidebarTab('审计追踪');
    await expect(page.getByRole('heading', { name: '审计追踪' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-audit.png`, fullPage: true });

    await openSidebarTab('设置');
    await expect(page.getByRole('heading', { name: '设置中心' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-platform-page-settings.png`, fullPage: true });

    expect(api5xxErrors, `发现 API 5xx 错误: ${JSON.stringify(api5xxErrors, null, 2)}`).toHaveLength(0);
  } finally {
    if (projectId) {
      try {
        await apiRequest(token, `/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
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
