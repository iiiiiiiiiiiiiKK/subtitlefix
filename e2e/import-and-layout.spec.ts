import { expect, test } from '@playwright/test';
import { clickCue, gotoApp, isMobile, loadSample, loadViaPaste, openExport, SAMPLE_SRT } from './helpers';

test.describe('file import & bilingual merge', () => {
  test('imports a .srt file through the file input', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('file-input').setInputFiles({
      name: 'movie.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from(SAMPLE_SRT, 'utf8'),
    });
    await expect(page.getByTestId('cue-row-1')).toBeVisible();
    await expect(page.getByText('movie', { exact: false }).first()).toBeVisible();
  });

  test('merges a bilingual secondary track', async ({ page }) => {
    await gotoApp(page);
    await loadViaPaste(page, SAMPLE_SRT);

    await page.getByTestId('btn-bilingual').click();
    await expect(page.getByTestId('bilingual-dialog')).toBeVisible();

    await page.getByRole('tab', { name: '粘贴副轨文本' }).click();
    await page.locator('#bilingual-paste').fill(`1
00:00:01,200 --> 00:00:03,300
Welcome to SubtitleFix.

2
00:00:03,400 --> 00:00:05,900
This cue overlaps the previous one.

3
00:00:04,900 --> 00:00:08,000
This cue is reversed in the main track.

4
00:00:10,100 --> 00:00:11,900
An empty cue in the main track.

5
00:00:14,100 --> 00:00:15,900
The last line.
`);
    await page.getByRole('button', { name: '解析这段文本' }).click();
    await expect(page.getByTestId('bilingual-preview')).toBeVisible();
    await expect(page.getByTestId('bilingual-apply')).toBeEnabled();
    await page.getByTestId('bilingual-apply').click();
    await expect(page.getByTestId('bilingual-dialog')).toBeHidden();

    // The merged secondary text should now be visible in the list.
    await expect(page.getByTestId('cue-list')).toContainText('Welcome to SubtitleFix.');
  });

  test('rejects an unsupported paste with a clear message', async ({ page }) => {
    await gotoApp(page);
    await loadViaPaste(page, '这只是一段普通文本，没有任何时间轴。');
    await expect(page.getByTestId('toast').first()).toContainText(/没有可识别的字幕|没有解析到/);
  });
});

test.describe('export safety', () => {
  test('shows the diff and warns before losing cue text', async ({ page }) => {
    await gotoApp(page);
    await loadViaPaste(page, SAMPLE_SRT);

    // Delete a cue that has text, then open the export dialog.
    await clickCue(page, 5);
    await page.getByTestId('editor-panel').getByRole('button', { name: /删除本条/ }).click();

    await openExport(page);
    await page.getByRole('button', { name: /查看差异/ }).click();
    await expect(page.getByTestId('export-diff')).toBeVisible();
    await expect(page.getByTestId('export-dialog')).toContainText('有正文会丢失');
  });
});

test.describe('responsive layout', () => {
  test('keeps the workspace usable and shows the author X link', async ({ page }) => {
    await gotoApp(page);

    const xLink = page.getByRole('link', { name: /作者 𝕏/ });
    await expect(xLink).toHaveAttribute('href', 'https://x.com/0xkillcoin');

    await loadSample(page);
    await expect(page.getByTestId('cue-row-1')).toBeVisible();

    if (isMobile(page)) {
      // Single-column mode: tab switching is available and the editor is hidden initially.
      await expect(page.getByRole('tab', { name: /列表/ })).toBeVisible();
      await expect(page.getByTestId('editor-panel')).toBeHidden();
      await page.getByTestId('cue-row-1').click();
      await expect(page.getByTestId('editor-panel')).toBeVisible();
      await expect(page.getByTestId('input-cue-text')).toBeVisible();

      // No horizontal overflow on a phone viewport.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    } else {
      // Desktop: all three panes are visible at once.
      await expect(page.getByTestId('editor-panel')).toBeVisible();
      await expect(page.getByTestId('issue-list').or(page.locator('.issues__empty'))).toBeVisible();
    }
  });
});
