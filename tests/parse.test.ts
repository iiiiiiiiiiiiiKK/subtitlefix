import { describe, expect, it, beforeEach } from 'vitest';
import { detectFormat, detectNewline, parseSubtitles, splitLines, stripBom } from '../src/core/parse';
import { resetCueIds } from '../src/core/ids';
import { serializeSubtitles } from '../src/core/serialize';

beforeEach(() => resetCueIds());

const SIMPLE_SRT = `1
00:00:01,000 --> 00:00:03,000
第一条字幕

2
00:00:04,000 --> 00:00:06,000
第二条字幕
Second line of cue two
`;

describe('stripBom / detectNewline / splitLines', () => {
  it('strips a UTF-8 BOM', () => {
    const { text, bom } = stripBom('\uFEFF1\n00:00:01,000 --> 00:00:02,000\nhi');
    expect(bom).toBe(true);
    expect(text.startsWith('1')).toBe(true);
  });

  it('detects CRLF', () => {
    expect(detectNewline('a\r\nb\r\n')).toBe('crlf');
  });

  it('detects LF', () => {
    expect(detectNewline('a\nb\n')).toBe('lf');
  });

  it('detects mixed line endings', () => {
    expect(detectNewline('a\r\nb\nc')).toBe('mixed');
  });

  it('splits CRLF, CR and LF alike', () => {
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('detectFormat', () => {
  it('detects SRT by comma separator', () => {
    expect(detectFormat(SIMPLE_SRT).format).toBe('srt');
  });

  it('detects VTT by header', () => {
    expect(detectFormat('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi').format).toBe('vtt');
  });

  it('detects VTT by dot separator when the header is missing', () => {
    expect(detectFormat('00:00:01.000 --> 00:00:02.000\nhi').format).toBe('vtt');
  });

  it('falls back to the file extension', () => {
    expect(detectFormat('random text', 'movie.vtt').format).toBe('vtt');
  });
});

describe('parseSubtitles — valid SRT', () => {
  it('parses numbers, timings and multi-line bodies', () => {
    const doc = parseSubtitles(SIMPLE_SRT, { fileName: 'demo.srt' });
    expect(doc.format).toBe('srt');
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0]).toMatchObject({ number: 1, start: 1000, end: 3000, text: '第一条字幕' });
    expect(doc.cues[1]?.text).toBe('第二条字幕\nSecond line of cue two');
    expect(doc.meta.fileName).toBe('demo.srt');
    expect(doc.title).toBe('demo');
  });

  it('keeps punctuation, emoji and trailing spaces inside the body', () => {
    const raw = '1\n00:00:01,000 --> 00:00:02,000\n「引号」、emoji 🎬 & 符号 -- 以及 ...\n';
    const doc = parseSubtitles(raw);
    expect(doc.cues[0]?.text).toBe('「引号」、emoji 🎬 & 符号 -- 以及 ...');
  });

  it('handles CRLF input and records the newline style', () => {
    const doc = parseSubtitles(SIMPLE_SRT.replace(/\n/g, '\r\n'));
    expect(doc.meta.newline).toBe('crlf');
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[1]?.text).toBe('第二条字幕\nSecond line of cue two');
  });

  it('handles a BOM-prefixed file', () => {
    const doc = parseSubtitles(`\uFEFF${SIMPLE_SRT}`);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0]?.number).toBe(1);
    expect(doc.meta.issues.some((issue) => issue.code === 'bom-detected')).toBe(true);
  });
});

describe('parseSubtitles — damaged input', () => {
  it('keeps the cue when a timestamp is broken', () => {
    const raw = '1\n00:00:0X,000 --> 00:00:03,000\n正文还在\n';
    const doc = parseSubtitles(raw);
    expect(doc.cues).toHaveLength(1);
    expect(doc.cues[0]?.text).toBe('正文还在');
    expect(doc.meta.issues.some((issue) => issue.code === 'malformed-timing')).toBe(true);
  });

  it('reports start-after-end without deleting the cue', () => {
    const raw = '1\n00:00:09,000 --> 00:00:05,000\n逆序\n';
    const doc = parseSubtitles(raw);
    expect(doc.cues[0]?.start).toBe(9000);
    expect(doc.cues[0]?.end).toBe(5000);
    expect(doc.cues[0]?.text).toBe('逆序');
  });

  it('keeps empty cues instead of dropping them', () => {
    const raw = '1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\n有内容\n';
    const doc = parseSubtitles(raw);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0]?.text).toBe('');
  });

  it('recovers from a missing blank separator between cues', () => {
    const raw = '1\n00:00:01,000 --> 00:00:02,000\n第一条\n2\n00:00:03,000 --> 00:00:04,000\n第二条\n';
    const doc = parseSubtitles(raw);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0]?.text).toBe('第一条');
    expect(doc.cues[1]?.text).toBe('第二条');
  });

  it('parses cues without index numbers', () => {
    const raw = '00:00:01,000 --> 00:00:02,000\n无编号\n\n00:00:03,000 --> 00:00:04,000\n第二条\n';
    const doc = parseSubtitles(raw);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues.map((cue) => cue.number)).toEqual([1, 2]);
  });

  it('records non-sequential numbering as an issue but keeps original numbers', () => {
    const raw = '5\n00:00:01,000 --> 00:00:02,000\na\n\n9\n00:00:03,000 --> 00:00:04,000\nb\n';
    const doc = parseSubtitles(raw);
    expect(doc.cues.map((cue) => cue.number)).toEqual([5, 9]);
    expect(doc.meta.issues.some((issue) => issue.code === 'number-sequence')).toBe(true);
  });

  it('reports an empty file', () => {
    const doc = parseSubtitles('   \n\n');
    expect(doc.cues).toHaveLength(0);
    expect(doc.meta.issues.some((issue) => issue.code === 'empty-file')).toBe(true);
  });

  it('reports a file with no timing at all', () => {
    const doc = parseSubtitles('这只是一段普通文本\n没有任何时间轴\n');
    expect(doc.cues).toHaveLength(0);
    expect(doc.meta.issues.some((issue) => issue.code === 'fatal')).toBe(true);
  });
});

