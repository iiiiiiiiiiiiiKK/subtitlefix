/**
 * The built-in guided demo.
 *
 * The point of this file is that someone who has never seen a subtitle editor
 * should understand, within one screen, what the tool is for. So the demo is not
 * just "some sample data": it is a deliberately broken subtitle file whose *cue
 * bodies explain their own defect*, plus a scripted tour that repairs each
 * defect in front of the user and narrates why it matters.
 *
 * `DEMO_SRT` must stay byte-identical to `examples/demo-walkthrough.srt`
 * (enforced by tests/demo.test.ts).
 */

export type DemoActionId =
  | 'load-demo'
  | 'select-first'
  | 'fix-swap'
  | 'fix-overlap'
  | 'fix-all'
  | 'open-export'
  | 'none';

export type DemoTab = 'list' | 'editor' | 'issues';

export interface DemoTourStep {
  id: string;
  /** Short heading shown in bold. */
  title: string;
  /** 1-3 sentences of plain-language explanation. */
  body: string;
  /** CSS selector of the element to spotlight. Omit for a centred card. */
  target?: string;
  action: DemoActionId;
  /** Past-tense note shown after the action ran ("刚刚帮你……"). */
  did?: string;
  /** Which pane to reveal first on phones/tablets. */
  tab: DemoTab;
  /** Primary button label; defaults to 下一步 / 完成. */
  cta?: string;
}

export const DEMO_FILE_NAME = 'demo-walkthrough.srt';

export const DEMO_TITLE = '3 分钟演示 · 一份被弄坏的字幕';

/**
 * Eight cues, five real defects, zero fake content: every line of body text is
 * about the defect next to it, so the demo teaches while it runs.
 */
export const DEMO_SRT = `1
00:00:01,000 --> 00:00:04,000
欢迎来到 SubtitleFix 的 3 分钟演示。
这份字幕是故意弄坏的，目的是一次性看到所有常见故障。

2
00:00:03,200 --> 00:00:06,500
我比上一条提前 0.8 秒出现，两条叠在了一起。
这就是「时间重叠」：播放时字幕会闪，或者互相盖住。

3
00:00:08,000 --> 00:00:05,000
我的开始时间（8 秒）比结束时间（5 秒）还晚。
播放器遇到这种条目通常直接跳过，观众就漏掉一句台词。

4
00:00:10,000 --> 00:00:12,000


5
00:00:14,000 --> 00:00:16,000
上面第 4 条是空的，故意留给你决定删不删。
删除内容这种事，工具不会替你做主。

6
00:00:18,000 --> 00:00:20,000
我的编号跳过了 7。
老播放器依赖连续编号，所以建议重排，成本为零。
8
00:00:20,500 --> 00:00:22,000
我和上一条之间还少了空行——这是从网页复制字幕最常见的事故。
解析器没有把我和上一条粘成一条，因为时间轴行本身就是分界线。

9
00:00:24,000 --> 00:00:26,500
演示到此结束。下面轮到你的字幕了。
Everything above is repairable without losing a single word.
`;

export const TOUR_SEEN_KEY = 'subtitlefix.tour.seen.v1';

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    /* private mode / blocked storage: the tour simply shows again next time */
  }
}

/** Actions that run automatically when a step becomes active. */
export function isAutoAction(action: DemoActionId): boolean {
  return action === 'select-first' || action === 'fix-swap' || action === 'fix-overlap' || action === 'fix-all';
}

export const TOUR_STEPS: DemoTourStep[] = [
  {
    id: 'intro',
    title: '3 分钟，看懂字幕修理厂在做什么',
    body: '接下来会载入一份故意弄坏的示例字幕，然后当着你的面把它修好：时间倒序、时间重叠、编号断档、空字幕、缺空行——每种故障都会在字幕正文里解释自己。全程可撤销，也不会下载任何东西。',
    action: 'load-demo',
    tab: 'list',
    cta: '开始演示',
  },
  {
    id: 'workspace',
    title: '这是你的字幕工作台',
    body: '左边是字幕列表，行首的圆点表示这一条有没有问题（红=错误，黄=警告）；右边是选中后的编辑面板；底部是随改动实时刷新的问题检查。',
    target: '[data-testid="cue-list"]',
    action: 'none',
    tab: 'list',
  },
  {
    id: 'issues',
    title: '① 工具已经帮你找出问题',
    body: '每条问题都能点击跳到对应字幕。错误（红色）会让播放器直接跳过整条字幕；警告（黄色）只是可能显示异常。带「修复」按钮的问题可以一键处理。',
    target: '[data-testid="issue-list"]',
    action: 'none',
    tab: 'issues',
  },
  {
    id: 'swap',
    title: '② 修「时间倒序」',
    body: '第 3 条字幕的开始时间（8 秒）晚于结束时间（5 秒），这种条目会被播放器整条忽略。刚刚自动帮你交换了这两个时间——只动时间，正文一个字都没碰。',
    target: '[data-testid="issue-list"]',
    action: 'fix-swap',
    did: '已交换第 3 条的开始 / 结束时间，正文未改动',
    tab: 'issues',
  },
  {
    id: 'overlap',
    title: '③ 修「时间重叠」',
    body: '第 1、2 条叠了 0.8 秒，同时显示会互相盖住。修复策略是缩短上一条的结束时间，而不是删掉谁——任何可能丢正文的操作都不会被自动执行。',
    target: '[data-testid="issue-list"]',
    action: 'fix-overlap',
    did: '已裁掉重叠部分，两条正文都完整保留',
    tab: 'issues',
  },
  {
    id: 'fixall',
    title: '④ 一键修复剩下的毛病',
    body: '工具栏的「一键修复」按固定顺序执行：负时间 → 逆序 → 重叠 → 重排编号。空字幕不会被自动删除，因为那是你的内容，删不删由你决定。',
    target: '[data-testid="issue-list"]',
    action: 'fix-all',
    did: '已重排编号：错误清零，只剩需要你判断的警告',
    tab: 'issues',
  },
  {
    id: 'export',
    title: '⑤ 导出前先看差异',
    body: '点「导出」不会立刻下载，而是先列出这次改了什么：条数、正文、时间轴、删除 / 新增，以及有没有正文会被丢掉。看完再决定下不下载。',
    target: '[data-testid="btn-export"]',
    action: 'open-export',
    tab: 'list',
    cta: '打开导出面板',
  },
  {
    id: 'done',
    title: '演示结束，轮到你的字幕了',
    body: '把你的 .srt / .vtt 拖进窗口，或者直接粘贴字幕文本。所有解析、修复和导出都在这个标签页里完成，文件不会上传到任何服务器。想再看一遍，点工具栏的「演示」。',
    action: 'none',
    tab: 'list',
  },
];

/** Index of the step whose button opens the export dialog (tour pauses there). */
export const TOUR_EXPORT_STEP = TOUR_STEPS.findIndex((step) => step.action === 'open-export');
export const TOUR_INTRO_STEP = TOUR_STEPS.findIndex((step) => step.action === 'load-demo');
