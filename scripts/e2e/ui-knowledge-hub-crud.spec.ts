import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { test, expect } from 'playwright/test';

const WEB_URL = process.env.UI_WEB_URL || 'http://127.0.0.1:5173';
const UI_REPORT_DIR = 'docs/reports';

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

test('knowledge hub should support create text, upload document and edit', async ({ context, page }) => {
  test.setTimeout(180_000);

  const { prisma, token, hashSessionToken } = await createTemporarySessionCookie();
  const mark = `E2E-KB-${Date.now()}`;
  const projectId = `P-${mark}`;
  const textTitle = `${mark}-text`;
  const uploadFileName = `${mark}-upload.md`;
  const uploadContent = `# ${mark}\n\n这是一条用于 UI 自动化验收的知识文档。\n`;

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

  page.on('dialog', (dialog) => {
    void dialog.accept();
  });

  try {
    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    await expect(page.getByRole('button', { name: '知识库（上传/编辑）' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: '知识库（上传/编辑）' }).click();
    await expect(page.getByText('知识治理中心')).toBeVisible({ timeout: 30_000 });

    const manualPanel = page
      .locator('div.rounded-2xl')
      .filter({ has: page.getByRole('heading', { name: '手动补充知识' }) })
      .first();
    await manualPanel.getByPlaceholder('projectId（可选）').first().fill(projectId);
    await manualPanel.getByPlaceholder('tags: 逗号分隔').first().fill(mark.toLowerCase());
    await manualPanel.getByPlaceholder('标题').first().fill(textTitle);
    await manualPanel.getByPlaceholder('文本知识内容').fill(`${mark} 文本知识内容`);
    await manualPanel.getByRole('button', { name: '创建文本知识' }).click();

    await expect(page.getByText('已自动切换到新增条目作用域并定位到该知识')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('cell', { name: textTitle })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('cell', { name: textTitle }).click();
    const editPanel = page
      .locator('div.rounded-2xl')
      .filter({ has: page.getByRole('heading', { name: '条目编辑' }) })
      .first();
    await editPanel.locator('textarea').first().fill(`${mark} 文本知识内容\n已编辑`);
    await editPanel.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('知识条目已更新')).toBeVisible({ timeout: 20_000 });

    const uploadInput = manualPanel.locator('input[type="file"]');
    await uploadInput.setInputFiles({
      name: uploadFileName,
      mimeType: 'text/markdown',
      buffer: Buffer.from(uploadContent, 'utf-8'),
    });
    await manualPanel.getByRole('button', { name: '导入文档为知识' }).click();

    await expect(page.getByText('已自动切换到导入文档作用域并定位最新条目')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('cell', { name: new RegExp(uploadFileName, 'i') })).toBeVisible({ timeout: 30_000 });

    mkdirSync(UI_REPORT_DIR, { recursive: true });
    await page.screenshot({ path: `${UI_REPORT_DIR}/ui-knowledge-hub-crud.png`, fullPage: true });
  } finally {
    try {
      await prisma.knowledgeItem.deleteMany({
        where: {
          OR: [
            { title: { contains: mark } },
            { content: { contains: mark } },
          ],
        },
      });
    } catch {
      // ignore cleanup errors in UI automation
    }
    await prisma.authSession.deleteMany({
      where: { tokenHash: await hashSessionToken(token) },
    });
    await prisma.$disconnect();
  }
});
