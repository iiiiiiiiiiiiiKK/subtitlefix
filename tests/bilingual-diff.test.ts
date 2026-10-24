import { beforeEach, describe, expect, it } from 'vitest';
import { mergeBilingual, setSecondary } from '../src/core/bilingual';
import { diffDocs, diffText } from '../src/core/diff';
import { resetCueIds } from '../src/core/ids';
import { parseSubtitles } from '../src/core/parse';
import { serializeSubtitles } from '../src/core/serialize';
import { createEmptyDoc } from '../src/core/types';
import type { Cue, Doc } from '../src/core/types';

beforeEach(() => resetCueIds());

function makeDoc(cues: Partial<Cue>[]): Doc {
  const base = createEmptyDoc();
  return {
    ...base,
    cues: cues.map((cue, index) => ({
      id: cue.id ?? `c${index + 1}`,
      number: cue.number ?? index + 1,
      start: cue.start ?? 0,
      end: cue.end ?? 1000,
      text: cue.text ?? 'x',
      ...(cue.secondary ? { secondary: cue.secondary } : {}),
    })),
  };
}

const EN = `1
00:00:01,000 --> 00:00:04,000
Hello

2
00:00:04,000 --> 00:00:07,000
World

3
00:00:10,000 --> 00:00:12,000
Unmatched
`;

const ZH = `1
00:00:01,200 --> 00:00:03,900
你好

2
00:00:04,100 --> 00:00:06,800
世界

3
00:00:20,000 --> 00:00:22,000
多余的一条
`;

describe('mergeBilingual — overlap', () => {
  it('pairs cues by overlapping time', () => {
    const primary = parseSubtitles(EN, { fileName: 'en.srt' });
    const secondary = parseSubtitles(ZH, { fileName: 'zh.srt' });
    const { doc, report } = mergeBilingual(primary, secondary);
    expect(report.matchedCount).toBe(2);
    expect(doc.cues[0]?.secondary).toBe('你好');
    expect(doc.cues[1]?.secondary).toBe('世界');
    expect(doc.cues[2]?.secondary).toBeUndefined();
    expect(report.unmatchedSecondary).toBe(1);
  });

  it('never modifies primary timing', () => {
    const primary = parseSubtitles(EN);
    const secondary = parseSubtitles(ZH);
    const { doc } = mergeBilingual(primary, secondary);
    expect(doc.cues.map((cue) => [cue.start, cue.end])).toEqual(
      primary.cues.map((cue) => [cue.start, cue.end]),
    );
  });

  it('respects the minOverlapRatio threshold', () => {
    const primary = makeDoc([{ start: 0, end: 10_000, text: 'p' }]);
    const secondary = makeDoc([{ start: 9_000, end: 20_000, text: 's' }]);
    // overlap 1000ms against a 10000ms primary -> ratio 0.1
    expect(mergeBilingual(primary, secondary, { minOverlapRatio: 0.1 }).report.matchedCount).toBe(1);
    expect(mergeBilingual(primary, secondary, { minOverlapRatio: 0.5 }).report.matchedCount).toBe(0);
  });

  it('does not pair one secondary cue twice', () => {
    const primary = makeDoc([
      { start: 0, end: 2000, text: 'a' },
      { start: 1000, end: 3000, text: 'b' },
    ]);
    const secondary = makeDoc([{ start: 0, end: 3000, text: 'shared' }]);
    const { report, doc } = mergeBilingual(primary, secondary, { minOverlapRatio: 0.1 });
    expect(report.matchedCount).toBe(1);
    expect(doc.cues.filter((cue) => cue.secondary === 'shared')).toHaveLength(1);
  });
});

describe('mergeBilingual — index strategy', () => {
  it('pairs by position regardless of timing', () => {
    const primary = makeDoc([{ start: 0, end: 1000, text: 'a' }, { start: 5000, end: 6000, text: 'b' }]);
    const secondary = makeDoc([{ start: 9000, end: 9500, text: '甲' }, { start: 100, end: 200, text: '乙' }]);
    const { doc } = mergeBilingual(primary, secondary, { strategy: 'index' });
    expect(doc.cues.map((cue) => cue.secondary)).toEqual(['甲', '乙']);
  });
});

describe('mergeBilingual — nearest-start strategy', () => {
  it('pairs the closest start within the threshold', () => {
    const primary = makeDoc([{ start: 10_000, end: 12_000, text: 'p' }]);
    const secondary = makeDoc([
      { start: 10_300, end: 12_000, text: 'near' },
      { start: 30_000, end: 31_000, text: 'far' },
    ]);
    const { doc } = mergeBilingual(primary, secondary, { strategy: 'nearest-start', maxStartDistanceMs: 1000 });
    expect(doc.cues[0]?.secondary).toBe('near');
  });

  it('leaves cues unmatched when beyond the threshold', () => {
    const primary = makeDoc([{ start: 0, end: 1000, text: 'p' }]);
    const secondary = makeDoc([{ start: 60_000, end: 61_000, text: 's' }]);
    const { doc, report } = mergeBilingual(primary, secondary, {
      strategy: 'nearest-start',
      maxStartDistanceMs: 500,
    });
    expect(report.matchedCount).toBe(0);
    expect(doc.cues[0]?.secondary).toBeUndefined();
  });
});

