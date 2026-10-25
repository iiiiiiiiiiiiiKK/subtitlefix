import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEMO_SRT, TOUR_STEPS, TOUR_EXPORT_STEP } from '../src/core/demo';
import { parseSubtitles } from '../src/core/parse';
import { validateDoc } from '../src/core/validate';
import { applyFix, trimOverlaps } from '../src/core/ops';
import { serializeSubtitles } from '../src/core/serialize';

/** The demo file on disk must match the demo embedded in the app byte-for-byte. */
const demoFile = readFileSync('examples/demo-walkthrough.srt', 'utf8').replace(/\r\n/g, '\n');

function issuesOf(doc: ReturnType<typeof parseSubtitles>) {
  return validateDoc(doc);
}

describe('guided demo fixture', () => {
  it('matches examples/demo-walkthrough.srt exactly', () => {
    expect(DEMO_SRT.replace(/\r\n/g, '\n')).toBe(demoFile);
  });

  it('parses into 8 cues with no parse errors about missing cues', () => {
    const doc = parseSubtitles(DEMO_SRT, { fileName: 'demo-walkthrough.srt' });
    expect(doc.cues).toHaveLength(8);
    expect(doc.cues.map((cue) => cue.number)).toEqual([1, 2, 3, 4, 5, 6, 8, 9]);
    expect(doc.cues[0]!.text).toContain('3 分钟演示');
  });

  it('demonstrates every defect the tour claims to fix', () => {
    const doc = parseSubtitles(DEMO_SRT);
    const issues = issuesOf(doc);
    const codes = new Set(issues.map((issue) => issue.code));

    // 1 start-after-end (cue 3)
    expect(codes.has('start-after-end')).toBe(true);
    // 2 overlap (cues 1-2 and 6-8)
    expect(codes.has('overlap')).toBe(true);
    // 3 empty cue (cue 4)
    expect(codes.has('empty-text')).toBe(true);
    // 4 broken numbering (6 -> 8)
    expect(codes.has('number-sequence')).toBe(true);
    // 5 missing blank separator between 6 and 8
    expect(doc.meta.issues.some((issue) => issue.code === 'missing-blank-separator')).toBe(true);

    // And the parse is still lossless: every cue body survived.
    expect(doc.cues.filter((cue) => cue.text.trim() !== '')).toHaveLength(7);
  });

  it('contains no fabricated "fake" content: every cue talks about itself', () => {
    const doc = parseSubtitles(DEMO_SRT);
    expect(doc.cues[1]!.text).toContain('时间重叠');
    expect(doc.cues[2]!.text).toContain('开始时间');
    expect(doc.cues[4]!.text).toContain('空的');
    expect(doc.cues[5]!.text).toContain('编号');
    expect(doc.cues[6]!.text).toContain('空行');
  });

  it('is fully repairable: the tour leaves zero errors and keeps all cue text', () => {
    const start = parseSubtitles(DEMO_SRT);
    const before = start.cues.map((cue) => cue.text.replace(/\s+/g, ''));

    // Exactly the sequence the tour performs.
    let doc = applyFix(start, 'swap-times').doc;
    doc = trimOverlaps(doc).doc;
    doc = applyFix(doc, 'renumber').doc;
    doc = applyFix(doc, 'trim-overlap').doc;

    const remaining = validateDoc(doc);
    expect(remaining.filter((issue) => issue.severity === 'error')).toHaveLength(0);

    // No cue body was altered by any of those repairs.
    expect(doc.cues.map((cue) => cue.text.replace(/\s+/g, ''))).toEqual(before);

    // And the exported file re-imports with the same number of cues and bodies.
    const text = serializeSubtitles(doc, { format: 'srt' });
    const roundTrip = parseSubtitles(text);
    expect(roundTrip.cues).toHaveLength(doc.cues.length);
    expect(roundTrip.cues.map((cue) => cue.text)).toEqual(doc.cues.map((cue) => cue.text));
  });

  it('keeps the reversed cue repairable by a single swap', () => {
    const doc = parseSubtitles(DEMO_SRT);
    const swapped = applyFix(doc, 'swap-times').doc;
    expect(swapped.cues[2]).toMatchObject({ start: 5000, end: 8000 });
    expect(swapped.cues[2]!.text).toBe(doc.cues[2]!.text);
  });

  it('keeps overlap repair non-destructive', () => {
    const doc = parseSubtitles(DEMO_SRT);
    const { doc: trimmed, trimmed: count } = trimOverlaps(doc);
    expect(count).toBeGreaterThan(0);
    expect(trimmed.cues.map((cue) => cue.text)).toEqual(doc.cues.map((cue) => cue.text));
  });
});

describe('tour script', () => {
  it('has a load step first and an export step before the end', () => {
    expect(TOUR_STEPS[0]!.action).toBe('load-demo');
    expect(TOUR_EXPORT_STEP).toBeGreaterThan(0);
    expect(TOUR_EXPORT_STEP).toBeLessThan(TOUR_STEPS.length - 1);
    expect(TOUR_STEPS[TOUR_STEPS.length - 1]!.id).toBe('done');
  });

  it('uses unique ids and non-empty copy', () => {
    const ids = TOUR_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(10);
    }
  });

  it('only spotlights selectors that actually exist in the app', () => {
    const source = readFileSync('src/App.tsx', 'utf8') +
      readFileSync('src/components/CueList.tsx', 'utf8') +
      readFileSync('src/components/IssuePanel.tsx', 'utf8') +
      readFileSync('src/components/Toolbar.tsx', 'utf8');

    for (const step of TOUR_STEPS) {
      if (!step.target) continue;
      const testId = /data-testid="([^"]+)"/.exec(step.target)?.[1];
      expect(testId, `step ${step.id} target should be a data-testid`).toBeTruthy();
      expect(source, `missing data-testid="${testId}" for step ${step.id}`).toContain(`"${testId}"`);
    }
  });
});
