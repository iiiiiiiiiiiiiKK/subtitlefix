import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { resetCueIds } from '../src/core/ids';

const SRT = `1
00:00:01,000 --> 00:00:03,000
第一条字幕

2
00:00:04,000 --> 00:00:02,000
时间倒序的字幕
`;

async function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  return user;
}

async function importText(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole('button', { name: '粘贴' }));
  await user.type(screen.getByTestId('paste-textarea'), text);
  await user.click(screen.getByTestId('paste-submit'));
}

beforeEach(() => {
  resetCueIds();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('<App /> integration', () => {
  it('renders the landing state and the author X link', async () => {
    await renderApp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('SubtitleFix');
    const xLink = screen.getByRole('link', { name: /作者 𝕏/ });
    expect(xLink).toHaveAttribute('href', 'https://x.com/0xkillcoin');
    expect(xLink).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: /选择字幕文件/ })).toBeInTheDocument();
  });

  it('imports pasted subtitles and lists every cue', async () => {
    const user = await renderApp();
    await importText(user, SRT);

    expect(await screen.findByTestId('cue-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('cue-row-2')).toBeInTheDocument();
    const list = screen.getByTestId('cue-list');
    expect(within(list).getByText('第一条字幕')).toBeInTheDocument();
  });

  it('edits the active cue body through the editor panel', async () => {
    const user = await renderApp();
    await importText(user, SRT);

    await user.click(await screen.findByTestId('cue-row-1'));
    const textarea = screen.getByTestId('input-cue-text');
    await user.clear(textarea);
    await user.type(textarea, '改过的正文');
    expect(textarea).toHaveValue('改过的正文');
    // The list row reflects the edit immediately.
    expect(within(screen.getByTestId('cue-list')).getByText('改过的正文')).toBeInTheDocument();
  });

  it('reports the reversed cue in the issue panel and fixes it', async () => {
    const user = await renderApp();
    await importText(user, SRT);

    const issueList = await screen.findByTestId('issue-list');
    expect(within(issueList).getByText(/开始时间晚于结束时间/)).toBeInTheDocument();

    const fixButtons = within(issueList).getAllByRole('button', { name: /修复/ });
    await user.click(fixButtons[0]!);

    expect(within(screen.getByTestId('issue-list')).queryByText(/开始时间晚于结束时间/)).not.toBeInTheDocument();
  });

  it('supports undo after a batch timeline shift', async () => {
    const user = await renderApp();
    await importText(user, SRT);
    await user.click(await screen.findByTestId('cue-row-1'));
    const start = screen.getByTestId('input-cue-start');
    expect(start).toHaveValue('00:00:01,000');

    const input = screen.getByTestId('input-shift-value');
    await user.clear(input);
    await user.type(input, '1500');
    await user.click(screen.getByTestId('btn-shift-later'));
    expect(screen.getByTestId('input-cue-start')).toHaveValue('00:00:02,500');

    await user.click(screen.getByTestId('btn-undo'));
    expect(screen.getByTestId('input-cue-start')).toHaveValue('00:00:01,000');
  });

  it('opens the export dialog and shows the change summary', async () => {
    const user = await renderApp();
    await importText(user, SRT);
    await user.click(screen.getByTestId('btn-export'));
    const dialog = await screen.findByTestId('export-dialog');
    expect(within(dialog).getByText('导入时条数')).toBeInTheDocument();
    expect(within(dialog).getByTestId('export-format')).toBeInTheDocument();
    expect(within(dialog).getByTestId('export-confirm')).toBeInTheDocument();
  });

  it('does not claim success when the paste has no cues', async () => {
    const user = await renderApp();
    await importText(user, '这是一段没有时间轴的纯文本');
    const toasts = await screen.findAllByTestId('toast');
    expect(toasts.some((toast) => /没有可识别的字幕|没有解析到/.test(toast.textContent ?? ''))).toBe(true);
  });

  it('toggles between dark and light themes', async () => {
    const user = await renderApp();
    const toggle = screen.getByRole('button', { name: /切换到浅色模式/ });
    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(screen.getByRole('button', { name: /切换到深色模式/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
