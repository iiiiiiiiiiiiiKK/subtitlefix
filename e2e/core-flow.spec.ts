import { expect, test } from '@playwright/test';
import { clickCue, gotoApp, loadViaPaste, openExport, showPane, SAMPLE_SRT } from './helpers';

test.describe('import → edit → fix → export', () => {
  test('pastes subtitles, edits a cue and exports a fixed SRT', async ({ page }) => {
    await gotoApp(page);
    await loadViaPaste(page, SAMPLE_SRT);

    // 5 cues parsed and problems detected.
    await expect(page.getByTestId('cue-row-1')).toBeVisible();
    await expect(page.getByTestId('cue-row-5')).toBeVisible();
    await showPane(page, 'issues');
    await expect(page.getByTestId('issue-list')).toBeVisible();

    // Edit the body of cue 1 and confirm it reaches the editor panel.
    await clickCue(page, 1);
    const text = page.getByTestId('input-cue-text');
    await expect(text).toHaveValue('欢迎来到字幕修理厂。');
    await text.fill('欢迎来到字幕修理厂（已编辑）。');
    await expect(text).toHaveValue('欢迎来到字幕修理厂（已编辑）。');

    // Fix reversed timing through the issue panel.
    await showPane(page, 'issues');
    await page.getByRole('button', { name: '修复' }).first().click();

    // Export and assert the downloaded file content.
    await openExport(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-confirm').click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const output = Buffer.concat(chunks).toString('utf8');

    expect(download.suggestedFilename()).toMatch(/\.srt$/);
    expect(output).toContain('欢迎来到字幕修理厂（已编辑）。');
    expect(output.split('-->').length - 1).toBe(5);
    // No reversed timings remain.
    expect(output).not.toContain('00:00:08,000 --> 00:00:05,000');
  });

  test('one-click repair clears the blocking issues', async ({ page }) => {
    await gotoApp(page);
    await loadViaPaste(page, SAMPLE_SRT);
    await page.getByTestId('btn-fix').click();
    await expect(page.getByTestId('toast').first()).toBeVisible();
    await showPane(page, 'issues');
    await expect(page.getByRole('tab', { name: /错误/ })).toContainText('0');
  });

  test('undo and redo restore the timeline shift', async ({ page }) => {
    await gotoApp(page);
    await loadViaPaste(page, SAMPLE_SRT);
    await clickCue(page, 1);
    const start = page.getByTestId('input-cue-start');
    const before = await start.inputValue();

    await page.getByTestId('input-shift-value').fill('500');
    await page.getByTestId('btn-shift-later').click();
    await showPane(page, 'editor');
    await expect(start).not.toHaveValue(before);

    await page.getByTestId('btn-undo').click();
    await expect(start).toHaveValue(before);

    await page.getByTestId('btn-redo').click();
    await expect(start).not.toHaveValue(before);
  });

  test('search and jump to a matching cue', async ({ page }) => {
    await gotoApp(page);
    await loadViaPaste(page, SAMPLE_SRT);
    await page.getByTestId('btn-search').click();
    await expect(page.getByTestId('search-dialog')).toBeVisible();
    await page.getByTestId('search-input').fill('时间倒序');
    await expect(page.getByTestId('search-results')).toBeVisible();
    await page.getByTestId('search-results').getByRole('button').first().click();
    await expect(page.getByTestId('search-dialog')).toBeHidden();
    await expect(page.getByTestId('input-cue-text')).toHaveValue('这一条时间倒序。');
  });

  test('convert SRT to WebVTT and verify the header', async ({ page }) => {
    await gotoApp(page);
    await loadViaPaste(page, SAMPLE_SRT);
    await openExport(page);
    await page.getByTestId('export-format').selectOption('vtt');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-confirm').click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const output = Buffer.concat(chunks).toString('utf8');

    expect(download.suggestedFilename()).toMatch(/\.vtt$/);
    expect(output.startsWith('WEBVTT')).toBe(true);
    expect(output).toContain('00:00:01.000 --> 00:00:03.500');
  });
});
