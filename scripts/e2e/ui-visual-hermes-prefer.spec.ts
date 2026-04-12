import assert from 'node:assert/strict';
import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';

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

test('visual design template prefers Hermes agent selection for design role', async ({ context, page }) => {
  test.setTimeout(120_000);
  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();

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
    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '新建项目' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: '新建项目' }).click();
    await expect(page.getByText('创建新项目')).toBeVisible();

    await page.getByRole('button', { name: /视觉设计阶段/ }).first().click();
    await page.getByPlaceholder('例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。')
      .fill('验证视觉阶段默认由 Hermes 承担视觉设计角色');
    await page.getByRole('button', { name: '继续：团队分配' }).click();

    await expect(page.getByText('团队分配与扩展信息')).toBeVisible({ timeout: 30_000 });
    const hermesCheckbox = page.locator('label:has-text("Hermes Agent") input[type="checkbox"]');
    await expect(hermesCheckbox).toBeVisible();
    assert.equal(await hermesCheckbox.isChecked(), true);
  } finally {
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
