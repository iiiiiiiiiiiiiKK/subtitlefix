import { beforeEach, describe, expect, it } from 'vitest';
import { resetCueIds } from '../src/core/ids';
import {
  applyFix,
  applyReplacePlan,
  deleteCues,
  deleteEmptyCues,
  enforceMinDuration,
  mergeCues,
  normalizeStart,
  planReplace,
  renumber,
  searchCues,
  shiftTimeline,
  sortByStart,
  splitCue,
  trimOverlaps,
  updateCue,
} from '../src/core/ops';
import { parseSubtitles } from '../src/core/parse';
import { createEmptyDoc } from '../src/core/types';
import type { Doc } from '../src/core/types';

beforeEach(() => resetCueIds());

function doc(spec: [number, number, string][]): Doc {
  const base = createEmptyDoc();
  return {
    ...base,
    cues: spec.map(([start, end, text], index) => ({
      id: `c${index + 1}`,
      number: index + 1,
      start,
      end,
      text,
    })),
  };
}

describe('shiftTimeline', () => {
  it('shifts every cue forward', () => {
    const { doc: next, changed } = shiftTimeline(doc([[1000, 2000, 'a']]), 500);
    expect(changed).toBe(1);
    expect(next.cues[0]).toMatchObject({ start: 1500, end: 2500 });
  });

  it('supports millisecond-precise negative shifts', () => {
    const { doc: next } = shiftTimeline(doc([[1000, 2000, 'a'], [5000, 6000, 'b']]), -250);
    expect(next.cues.map((cue) => cue.start)).toEqual([750, 4750]);
  });

  it('crosses zero and keeps negative times when clamping is off', () => {
    const { doc: next } = shiftTimeline(doc([[100, 900, 'a']]), -500);
    expect(next.cues[0]).toMatchObject({ start: -400, end: 400 });
  });

  it('clamps at zero when requested and reports the count', () => {
    const result = shiftTimeline(doc([[100, 900, 'a'], [5000, 6000, 'b']]), -500, { clampAtZero: true });
    expect(result.doc.cues[0]).toMatchObject({ start: 0, end: 400 });
    expect(result.clamped).toBeGreaterThan(0);
  });

  it('only shifts the selected cues', () => {
    const { doc: next } = shiftTimeline(doc([[0, 100, 'a'], [200, 300, 'b']]), 1000, { cueIds: ['c2'] });
    expect(next.cues[0]?.start).toBe(0);
    expect(next.cues[1]?.start).toBe(1200);
  });

  it('is a no-op for a zero delta', () => {
    const input = doc([[1000, 2000, 'a']]);
    const result = shiftTimeline(input, 0);
    expect(result.changed).toBe(0);
    expect(result.doc).toBe(input);
  });

  it('does not mutate the input document', () => {
    const input = doc([[1000, 2000, 'a']]);
    shiftTimeline(input, 500);
    expect(input.cues[0]?.start).toBe(1000);
  });
});

describe('normalizeStart', () => {
  it('moves the earliest cue to zero', () => {
    const { doc: next } = normalizeStart(doc([[2500, 3000, 'a'], [9000, 9500, 'b']]));
    expect(next.cues.map((cue) => cue.start)).toEqual([0, 6500]);
  });
});

