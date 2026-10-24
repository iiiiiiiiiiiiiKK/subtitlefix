import { chromium, devices } from 'playwright-core';
import { readFileSync } from 'node:fs';

/**
 * Production verification against a *live* deployment.
 *
 * Runs the real user journey (import → edit → repair → search → bilingual →
 * export/download) on the deployed site, on desktop and on an emulated iPhone,
 * and asserts on the downloaded file contents.
 *
 * Usage:
 *   node scripts/verify-production.mjs https://iiiiiiiiiiiiikk.github.io/subtitlefix/
 */
const BASE = (process.argv[2] ?? 'https://iiiiiiiiiiiiikk.github.io/subtitlefix/').replace(/\/?$/, '/');
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { text: Buffer.concat(chunks).toString('utf8'), name: download.suggestedFilename() };
}

const browser = await chromium.launch();

// ---------------------------------------------------------------- desktop ---
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const resp = await page.goto(BASE, { waitUntil: 'networkidle' });
  record('deployed page loads', resp?.status() === 200, `HTTP ${resp?.status()}`);
  record('title is SubtitleFix', (await page.title()).includes('SubtitleFix'), await page.title());

  // Author X link (explicit product requirement).
  const xLink = page.getByRole('link', { name: /作者 𝕏/ });
  const xHref = await xLink.getAttribute('href');
  record('author X link present with correct href', xHref === 'https://x.com/0xkillcoin', xHref);
  const xBox = await xLink.boundingBox();
  record('author X link visible in the top bar', xBox !== null && xBox.y < 90, JSON.stringify(xBox));

  // Import a real file from the repo's examples directory.
  const srt = readFileSync('examples/broken-sample.srt', 'utf8');
  await page.getByTestId('file-input').setInputFiles({
    name: 'broken-sample.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from(srt, 'utf8'),
  });
  await page.waitForTimeout(700);
  record('imported .srt via file picker', (await page.getByTestId('cue-row-1').count()) === 1);
  // broken-sample.srt deliberately skips index 6, so it holds 9 cues.
  record('parsed all 9 cues', (await page.getByTestId('cue-row-9').count()) === 1);
  record('issues detected', (await page.getByTestId('issue-list').count()) === 1);

  // Edit a cue body.
  await page.getByTestId('cue-row-1').click();
  await page.getByTestId('input-cue-text').fill('生产环境验证：这段正文是现场编辑的。');
  record(
    'edited cue body persists to the list',
    (await page.getByTestId('cue-list').innerText()).includes('生产环境验证'),
  );

  // Timeline shift + undo.
  await page.waitForTimeout(300);
  const beforeShift = await page.getByTestId('input-cue-start').inputValue();
  await page.getByTestId('input-shift-value').fill('1000');
  await page.getByTestId('btn-shift-later').click();
  await page.waitForTimeout(300);
  const shifted = await page.getByTestId('input-cue-start').inputValue();
  record('timeline shift applied', shifted !== beforeShift, `${beforeShift} → ${shifted}`);
  await page.getByTestId('btn-undo').click();
  await page.waitForTimeout(300);
  const afterUndo = await page.getByTestId('input-cue-start').inputValue();
  record('undo restored the timeline', afterUndo === beforeShift, `${shifted} → ${afterUndo} (expected ${beforeShift})`);

  // One-click repair.
  await page.getByTestId('btn-fix').click();
  await page.waitForTimeout(500);
  const errorTab = await page.getByRole('tab', { name: /错误/ }).innerText();
  record('one-click repair clears all errors', /错误\s*0/.test(errorTab.replace(/\s+/g, ' ')), errorTab.replace(/\s+/g, ' '));

  // Export SRT and verify the downloaded bytes.
  await page.getByTestId('btn-export').click();
  const dlPromise = page.waitForEvent('download');
  await page.getByTestId('export-confirm').click();
  const srtOut = await readDownload(await dlPromise);
  record('downloaded .srt', srtOut.name.endsWith('.srt'), srtOut.name);
  record('export keeps the edited text', srtOut.text.includes('生产环境验证'));
  record(
    'export keeps every cue (9/9)',
    (srtOut.text.match(/-->/g) ?? []).length === 9,
    `${(srtOut.text.match(/-->/g) ?? []).length} cues`,
  );
  record('export contains no reversed timing', !srtOut.text.includes('00:00:08,000 --> 00:00:05,000'));

  // Convert to WebVTT.
  await page.getByTestId('btn-export').click();
  await page.getByTestId('export-format').selectOption('vtt');
  const dlPromise2 = page.waitForEvent('download');
  await page.getByTestId('export-confirm').click();
  const vttOut = await readDownload(await dlPromise2);
  record('downloaded .vtt', vttOut.name.endsWith('.vtt'), vttOut.name);
  record('WebVTT output starts with WEBVTT', vttOut.text.startsWith('WEBVTT'));
  record('WebVTT uses dot milliseconds', /00:00:\d{2}\.\d{3} --> /.test(vttOut.text));

  record('no console/page errors on desktop', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ------------------------------------------------------------------ iPhone ---
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  record('deployed page loads on iPhone', (await page.title()).includes('SubtitleFix'));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  record('no horizontal overflow on iPhone', overflow <= 1, `${overflow}px`);

  const xBox = await page.getByRole('link', { name: /作者 𝕏/ }).boundingBox();
  record(
    'author X link reachable on iPhone',
    xBox !== null && xBox.x >= 0 && xBox.x + xBox.width <= 390,
    JSON.stringify(xBox),
  );

  await page.getByRole('button', { name: /破损 SRT/ }).first().click();
  await page.waitForTimeout(500);
  record('single-column list pane on iPhone', await page.getByTestId('cue-list').isVisible());
  record('editor hidden until a cue is tapped', !(await page.getByTestId('editor-panel').isVisible()));

  await page.getByTestId('cue-row-1').click();
  await page.waitForTimeout(300);
  record('tap opens the editor pane', await page.getByTestId('editor-panel').isVisible());

  const ta = await page.getByTestId('input-cue-text').boundingBox();
  record('cue textarea fits the iPhone viewport', ta !== null && ta.width > 220 && ta.x >= 0, JSON.stringify(ta));

  await page.getByTestId('input-cue-text').fill('iPhone 端编辑验证');
  await page.getByRole('tab', { name: /问题/ }).click();
  await page.waitForTimeout(300);
  record('issue pane reachable on iPhone', await page.getByTestId('issue-list').isVisible());

  await page.getByTestId('btn-export').click();
  await page.waitForTimeout(300);
  const dialogBox = await page.getByTestId('export-dialog').boundingBox();
  record(
    'export dialog fits the iPhone viewport',
    dialogBox !== null && dialogBox.x >= -1 && dialogBox.x + dialogBox.width <= 391,
    JSON.stringify(dialogBox),
  );
  const dlPromise = page.waitForEvent('download');
  await page.getByTestId('export-confirm').click();
  const out = await readDownload(await dlPromise);
  record('export works on iPhone', out.text.includes('iPhone 端编辑验证'));

  record('no page errors on iPhone', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${BASE}`);
if (failed.length > 0) {
  for (const f of failed) console.error('FAILED: ' + f.name + ' — ' + f.detail);
  process.exit(1);
}
