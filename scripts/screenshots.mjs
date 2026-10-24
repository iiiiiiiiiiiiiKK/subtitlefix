import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

/**
 * Captures the README screenshots from the *real* production build.
 * Start the preview server first, then run this script:
 *   node node_modules/vite/bin/vite.js preview --port 4899 --strictPort
 *   node scripts/screenshots.mjs
 */
const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4899';
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

const DARK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' };
const LIGHT = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' };
const PHONE = { ...devices['iPhone 13'], deviceScaleFactor: 2, colorScheme: 'dark' };

const BILINGUAL_PASTE = `1
00:00:01,200 --> 00:00:03,300
Welcome to SubtitleFix.

2
00:00:03,400 --> 00:00:05,900
This cue overlaps the previous one by 300ms.

3
00:00:04,900 --> 00:00:08,000
This cue starts after it ends.

4
00:00:10,100 --> 00:00:11,900
An empty cue.

5
00:00:14,100 --> 00:00:15,900
A dot was used instead of a comma.
`;

async function loadSample(page) {
  await page.getByRole('button', { name: /破损 SRT/ }).first().click();
  await page.waitForTimeout(500);
}

const browser = await chromium.launch();

// 1 — empty landing (dark)
{
  const ctx = await browser.newContext(DARK);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/01-landing.png` });
  await ctx.close();
}

// 2 — workbench with problems (dark, desktop)
{
  const ctx = await browser.newContext(DARK);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await loadSample(page);
  await page.getByTestId('cue-row-2').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/02-workbench.png` });
  await ctx.close();
}

// 3 — light theme
{
  const ctx = await browser.newContext(LIGHT);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await loadSample(page);
  await page.getByTestId('cue-row-1').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/03-light.png` });
  await ctx.close();
}

// 4 — search & replace preview
{
  const ctx = await browser.newContext(DARK);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await loadSample(page);
  await page.getByTestId('btn-search').click();
  await page.getByRole('tab', { name: '批量替换' }).click();
  await page.getByTestId('search-input').fill('字幕');
  await page.getByTestId('replace-input').fill('Subtitle');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/04-replace.png` });
  await ctx.close();
}

// 5 — export dialog with diff
{
  const ctx = await browser.newContext(DARK);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await loadSample(page);
  await page.getByTestId('btn-fix').click();
  await page.waitForTimeout(300);
  await page.getByTestId('btn-export').click();
  await page.getByRole('button', { name: /查看差异/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05-export-diff.png` });
  await ctx.close();
}

// 6 — bilingual merge
{
  const ctx = await browser.newContext(DARK);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await loadSample(page);
  await page.getByTestId('btn-bilingual').click();
  await page.getByRole('tab', { name: '粘贴副轨文本' }).click();
  await page.locator('#bilingual-paste').fill(BILINGUAL_PASTE);
  await page.getByRole('button', { name: '解析这段文本' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/06-bilingual.png` });
  await ctx.close();
}

// 7/8/9 — iPhone: list, editor, issues
{
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await loadSample(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/07-iphone-list.png` });
  await page.getByTestId('cue-row-1').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/08-iphone-editor.png` });
  await page.getByRole('tab', { name: /问题/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/09-iphone-issues.png` });
  await ctx.close();
}

await browser.close();
console.log('screenshots written to', OUT);