describe('splitCue', () => {
  it('splits a cue into two with correct timings', () => {
    const input = doc([[0, 4000, '上半句\n下半句']]);
    const result = splitCue(input, 'c1', 2000);
    expect(result.newCueId).toBeTruthy();
    expect(result.doc.cues).toHaveLength(2);
    expect(result.doc.cues[0]).toMatchObject({ start: 0, end: 2000, text: '上半句' });
    expect(result.doc.cues[1]).toMatchObject({ start: 2000, end: 4000, text: '下半句' });
    expect(result.doc.cues.map((cue) => cue.number)).toEqual([1, 2]);
  });

  it('refuses a split point outside the cue', () => {
    const result = splitCue(doc([[1000, 2000, 'a']]), 'c1', 2500);
    expect(result.newCueId).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('keeps text when splitting a single-line cue', () => {
    const result = splitCue(doc([[0, 2000, '一句话']]), 'c1', 1000);
    expect(result.doc.cues[0]?.text).toBe('一句话');
    expect(result.doc.cues[1]?.text).toBe('');
  });
});

describe('mergeCues', () => {
  it('merges adjacent cues and spans the full range', () => {
    const input = doc([[0, 1000, 'a'], [1000, 2000, 'b'], [3000, 4000, 'c']]);
    const result = mergeCues(input, ['c1', 'c2']);
    expect(result.doc.cues).toHaveLength(2);
    expect(result.doc.cues[0]).toMatchObject({ start: 0, end: 2000, text: 'a\nb' });
    expect(result.doc.cues[1]?.number).toBe(2);
  });

  it('refuses non-adjacent selections', () => {
    const input = doc([[0, 1000, 'a'], [1000, 2000, 'b'], [3000, 4000, 'c']]);
    const result = mergeCues(input, ['c1', 'c3']);
    expect(result.mergedCueId).toBeNull();
    expect(result.error).toContain('相邻');
  });

  it('refuses a single selection', () => {
    expect(mergeCues(doc([[0, 1000, 'a']]), ['c1']).mergedCueId).toBeNull();
  });
});

describe('delete / renumber / sort', () => {
  it('deletes selected cues and renumbers', () => {
    const next = deleteCues(doc([[0, 1, 'a'], [2, 3, 'b'], [4, 5, 'c']]), ['c2']);
    expect(next.cues.map((cue) => cue.text)).toEqual(['a', 'c']);
    expect(next.cues.map((cue) => cue.number)).toEqual([1, 2]);
  });

  it('removes only empty cues', () => {
    const { doc: next, removed } = deleteEmptyCues(doc([[0, 1, 'a'], [2, 3, '   ']]));
    expect(removed).toBe(1);
    expect(next.cues).toHaveLength(1);
  });

  it('renumber is idempotent', () => {
    const input = { ...doc([[0, 1, 'a']]), cues: [{ id: 'x', number: 7, start: 0, end: 1, text: 'a' }] };
    const once = renumber(input);
    expect(once.cues[0]?.number).toBe(1);
    expect(renumber(once)).toBe(once);
  });

  it('sorts by start time and renumbers', () => {
    const next = sortByStart(doc([[5000, 6000, 'b'], [0, 1000, 'a']]));
    expect(next.cues.map((cue) => cue.text)).toEqual(['a', 'b']);
    expect(next.cues.map((cue) => cue.number)).toEqual([1, 2]);
  });
});

describe('overlap & duration repairs', () => {
  it('trims overlaps without touching text', () => {
    const { doc: next, trimmed } = trimOverlaps(doc([[0, 3000, 'a'], [2000, 4000, 'b']]));
    expect(trimmed).toBe(1);
    expect(next.cues[0]).toMatchObject({ start: 0, end: 2000, text: 'a' });
    expect(next.cues[1]?.text).toBe('b');
  });

  it('does nothing when there is no overlap', () => {
    const input = doc([[0, 1000, 'a'], [1000, 2000, 'b']]);
    const result = trimOverlaps(input);
    expect(result.trimmed).toBe(0);
    expect(result.doc).toBe(input);
  });

  it('extends short cues but never past the next cue', () => {
    const { doc: next, adjusted } = enforceMinDuration(doc([[0, 100, 'a'], [300, 900, 'b']]), 500);
    expect(adjusted).toBe(1);
    expect(next.cues[0]?.end).toBe(300);
  });
});

describe('searchCues', () => {
  const input = doc([[0, 1000, 'Hello world'], [1000, 2000, 'hello again']]);

  it('finds case-insensitively by default', () => {
    expect(searchCues(input, 'hello')).toHaveLength(2);
  });

  it('respects case sensitivity', () => {
    expect(searchCues(input, 'hello', { caseSensitive: true })).toHaveLength(1);
  });

  it('filters by cue number', () => {
    const matches = searchCues(input, '2', { field: 'index' });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.cueNumber).toBe(2);
  });

  it('filters by time range', () => {
    const matches = searchCues(input, 'hello', { fromMs: 900, toMs: 5000 });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.cueNumber).toBe(2);
  });

  it('supports regex queries', () => {
    expect(searchCues(input, 'w[a-z]+d', { regex: true })).toHaveLength(1);
  });

  it('returns nothing for an invalid regex instead of throwing', () => {
    expect(searchCues(input, '([', { regex: true })).toHaveLength(0);
  });

  it('limits search to a selection', () => {
    expect(searchCues(input, 'hello', { scope: 'selection', selectedIds: ['c1'] })).toHaveLength(1);
  });
});