describe('parseSubtitles — WebVTT specifics', () => {
  const VTT = `WEBVTT - demo
Kind: captions
Language: zh-CN

NOTE
这是注释

STYLE
::cue { color: red }

00:00:01.000 --> 00:00:03.000 align:start position:10%
第一条

cue-id-2
00:00:04.000 --> 00:00:06.000 line:90%
第二条
`;

  it('parses the header, header metadata and blocks', () => {
    const doc = parseSubtitles(VTT, { fileName: 'demo.vtt' });
    expect(doc.format).toBe('vtt');
    expect(doc.meta.vttHeader).toBe('WEBVTT - demo');
    expect(doc.meta.vttHeaderMeta).toEqual(['Kind: captions', 'Language: zh-CN']);
    expect(doc.meta.vttBlocks.map((block) => block.kind)).toEqual(['note', 'style']);
  });

  it('parses cue settings and identifiers', () => {
    const doc = parseSubtitles(VTT, { fileName: 'demo.vtt' });
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0]?.settings).toBe('align:start position:10%');
    expect(doc.cues[1]?.text).toBe('第二条');
  });

  it('warns when the WEBVTT header is missing', () => {
    const doc = parseSubtitles('00:00:01.000 --> 00:00:02.000\nhi\n', { format: 'vtt' });
    expect(doc.meta.issues.some((issue) => issue.code === 'missing-vtt-header')).toBe(true);
    expect(doc.meta.vttHeader).toBe('WEBVTT');
  });
});

describe('round trip', () => {
  it('SRT -> parse -> serialize -> parse keeps cues and bodies', () => {
    const first = parseSubtitles(SIMPLE_SRT, { fileName: 'demo.srt' });
    const text = serializeSubtitles(first);
    const second = parseSubtitles(text, { fileName: 'demo.srt' });
    expect(second.cues).toHaveLength(first.cues.length);
    expect(second.cues.map((cue) => cue.text)).toEqual(first.cues.map((cue) => cue.text));
    expect(second.cues.map((cue) => cue.start)).toEqual(first.cues.map((cue) => cue.start));
    expect(second.cues.map((cue) => cue.end)).toEqual(first.cues.map((cue) => cue.end));
  });

  it('VTT -> parse -> serialize -> parse keeps NOTE blocks and settings', () => {
    const vtt = `WEBVTT\n\nNOTE\nhello\n\n00:00:01.000 --> 00:00:02.000 align:start\n文本\n`;
    const first = parseSubtitles(vtt, { fileName: 'x.vtt' });
    const second = parseSubtitles(serializeSubtitles(first, { format: 'vtt' }), { format: 'vtt' });
    expect(second.meta.vttBlocks).toHaveLength(1);
    expect(second.cues[0]?.settings).toBe('align:start');
    expect(second.cues[0]?.text).toBe('文本');
  });

  it('SRT -> VTT -> SRT preserves text', () => {
    const srt = parseSubtitles(SIMPLE_SRT);
    const vttText = serializeSubtitles(srt, { format: 'vtt' });
    expect(vttText.startsWith('WEBVTT')).toBe(true);
    expect(vttText).toContain('00:00:01.000 --> 00:00:03.000');
    const back = parseSubtitles(vttText, { format: 'vtt' });
    expect(back.cues.map((cue) => cue.text)).toEqual(srt.cues.map((cue) => cue.text));
    const srtAgain = parseSubtitles(serializeSubtitles(back, { format: 'srt' }));
    expect(srtAgain.cues.map((cue) => cue.text)).toEqual(srt.cues.map((cue) => cue.text));
  });
});
