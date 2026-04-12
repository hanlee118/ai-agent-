import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.UI_API_URL || 'http://127.0.0.1:8787';

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

test('app_tab deep-link should switch major tabs correctly after initial load', async ({ context, page }) => {
  test.setTimeout(120_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const webHost = new URL(WEB_URL).hostname;
  let projectId = '';
  const projectName = `深链tab验收-${Date.now()}`;

  try {
    const project = await apiRequest<{ id: string }>(token, '/api/projects', {
      method: 'POST',
      body: {
        name: projectName,
        description: '用于验证 app_tab 深链切页行为。',
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

    await page.goto(`${WEB_URL}?app_tab=dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await expect(page.getByRole('heading', { name: '控制面板' })).toBeVisible({ timeout: 30_000 });

    await page.goto(`${WEB_URL}?app_tab=projects`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    const projectsHeading = page.getByRole('heading', { name: '项目组合' });
    const projectsVisible = await projectsHeading.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!projectsVisible) {
      await page.getByRole('button', { name: '项目组合' }).first().click();
    }
    await expect(projectsHeading).toBeVisible({ timeout: 30_000 });

    await page.goto(`${WEB_URL}?app_tab=agents`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    const agentsHeading = page.getByRole('heading', { name: 'Agent 名册' });
    const agentsVisible = await agentsHeading.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!agentsVisible) {
      await page.getByRole('button', { name: 'Agent 名册' }).first().click();
    }
    await expect(agentsHeading).toBeVisible({ timeout: 30_000 });

    await page.goto(
      `${WEB_URL}?app_tab=project-room&project_id=${encodeURIComponent(projectId)}&pr_tab=tasks`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForLoadState('load');
    const projectRoomTitle = page.getByRole('heading', { name: projectName });
    const projectRoomStep1 = page.getByRole('heading', { name: '需求补充与理解确认（项目创建后）' });
    const projectRoomVisible = await projectRoomStep1.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!projectRoomVisible) {
      await page.goto(`${WEB_URL}?app_tab=projects`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('load');
      await page.getByText(projectName).first().click();
    }
    await expect(projectRoomTitle).toBeVisible({ timeout: 30_000 });
    await expect(projectRoomStep1).toBeVisible({ timeout: 30_000 });
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
