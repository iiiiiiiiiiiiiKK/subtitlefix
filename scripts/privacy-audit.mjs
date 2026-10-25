import { chromium } from 'playwright-core';

/**
 * Privacy audit: proves the app makes no network requests after the initial
 * document load, i.e. subtitle content never leaves the browser.
 *
 * Run against a preview server:
 *   node scripts/privacy-audit.mjs
 */
const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4899';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

// Suppress the first-visit tour so the scripted clicks hit the workspace.
await ctx.addInitScript(() => window.localStorage.setItem('subtitlefix.tour.seen.v1', '1'));

const requestsAfterLoad = [];
let loaded = false;
page.on('request', (req) => {
  if (loaded && req.resourceType() !== 'document') {
    requestsAfterLoad.push(`${req.method()} ${req.url()}`);
  }
});
page.on('websocket', (ws) => requestsAfterLoad.push(`WS ${ws.url()}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
loaded = true;

// Exercise the main flows that could plausibly phone home.
await page.getByRole('button', { name: /演示字幕/ }).first().click();
await page.waitForTimeout(300);
await page.getByTestId('cue-row-1').click();
await page.getByTestId('input-cue-text').fill('隐私测试：这段文字不应出现在任何网络请求中。');
await page.getByTestId('btn-fix').click();
await page.waitForTimeout(200);
await page.getByTestId('btn-search').click();
await page.getByTestId('search-input').fill('隐私');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.getByTestId('btn-export').click();
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

const storage = await page.evaluate(() => ({
  localStorage: Object.keys(localStorage),
  sessionStorage: Object.keys(sessionStorage),
  cookies: document.cookie,
  serviceWorkers: 'serviceWorker' in navigator ? 'available' : 'n/a',
}));

await browser.close();

console.log('requests after initial load:', requestsAfterLoad.length);
for (const entry of requestsAfterLoad) console.log('  ' + entry);
console.log('localStorage keys:', storage.localStorage);
console.log('sessionStorage keys:', storage.sessionStorage);
console.log('cookies:', storage.cookies === '' ? '(none)' : storage.cookies);

if (requestsAfterLoad.length > 0) {
  console.error('FAIL: the app made network requests after load');
  process.exit(1);
}
console.log('PASS: zero network requests after the initial load.');