describe('planReplace / applyReplacePlan', () => {
  const input = doc([[0, 1000, 'cat and cat'], [1000, 2000, 'dog']]);

  it('plans replacements without mutating', () => {
    const plan = planReplace(input, 'cat', 'bird');
    expect(plan.totalReplacements).toBe(2);
    expect(plan.items).toHaveLength(1);
    expect(input.cues[0]?.text).toBe('cat and cat');
  });

  it('applies the plan', () => {
    const plan = planReplace(input, 'cat', 'bird');
    const next = applyReplacePlan(input, plan);
    expect(next.cues[0]?.text).toBe('bird and bird');
    expect(next.cues[1]?.text).toBe('dog');
  });

  it('supports capture groups in regex replacement', () => {
    const plan = planReplace(input, '(\\w+) and (\\w+)', '$2 和 $1', { regex: true });
    expect(applyReplacePlan(input, plan).cues[0]?.text).toBe('cat 和 cat');
  });

  it('restricts replacement to given cue ids', () => {
    const plan = planReplace(input, 'cat', 'bird', { cueIds: ['c2'] });
    expect(plan.totalReplacements).toBe(0);
  });

  it('reports a pattern error instead of throwing', () => {
    const plan = planReplace(input, '([', 'x', { regex: true });
    expect(plan.patternError).toBeTruthy();
  });

  it('replaces cue numbers when the field is index', () => {
    const plan = planReplace(input, '2', '22', { field: 'index' });
    expect(plan.items).toHaveLength(1);
    expect(applyReplacePlan(input, plan).cues[1]?.number).toBe(22);
  });
});

describe('applyFix', () => {
  it('swaps reversed times', () => {
    const outcome = applyFix(doc([[9000, 5000, 'x']]), 'swap-times');
    expect(outcome.doc.cues[0]).toMatchObject({ start: 5000, end: 9000 });
  });

  it('shifts negative times to zero', () => {
    const outcome = applyFix(doc([[-500, 500, 'x'], [1000, 1500, 'y']]), 'shift-all-positive');
    expect(outcome.doc.cues.map((cue) => cue.start)).toEqual([0, 1500]);
  });

  it('clamps negative times', () => {
    const outcome = applyFix(doc([[-500, 500, 'x']]), 'clamp-negative');
    expect(outcome.doc.cues[0]).toMatchObject({ start: 0, end: 500 });
  });

  it('reports when there is nothing to fix', () => {
    const outcome = applyFix(doc([[0, 100, 'x']]), 'swap-times');
    expect(outcome.message).toContain('没有');
  });
});

describe('updateCue', () => {
  it('patches a single cue immutably', () => {
    const input = doc([[0, 1000, 'a']]);
    const next = updateCue(input, 'c1', { text: 'b', start: 50 });
    expect(next.cues[0]).toMatchObject({ text: 'b', start: 50 });
    expect(input.cues[0]?.text).toBe('a');
  });
});

describe('large documents', () => {
  it('handles 20k cues for shifting and validation-scale operations', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      const start = i * 2000;
      const toClock = (ms: number) => {
        const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
        const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
        const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
        const r = String(ms % 1000).padStart(3, '0');
        return `${h}:${m}:${s},${r}`;
      };
      lines.push(`${i + 1}`, `${toClock(start)} --> ${toClock(start + 1500)}`, `第 ${i + 1} 行字幕`, '');
    }
    const raw = lines.join('\n');
    const parsed = parseSubtitles(raw, { fileName: 'big.srt' });
    expect(parsed.cues).toHaveLength(20_000);
    const shifted = shiftTimeline(parsed, 100);
    expect(shifted.doc.cues[19_999]?.start).toBe(19_999 * 2000 + 100);
    const split = splitCue(parsed, parsed.cues[0]!.id, 750);
    expect(split.doc.cues).toHaveLength(20_001);
  });
});
