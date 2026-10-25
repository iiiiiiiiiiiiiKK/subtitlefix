import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { TOUR_SEEN_KEY } from '../src/core/demo';
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
    // Suppress the first-visit demo tour; it has its own test below.
    localStorage.setItem(TOUR_SEEN_KEY, '1');
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

describe('<App /> guided demo', () => {
  async function renderFirstVisit() {
    localStorage.removeItem(TOUR_SEEN_KEY);
    const user = userEvent.setup();
    render(<App />);
    // The tour auto-opens on a timer; flush it.
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 950));
    });
    return user;
  }

  it('opens by itself for a first-time visitor and can be skipped', async () => {
    const user = await renderFirstVisit();
    expect(await screen.findByTestId('demo-tour')).toBeInTheDocument();
    expect(screen.getByTestId('demo-tour-title')).toHaveTextContent('3 分钟');

    await user.click(screen.getByRole('button', { name: '跳过演示' }));
    expect(screen.queryByTestId('demo-tour')).not.toBeInTheDocument();
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
  });

  it('loads the demo file and repairs the reversed cue when advancing', async () => {
    const user = await renderFirstVisit();
    const next = await screen.findByTestId('demo-tour-next');

    // Step 0 -> 1: load the demo document.
    await user.click(next);
    expect(await screen.findByTestId('cue-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('cue-list')).toHaveTextContent('故意弄坏');

    // Advance until the "fix reversed timing" step, which applies the repair.
    for (let guard = 0; guard < 6; guard += 1) {
      if (/时间倒序/.test(screen.getByTestId('demo-tour-title').textContent ?? '')) break;
      await user.click(screen.getByTestId('demo-tour-next'));
    }
    expect(screen.getByTestId('demo-tour-title')).toHaveTextContent('时间倒序');

    expect(await screen.findByTestId('demo-tour-did')).toHaveTextContent('交换');
    const issueList = screen.getByTestId('issue-list');
    expect(issueList).not.toHaveTextContent('开始时间晚于结束时间');
  });

  it('can be restarted from the toolbar', async () => {
    const user = await renderApp();
    await user.click(screen.getByTestId('btn-demo'));
    expect(await screen.findByTestId('demo-tour')).toBeInTheDocument();
  });

  it('the landing page leads with the demo CTA', async () => {
    await renderApp();
    expect(screen.getByTestId('empty-demo')).toHaveTextContent('演示');
  });
});
