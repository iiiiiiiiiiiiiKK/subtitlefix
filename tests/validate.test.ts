import { beforeEach, describe, expect, it } from 'vitest';
import { resetCueIds } from '../src/core/ids';
import { parseSubtitles } from '../src/core/parse';
import { serializeSubtitles } from '../src/core/serialize';
import { createEmptyDoc } from '../src/core/types';
import type { Cue, Doc } from '../src/core/types';
import { summarizeIssues, validateDoc } from '../src/core/validate';

beforeEach(() => resetCueIds());

function makeDoc(cues: Partial<Cue>[]): Doc {
  const base = createEmptyDoc();
  return {
    ...base,
    cues: cues.map((cue, index) => ({
      id: `c${index + 1}`,
      number: cue.number ?? index + 1,
      start: cue.start ?? 0,
      end: cue.end ?? 1000,
      text: cue.text ?? 'x',
      ...(cue.secondary ? { secondary: cue.secondary } : {}),
    })),
  };
}

describe('validateDoc', () => {
  it('passes a clean document', () => {
    const issues = validateDoc(makeDoc([{ start: 0, end: 1000 }, { start: 1000, end: 2000 }]));
    expect(issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });

  it('flags start-after-end as an error with a swap fix', () => {
    const issues = validateDoc(makeDoc([{ start: 5000, end: 3000 }]));
    const issue = issues.find((row) => row.code === 'start-after-end');
    expect(issue?.severity).toBe('error');
    expect(issue?.fix).toBe('swap-times');
    expect(issue?.cueNumber).toBe(1);
  });

  it('flags negative times', () => {
    const issues = validateDoc(makeDoc([{ start: -100, end: 500 }]));
    expect(issues.some((row) => row.code === 'negative-time')).toBe(true);
  });

  it('flags empty cue text as a warning', () => {
    const issues = validateDoc(makeDoc([{ text: '   ' }]));
    expect(issues.find((row) => row.code === 'empty-text')?.fix).toBe('delete-empty');
  });

  it('flags overlaps with the overlap duration in the message', () => {
    const issues = validateDoc(makeDoc([
      { start: 0, end: 3000 },
      { start: 2000, end: 4000 },
    ]));
    const issue = issues.find((row) => row.code === 'overlap');
    expect(issue?.message).toContain('1000ms');
    expect(issue?.fix).toBe('trim-overlap');
  });

  it('does not flag exact back-to-back cues as overlapping', () => {
    const issues = validateDoc(makeDoc([{ start: 0, end: 1000 }, { start: 1000, end: 2000 }]));
    expect(issues.some((row) => row.code === 'overlap')).toBe(false);
  });

  it('flags out-of-order cues', () => {
    const issues = validateDoc(makeDoc([{ start: 5000, end: 6000 }, { start: 0, end: 1000 }]));
    expect(issues.some((row) => row.code === 'out-of-order')).toBe(true);
  });

  it('flags duplicate numbers', () => {
    const issues = validateDoc(makeDoc([{ number: 1 }, { number: 1 }]));
    expect(issues.some((row) => row.code === 'duplicate-number')).toBe(true);
  });

  it('flags non-sequential numbering once', () => {
    const issues = validateDoc(makeDoc([{ number: 2 }, { number: 5 }]));
    expect(issues.filter((row) => row.code === 'number-sequence')).toHaveLength(1);
  });

  it('flags very short cues as info', () => {
    const issues = validateDoc(makeDoc([{ start: 0, end: 50 }]));
    expect(issues.find((row) => row.code === 'too-short')?.severity).toBe('info');
  });

  it('flags an arrow inside cue text', () => {
    const issues = validateDoc(makeDoc([{ text: 'a --> b' }]));
    expect(issues.some((row) => row.code === 'arrow-in-text')).toBe(true);
  });

  it('flags ASS style tags as info', () => {
    const issues = validateDoc(makeDoc([{ text: '{\\i1}hi{\\i0}' }]));
    expect(issues.find((row) => row.code === 'ass-tags')?.severity).toBe('info');
  });

  it('orders errors before warnings before info', () => {
    const issues = validateDoc(makeDoc([
      { start: 0, end: 50, text: 'short' },
      { start: 9000, end: 5000, text: 'reversed' },
    ]));
    expect(issues[0]?.severity).toBe('error');
  });

  it('merges parse-time diagnostics into the list', () => {
    const doc = parseSubtitles('1\n00:00:0X,000 --> 00:00:03,000\n正文\n');
    const issues = validateDoc(doc);
    expect(issues.some((row) => row.code === 'malformed-timing')).toBe(true);
  });
});

describe('summarizeIssues', () => {
  it('counts by severity and affected cues', () => {
    const issues = validateDoc(makeDoc([{ start: 5000, end: 1000 }, { text: '' }]));
    const summary = summarizeIssues(issues);
    expect(summary.error).toBeGreaterThan(0);
    expect(summary.warning).toBeGreaterThan(0);
    expect(summary.total).toBe(issues.length);
    expect(summary.cuesAffected).toBeGreaterThan(0);
  });
});

describe('serializeSubtitles', () => {
  it('writes SRT with comma timecodes and blank-line separation', () => {
    const doc = makeDoc([{ start: 1000, end: 3000, text: 'a' }, { start: 4000, end: 6000, text: 'b' }]);
    const text = serializeSubtitles(doc, { format: 'srt' });
    expect(text).toBe('1\n00:00:01,000 --> 00:00:03,000\na\n\n2\n00:00:04,000 --> 00:00:06,000\nb\n');
  });

  it('writes VTT with a WEBVTT header and dot timecodes', () => {
    const doc = makeDoc([{ start: 1000, end: 3000, text: 'a' }]);
    const text = serializeSubtitles(doc, { format: 'vtt' });
    expect(text.startsWith('WEBVTT')).toBe(true);
    expect(text).toContain('00:00:01.000 --> 00:00:03.000');
  });

  it('honours CRLF output', () => {
    const doc = makeDoc([{ text: 'a' }]);
    expect(serializeSubtitles(doc, { newline: '\r\n' })).toContain('\r\n');
  });

  it('can emit a BOM when asked', () => {
    const doc = makeDoc([{ text: 'a' }]);
    expect(serializeSubtitles(doc, { bom: true }).startsWith('\uFEFF')).toBe(true);
  });

  it('drops WebVTT settings from SRT output', () => {
    const doc = makeDoc([{ text: 'a' }]);
    doc.cues[0]!.settings = 'align:start';
    const srt = serializeSubtitles(doc, { format: 'srt' });
    expect(srt).not.toContain('align:start');
  });

  it('keeps settings in VTT output', () => {
    const doc = makeDoc([{ text: 'a' }]);
    doc.cues[0]!.settings = 'align:start';
    expect(serializeSubtitles(doc, { format: 'vtt' })).toContain('align:start');
  });

  it('preserves NOTE blocks in VTT output', () => {
    const parsed = parseSubtitles('WEBVTT\n\nNOTE\nnote body\n\n00:00:01.000 --> 00:00:02.000\nx\n', {
      format: 'vtt',
    });
    const text = serializeSubtitles(parsed, { format: 'vtt' });
    expect(text).toContain('NOTE');
    expect(text).toContain('note body');
  });

  it('renders bilingual secondary text using the chosen separator', () => {
    const doc = makeDoc([{ text: 'hello', secondary: '你好' }]);
    expect(serializeSubtitles(doc)).toContain('hello\n你好');
    const slash = { ...doc, bilingual: { ...doc.bilingual, separator: ' / ' as const } };
    expect(serializeSubtitles(slash)).toContain('hello / 你好');
    const reversed = { ...doc, bilingual: { ...doc.bilingual, order: 'secondary-first' as const } };
    expect(serializeSubtitles(reversed)).toContain('你好\nhello');
  });

  it('keeps multi-line bodies intact', () => {
    const doc = makeDoc([{ text: 'line1\nline2\nline3' }]);
    const text = serializeSubtitles(doc);
    expect(text).toContain('line1\nline2\nline3');
  });

  it('writes negative timecodes but the validator flags them', () => {
    const doc = makeDoc([{ start: -1000, end: 1000 }]);
    expect(serializeSubtitles(doc)).toContain('-00:00:01,000');
    expect(validateDoc(doc).some((issue) => issue.code === 'negative-time')).toBe(true);
  });
});