describe('mergeBilingual — unmatched secondary handling', () => {
  it('appends unmatched cues when keepUnmatched is on', () => {
    const primary = makeDoc([{ start: 0, end: 1000, text: 'p' }]);
    const secondary = makeDoc([{ start: 50_000, end: 51_000, text: 'orphan-zh' }]);
    const { doc } = mergeBilingual(primary, secondary, {
      strategy: 'nearest-start',
      maxStartDistanceMs: 10,
      keepUnmatched: true,
      unmatchedPosition: 'end',
    });
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[1]?.secondary).toBe('orphan-zh');
    expect(doc.cues[1]?.text).toBe('');
    expect(doc.cues.map((cue) => cue.number)).toEqual([1, 2]);
  });

  it('reports counts in the merge report', () => {
    const primary = parseSubtitles(EN);
    const secondary = parseSubtitles(ZH);
    const { report } = mergeBilingual(primary, secondary);
    expect(report).toMatchObject({
      primaryCount: 3,
      secondaryCount: 3,
      unmatchedPrimary: 1,
      unmatchedSecondary: 1,
      strategy: 'overlap',
    });
    expect(report.pairings).toHaveLength(3);
  });
});

describe('setSecondary', () => {
  it('sets the secondary text and keeps an emptied field editable', () => {
    const doc = makeDoc([{ text: 'a' }]);
    const withSecondary = setSecondary(doc, 'c1', '译');
    expect(withSecondary.cues[0]?.secondary).toBe('译');
    const cleared = setSecondary(withSecondary, 'c1', '');
    expect(cleared.cues[0]?.secondary).toBe('');
    // An empty secondary line must not be written to the output.
    expect(serializeSubtitles(cleared)).toContain('a\n');
    expect(serializeSubtitles(cleared)).not.toContain('\n\n\n');
  });
});

describe('diffDocs', () => {
  it('reports an unchanged document', () => {
    const doc = makeDoc([{ text: 'a' }, { text: 'b' }]);
    const diff = diffDocs(doc, doc);
    expect(diff.cues.every((row) => row.status === 'unchanged')).toBe(true);
    expect(diff.noTextLost).toBe(true);
  });

  it('detects text and timing changes', () => {
    const before = makeDoc([{ id: 'x', text: 'a', start: 0, end: 1000 }]);
    const after = makeDoc([{ id: 'x', text: 'b', start: 0, end: 2000 }]);
    const diff = diffDocs(before, after);
    expect(diff.cues[0]?.status).toBe('both-changed');
    expect(diff.textChanged).toBe(1);
    expect(diff.timingChanged).toBe(1);
  });

  it('detects removed cues and whether text was lost', () => {
    const before = makeDoc([{ id: 'x', text: 'a' }, { id: 'y', text: 'b' }]);
    const after = makeDoc([{ id: 'x', text: 'a' }]);
    const diff = diffDocs(before, after);
    expect(diff.removed).toBe(1);
    expect(diff.noTextLost).toBe(false);
    expect(diff.lostCues[0]?.text).toBe('b');
  });

  it('detects added cues', () => {
    const before = makeDoc([{ id: 'x', text: 'a' }]);
    const after = makeDoc([{ id: 'x', text: 'a' }, { id: 'z', text: 'new' }]);
    const diff = diffDocs(before, after);
    expect(diff.added).toBe(1);
    expect(diff.afterCount).toBe(2);
  });

  it('matches by position when ids changed (imported files)', () => {
    const before = makeDoc([{ id: 'a1', text: 'same' }]);
    const after = makeDoc([{ id: 'b1', text: 'different' }]);
    const diff = diffDocs(before, after);
    expect(diff.cues[0]?.status).toBe('text-changed');
    expect(diff.removed).toBe(0);
  });

  it('counts characters on both sides', () => {
    const before = makeDoc([{ text: 'abcd' }]);
    const after = makeDoc([{ text: 'abcdef' }]);
    const diff = diffDocs(before, after);
    expect(diff.beforeChars).toBe(4);
    expect(diff.afterChars).toBe(6);
  });
});

describe('diffText', () => {
  it('returns a single same segment for identical text', () => {
    expect(diffText('abc', 'abc')).toEqual([{ type: 'same', value: 'abc' }]);
  });

  it('marks inserted words as added', () => {
    const segments = diffText('hello world', 'hello brave world');
    expect(segments.some((seg) => seg.type === 'added' && seg.value.trim() === 'brave')).toBe(true);
  });

  it('marks deleted words as removed', () => {
    const segments = diffText('hello brave world', 'hello world');
    expect(segments.some((seg) => seg.type === 'removed' && seg.value.trim() === 'brave')).toBe(true);
  });

  it('handles CJK text', () => {
    const segments = diffText('你好世界', '你好，世界');
    expect(segments.filter((seg) => seg.type === 'added').map((seg) => seg.value).join('')).toContain('，');
  });

  it('handles empty input', () => {
    expect(diffText('', '')).toEqual([]);
  });
});
