import assert from 'node:assert/strict';
import { test, expect } from 'playwright/test';
import { apiRequest } from './helpers/project-create';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.UI_API_URL || 'http://127.0.0.1:8787';

type CreatePayload = {
  name?: string;
  description?: string;
  team?: string[];
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

test('visual design template prefers Hermes agent selection for design role in create-first flow', async ({ context, page }) => {
  test.setTimeout(180_000);
  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const webHost = new URL(WEB_URL).hostname;
  let capturedCreatePayload: CreatePayload | null = null;

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
            id: 'P-UI-HERMES-001',
            name: capturedCreatePayload.name || 'Hermes 偏好验收项目',
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

    const modal = page.getByRole('dialog', { name: '创建新项目' });
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await modal.getByRole('button', { name: /视觉设计阶段/ }).first().click();
    await expect(modal.getByText(/当前选择：视觉设计阶段/)).toBeVisible({ timeout: 30_000 });
    await expect(modal.getByText(/关键角色: 需求分析师、视觉设计总监/).first()).toBeVisible({ timeout: 30_000 });

    await modal.getByRole('button', { name: '手动填写' }).click();
    const hermesDesignCheckbox = modal.locator('label:has-text("视觉设计总监"):has-text("Hermes") input[type="checkbox"]');
    await expect(hermesDesignCheckbox.first()).toBeVisible({ timeout: 60_000 });
    assert.equal((await hermesDesignCheckbox.count()) > 0, true);

    await modal
      .getByPlaceholder('例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。')
      .fill('验证视觉阶段默认由 Hermes 承担视觉设计角色');
    await modal.getByRole('button', { name: '创建项目（先创建后分析）' }).click();

    await expect.poll(() => capturedCreatePayload !== null, { timeout: 30_000 }).toBeTruthy();
    assert.equal(capturedCreatePayload?.workflowTemplateKey, 'visual_design');
    assert.equal(capturedCreatePayload?.projectType, 'standalone');
    assert.equal(capturedCreatePayload?.autoStartWorkflow, true);

    const team = (capturedCreatePayload?.team || []).map((item) => String(item).trim().toUpperCase());
    assert.equal(team.includes('ROLE_ANALYST'), true);
    assert.equal(team.includes('ROLE_DESIGN'), true);

    const agentsResponse = await apiRequest<{ data?: Array<{ role?: string; name?: string; integrationEngine?: string }> } | Array<{ role?: string; name?: string; integrationEngine?: string }>>(
      API_URL,
      token,
      '/api/agents',
    );
    const agentList = Array.isArray(agentsResponse) ? agentsResponse : (agentsResponse?.data || []);
    const hasHermesDesignAgent = agentList.some((agent) => {
      const engine = String(agent.integrationEngine || '').trim().toLowerCase();
      const role = String(agent.role || '').trim().toUpperCase();
      const name = String(agent.name || '').trim().toLowerCase();
      return engine === 'hermes' && (role === 'ROLE_DESIGN' || /视觉|设计|design|ui|ux/.test(name));
    });
    assert.equal(hasHermesDesignAgent, true);
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
