/**
 * Small built-in sample files so the workbench has an instant "try it" path.
 * They are intentionally messy — each one demonstrates real repair scenarios.
 *
 * The `demo-walkthrough` sample is the one the guided tour uses; it is defined
 * in `demo.ts` so the fixture, the tour script and the tests cannot drift apart.
 */

import { DEMO_FILE_NAME, DEMO_SRT } from './demo';

export interface SampleFile {
  id: string;
  label: string;
  description: string;
  fileName: string;
  content: string;
}

const BROKEN_SRT = `1
00:00:01,000 --> 00:00:03,500
欢迎来到字幕修理厂。
This is SubtitleFix.

2
00:00:03,200 --> 00:00:06,000
这一条与上一条重叠了 300ms。
This cue overlaps the previous one by 300ms.

3
00:00:08,000 --> 00:00:05,000
这条字幕的开始时间晚于结束时间。
This cue starts after it ends.

4
00:00:10,000 --> 00:00:12,000


5
00:00:14.000 --> 00:00:16.000
时间轴用了点号而不是逗号。
A dot was used instead of a comma.

7
00:00:18,000 --> 00:00:20,000
编号跳过了 6。

8
00:00:19,500 --> 00:00:22,000
这条又和上一条重叠。
Overlapping again, with a missing blank line below.
9
00:00:24,000 --> 00:00:26,500
上一行和这一行之间没有空行。
No blank line before this cue, but the text survived.

10
00:00:28,000 --> 00:00:30,000
带有 ASS 样式标签的正文。
{\\i1}Italic tag from an ASS file{\\i0}
`;

const BILINGUAL_EN = `1
00:00:01,000 --> 00:00:04,000
Hello and welcome to the workshop.

2
00:00:04,000 --> 00:00:07,500
Everything runs inside your browser.

3
00:00:07,500 --> 00:00:11,000
No file ever leaves your machine.

4
00:00:11,000 --> 00:00:14,000
Drop a subtitle file to begin.
`;

const BILINGUAL_ZH = `1
00:00:01,000 --> 00:00:04,000
你好，欢迎来到本工作台。

2
00:00:04,000 --> 00:00:07,500
所有处理都在你的浏览器内完成。

3
00:00:07,500 --> 00:00:11,000
文件不会离开你的电脑。

4
00:00:11,000 --> 00:00:14,000
拖入字幕文件即可开始。
`;

const CLEAN_VTT = `WEBVTT - SubtitleFix demo
Kind: captions
Language: zh-CN

NOTE
This NOTE block is preserved verbatim on export.

STYLE
::cue { color: #f8fafc; }

00:00:01.000 --> 00:00:04.000 align:start position:10%
干净的 WebVTT 示例。
<style>标签</style> 也会原样保留。

00:00:04.500 --> 00:00:08.000
第二条字幕，带有设置行示例。

id-cue-3
00:00:09.000 --> 00:00:12.000 line:90%
带命名标识的 cue。

00:00:13.000 --> 00:00:15.000
最后一条，正文里有实体 &amp; 和 emoji 🎬。
`;

export const SAMPLES: SampleFile[] = [
  {
    id: 'demo-walkthrough',
    label: '演示字幕（推荐）',
    description: '5 种真实故障，每条正文都在解释自己的毛病',
    fileName: DEMO_FILE_NAME,
    content: DEMO_SRT,
  },
  {
    id: 'broken-srt',
    label: '破损 SRT（旧）',
    description: '重叠 / 逆序 / 空字幕 / 点号时间 / 编号跳号 / 缺空行 / ASS 标签',
    fileName: 'broken-sample.srt',
    content: BROKEN_SRT,
  },
  {
    id: 'bilingual-en',
    label: '双语 · 英文轨',
    description: '作为双语合并的主轨',
    fileName: 'english.srt',
    content: BILINGUAL_EN,
  },
  {
    id: 'bilingual-zh',
    label: '双语 · 中文轨',
    description: '作为双语合并的副轨',
    fileName: 'chinese.srt',
    content: BILINGUAL_ZH,
  },
  {
    id: 'clean-vtt',
    label: 'WebVTT 示例',
    description: '含 NOTE / STYLE 块、cue 设置与命名标识',
    fileName: 'sample.vtt',
    content: CLEAN_VTT,
  },
];

export function getSample(id: string): SampleFile | undefined {
  return SAMPLES.find((sample) => sample.id === id);
}
