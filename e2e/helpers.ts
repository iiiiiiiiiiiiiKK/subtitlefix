import { expect, type Page } from '@playwright/test';

/** Shared helpers for the E2E flows. */

export const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:03,500
欢迎来到字幕修理厂。

2
00:00:03,200 --> 00:00:06,000
这一条与上一条重叠了。

3
00:00:08,000 --> 00:00:05,000
这一条时间倒序。

4
00:00:10,000 --> 00:00:12,000


5
00:00:14,000 --> 00:00:16,000
最后一条。
`;

/**
 * The guided demo auto-opens on a first visit. Every test that is *not* about the
 * tour marks it as seen before the app boots, so it gets a clean workspace.
 */
export const TOUR_SEEN_KEY = 'subtitlefix.tour.seen.v1';

export async function gotoApp(page: Page, options: { keepTour?: boolean } = {}) {
  if (options.keepTour) {
    // Clear the flag only once per tab: the marker lives in sessionStorage, which
    // survives reloads, so `page.reload()` does not resurrect the tour.
    await page.addInitScript((key) => {
      const marker = '__subtitlefix_tour_reset__';
      if (window.sessionStorage.getItem(marker)) return;
      window.sessionStorage.setItem(marker, '1');
      window.localStorage.removeItem(key);
    }, TOUR_SEEN_KEY);
  } else {
    await page.addInitScript((key) => window.localStorage.setItem(key, '1'), TOUR_SEEN_KEY);
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /SubtitleFix/ })).toBeVisible();
  if (!options.keepTour) {
    await expect(page.getByTestId('demo-tour')).toHaveCount(0);
  }
}

export async function loadViaPaste(page: Page, text: string) {
  await page.getByRole('button', { name: '粘贴', exact: true }).click();
  const dialog = page.getByTestId('paste-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('paste-textarea').fill(text);
  await page.getByTestId('paste-submit').click();
  await expect(dialog).toBeHidden();
}

/** Loads the bundled demo subtitles without running the tour. */
export async function loadSample(page: Page) {
  await page.getByRole('button', { name: /演示字幕/ }).first().click();
  await expect(page.getByTestId('cue-row-1')).toBeVisible();
}

export async function openExport(page: Page) {
  await page.getByTestId('btn-export').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
}

export function isMobile(page: Page): boolean {
  // Matches the CSS breakpoint where the workspace becomes a tabbed layout.
  return (page.viewportSize()?.width ?? 1440) <= 960;
}

export type Pane = 'list' | 'editor' | 'issues';

/**
 * On phones only one pane is visible at a time, so tests must switch tabs
 * explicitly. On desktop every pane is already on screen and this is a no-op.
 */
export async function showPane(page: Page, pane: Pane) {
  if (!isMobile(page)) return;
  const label = pane === 'list' ? /列表/ : pane === 'editor' ? /^编辑/ : /问题/;
  await page.getByRole('tab', { name: label }).click();
}

/** Click a cue row in the list, switching to the list pane first on phones. */
export async function clickCue(page: Page, index: number) {
  await showPane(page, 'list');
  await page.getByTestId(`cue-row-${index}`).click();
}
