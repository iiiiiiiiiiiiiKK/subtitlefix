import { chromium } from 'playwright-core';

/**
 * Layout audit across viewports. Fails loudly on horizontal overflow, elements
 * clipped outside the viewport, or panes that should (not) be visible.
 *
 * Run against a preview server:
 *   node node_modules/vite/bin/vite.js preview --port 4899 --strictPort
 *   node scripts/layout-audit.mjs
 */
const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4899';

const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080, mobile: false },
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false },
  { name: 'laptop-1280', width: 1280, height: 800, mobile: false },
  { name: 'tablet-ipad-mini', width: 820, height: 1180, mobile: true },
  { name: 'phone-iphone-se', width: 375, height: 667, mobile: true },
  { name: 'phone-iphone-13', width: 390, height: 664, mobile: true },
  { name: 'phone-iphone-13-max', width: 428, height: 926, mobile: true },
  { name: 'phone-galaxy-s20', width: 360, height: 800, mobile: true },
  { name: 'phone-landscape', width: 844, height: 390, mobile: true },
];

const problems = [];

function check(name, condition, detail) {
  if (!condition) problems.push(`${name}: ${detail}`);
}

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // --- landing -------------------------------------------------------------
  const xLink = page.getByRole('link', { name: /作者 𝕏/ });
  check(vp.name, (await xLink.count()) === 1, 'author X link missing');
  check(
    vp.name,
    (await xLink.getAttribute('href')) === 'https://x.com/0xkillcoin',
    'author X link href wrong',
  );
  const xBox = await xLink.boundingBox();
  check(vp.name, xBox !== null && xBox.width > 0, 'author X link not rendered');
  check(
    vp.name,
    xBox !== null && xBox.x >= 0 && xBox.x + xBox.width <= vp.width + 1,
    `author X link outside viewport (${JSON.stringify(xBox)})`,
  );

  const overflowLanding = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check(vp.name, overflowLanding <= 1, `landing horizontal overflow ${overflowLanding}px`);

  const ctaBox = await page.getByRole('button', { name: /选择字幕文件/ }).boundingBox();
  check(
    vp.name,
    ctaBox !== null && ctaBox.x + ctaBox.width <= vp.width + 1,
    'primary CTA clipped',
  );
  check(vp.name, ctaBox !== null && ctaBox.height >= 32, 'primary CTA too small for touch');

  // --- loaded workbench ----------------------------------------------------
  await page.getByRole('button', { name: /破损 SRT/ }).first().click();
  await page.waitForTimeout(350);

  const overflowLoaded = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check(vp.name, overflowLoaded <= 1, `workbench horizontal overflow ${overflowLoaded}px`);

  if (vp.width <= 960) {
    check(vp.name, await page.getByRole('tab', { name: /列表/ }).isVisible(), 'mobile tabs hidden');
    check(vp.name, await page.getByTestId('cue-list').isVisible(), 'cue list hidden in tabbed layout');
    check(
      vp.name,
      !(await page.getByTestId('editor-panel').isVisible()),
      'editor should be hidden until its tab is active',
    );

    await page.getByTestId('cue-row-1').click();
    await page.waitForTimeout(250);
    check(vp.name, await page.getByTestId('editor-panel').isVisible(), 'editor did not open from a cue tap');

    const textBox = await page.getByTestId('input-cue-text').boundingBox();
    check(
      vp.name,
      textBox !== null && textBox.width >= 220,
      `textarea too narrow (${textBox?.width})`,
    );
    check(
      vp.name,
      textBox !== null && textBox.x >= 0 && textBox.x + textBox.width <= vp.width + 1,
      'textarea overflows viewport',
    );

    // Footer actions must stay reachable (not pushed off-screen by chrome).
    const del = await page.getByTestId('editor-panel').getByRole('button', { name: /删除本条/ }).boundingBox();
    check(
      vp.name,
      del !== null && del.y + del.height <= vp.height + 40,
      `editor footer unreachable (${JSON.stringify(del)})`,
    );

    await page.getByRole('tab', { name: /问题/ }).click();
    await page.waitForTimeout(250);
    check(vp.name, await page.getByTestId('issue-list').isVisible(), 'issue list not visible');
  } else {
    check(vp.name, !(await page.getByRole('tab', { name: /列表/ }).isVisible()), 'mobile tabs shown on desktop');
    check(vp.name, await page.getByTestId('cue-list').isVisible(), 'cue list hidden on desktop');
    check(vp.name, await page.getByTestId('editor-panel').isVisible(), 'editor hidden on desktop');
    check(
      vp.name,
      (await page.getByTestId('issue-list').count()) > 0,
      'issue list missing on desktop',
    );
  }

  // --- dialogs stay inside the viewport ------------------------------------
  await page.getByTestId('btn-export').click();
  await page.waitForTimeout(250);
  const dialogBox = await page.getByTestId('export-dialog').boundingBox();
  check(vp.name, dialogBox !== null, 'export dialog not rendered');
  check(
    vp.name,
    dialogBox !== null && dialogBox.x >= -1 && dialogBox.x + dialogBox.width <= vp.width + 1,
    `export dialog overflows viewport (${JSON.stringify(dialogBox)})`,
  );
  const confirmBox = await page.getByTestId('export-confirm').boundingBox();
  check(
    vp.name,
    confirmBox !== null && confirmBox.x + confirmBox.width <= vp.width + 1,
    'export confirm button clipped',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  check(vp.name, errors.length === 0, `console/page errors: ${errors.join(' | ')}`);

  console.log(
    `${problems.length === 0 ? 'ok  ' : '    '}${vp.name.padEnd(22)} ${vp.width}x${vp.height}` +
      `  tabs=${await page.getByRole('tab', { name: /列表/ }).isVisible().catch(() => false)}`,
  );
  await ctx.close();
}

await browser.close();

if (problems.length > 0) {
  console.error('\nLayout problems:');
  for (const problem of problems) console.error(' - ' + problem);
  process.exit(1);
}
console.log('\nAll viewports passed layout checks.');
