import { expect, test } from '@playwright/test';
import { TOUR_SEEN_KEY, gotoApp } from './helpers';

/**
 * The guided demo answers "I don't understand what this tool does".
 * These tests prove a first-time visitor sees it, can walk through it, and that
 * the walkthrough really repairs the bundled demo file.
 */
test.describe('guided demo tour', () => {
  test('auto-opens on a first visit and explains the product', async ({ page }) => {
    await gotoApp(page, { keepTour: true });

    const tour = page.getByTestId('demo-tour');
    await expect(tour).toBeVisible();
    await expect(page.getByTestId('demo-tour-title')).toContainText('3 分钟');
    await expect(tour).toContainText('时间倒序');
    await expect(tour).toContainText('时间重叠');
  });

  test('loads the demo file and repairs every defect step by step', async ({ page }) => {
    await gotoApp(page, { keepTour: true });
    const next = page.getByTestId('demo-tour-next');
    const title = page.getByTestId('demo-tour-title');

    // Step 0 → 1: the demo document is loaded.
    await next.click();
    await expect(page.getByTestId('cue-row-1')).toBeVisible();
    await expect(page.getByTestId('cue-list')).toContainText('故意弄坏');
    await expect(title).toContainText('字幕工作台');

    // Step 1 → 2: the issue panel already found the defects.
    await next.click();
    await expect(title).toContainText('找出问题');
    await expect(page.getByTestId('issue-list')).toContainText('开始时间晚于结束时间');

    // Step 2 → 3: reversed timing repaired automatically.
    await next.click();
    await expect(page.getByTestId('demo-tour-did')).toContainText('交换');
    await expect(page.getByTestId('issue-list')).not.toContainText('开始时间晚于结束时间');

    // Step 3 → 4: overlap trimmed without deleting text.
    await next.click();
    await expect(page.getByTestId('demo-tour-did')).toContainText('重叠');

    // Step 4 → 5: one-click repair renumbers the cues; the tour stays on the
    // issue pane so the cleared error count is visible.
    await next.click();
    await expect(page.getByTestId('demo-tour-did')).toContainText('编号');
    await expect(page.getByRole('tab', { name: /错误/ })).toContainText('0');

    // Step 5 → 6: the export dialog opens and the tour pauses behind it.
    await next.click();
    await expect(page.getByTestId('export-dialog')).toBeVisible();
    await expect(page.getByTestId('export-dialog')).toContainText('导入时条数');

    // Closing the dialog resumes the tour at the final step.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('demo-tour')).toBeVisible();
    await expect(title).toContainText('演示结束');
  });

  test('can be reopened from the toolbar after being skipped', async ({ page }) => {
    await gotoApp(page, { keepTour: true });
    await page.getByRole('button', { name: '跳过演示' }).click();
    await expect(page.getByTestId('demo-tour')).toHaveCount(0);

    await page.getByTestId('btn-demo').click();
    await expect(page.getByTestId('demo-tour')).toBeVisible();
    await expect(page.getByTestId('demo-tour-title')).toContainText('3 分钟');
  });

  test('does not auto-open again after being skipped', async ({ page }) => {
    await gotoApp(page, { keepTour: true });
    await page.getByRole('button', { name: '跳过演示' }).click();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), TOUR_SEEN_KEY)).toBe('1');

    await page.reload();
    await expect(page.getByRole('heading', { name: /SubtitleFix/ })).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId('demo-tour')).toHaveCount(0);
  });

  test('the landing page leads with the demo CTA', async ({ page }) => {
    await gotoApp(page);
    const demoCta = page.getByTestId('empty-demo');
    await expect(demoCta).toBeVisible();
    await expect(demoCta).toContainText('演示');
    await expect(page.locator('.empty__lede')).toContainText('时间轴错位');
  });

  test('asks before replacing an open file, and can be declined', async ({ page }) => {
    await gotoApp(page);
    // Load the user's own subtitles, then request the demo from the toolbar.
    await page.getByTestId('file-input').setInputFiles({
      name: 'my-own.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n我的字幕\n', 'utf8'),
    });
    await expect(page.getByTestId('cue-row-1')).toBeVisible();

    await page.getByTestId('btn-demo').click();
    const confirm = page.getByTestId('demo-confirm');
    await expect(confirm).toBeVisible();

    // Declining keeps the user's document untouched.
    await page.getByRole('button', { name: '继续编辑我的字幕' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByTestId('demo-tour')).toHaveCount(0);
    await expect(page.getByTestId('cue-list')).toContainText('我的字幕');

    // Accepting starts the tour.
    await page.getByTestId('btn-demo').click();
    await page.getByTestId('demo-confirm-yes').click();
    await expect(page.getByTestId('demo-tour')).toBeVisible();
  });
});
