import type { Cue, Doc } from './types';

export type DiffStatus = 'unchanged' | 'text-changed' | 'timing-changed' | 'both-changed' | 'removed' | 'added';

export interface CueDiff {
  status: DiffStatus;
  beforeNumber: number;
  afterNumber: number | null;
  beforeText: string;
  afterText: string;
  beforeStart: number;
  beforeEnd: number;
  afterStart: number | null;
  afterEnd: number | null;
  /** Cue id usable for jump-to in the *new* document. */
  afterId: string | null;
}

export interface DocDiff {
  cues: CueDiff[];
  beforeCount: number;
  afterCount: number;
  added: number;
  removed: number;
  textChanged: number;
  timingChanged: number;
  /** Total characters in cue bodies, to prove nothing was silently dropped. */
  beforeChars: number;
  afterChars: number;
  /** True when no cue body text disappeared. */
  noTextLost: boolean;
  /** Cues whose text vanished entirely (removed cues with non-empty bodies). */
  lostCues: { number: number; text: string }[];
}

/**
 * Structural diff between two versions of the same document.
 *
 * Used by the pre-export dialog: the user sees exactly which cues changed and
 * whether any cue body text would disappear, so a repair can never silently
 * shred subtitles. Cues are matched by id first (edits keep ids) and then by
 * order for cues created by merging/importing.
 */
export function diffDocs(before: Doc, after: Doc): DocDiff {
  const afterById = new Map(after.cues.map((cue) => [cue.id, cue]));
  const matched = new Set<string>();
  const rows: CueDiff[] = [];

  before.cues.forEach((cue, index) => {
    const current = afterById.get(cue.id);
    if (!current) {
      const fallback = after.cues[index];
      if (fallback && !matched.has(fallback.id)) {
        matched.add(fallback.id);
        rows.push(makeRow(cue, fallback));
      } else {
        rows.push({
          status: 'removed',
          beforeNumber: cue.number,
          afterNumber: null,
          beforeText: cue.text,
          afterText: '',
          beforeStart: cue.start,
          beforeEnd: cue.end,
          afterStart: null,
          afterEnd: null,
          afterId: null,
        });
      }
      return;
    }
    matched.add(current.id);
    rows.push(makeRow(cue, current));
  });

  after.cues.forEach((cue) => {
    if (matched.has(cue.id)) return;
    rows.push({
      status: 'added',
      beforeNumber: 0,
      afterNumber: cue.number,
      beforeText: '',
      afterText: cue.text,
      beforeStart: 0,
      beforeEnd: 0,
      afterStart: cue.start,
      afterEnd: cue.end,
      afterId: cue.id,
    });
  });

  const lostCues = rows
    .filter((row) => row.status === 'removed' && row.beforeText.trim() !== '')
    .map((row) => ({ number: row.beforeNumber, text: row.beforeText }));

  const beforeChars = before.cues.reduce((sum, cue) => sum + cue.text.length, 0);
  const afterChars = after.cues.reduce((sum, cue) => sum + cue.text.length, 0);

  return {
    cues: rows,
    beforeCount: before.cues.length,
    afterCount: after.cues.length,
    added: rows.filter((row) => row.status === 'added').length,
    removed: rows.filter((row) => row.status === 'removed').length,
    textChanged: rows.filter((row) => row.status === 'text-changed' || row.status === 'both-changed').length,
    timingChanged: rows.filter((row) => row.status === 'timing-changed' || row.status === 'both-changed').length,
    beforeChars,
    afterChars,
    noTextLost: lostCues.length === 0,
    lostCues,
  };
}

function makeRow(before: Cue, after: Cue): CueDiff {
  const textChanged = before.text !== after.text || (before.secondary ?? '') !== (after.secondary ?? '');
  const timingChanged = before.start !== after.start || before.end !== after.end;
  const status: DiffStatus = textChanged && timingChanged
    ? 'both-changed'
    : textChanged
      ? 'text-changed'
      : timingChanged
        ? 'timing-changed'
        : 'unchanged';
  return {
    status,
    beforeNumber: before.number,
    afterNumber: after.number,
    beforeText: before.text,
    afterText: after.text,
    beforeStart: before.start,
    beforeEnd: before.end,
    afterStart: after.start,
    afterEnd: after.end,
    afterId: after.id,
  };
}

export interface TextDiffSegment {
  type: 'same' | 'added' | 'removed';
  value: string;
}

/**
 * Word/character level diff for the "before vs after" panel.
 * A trimmed LCS keeps it O(n*m) but bounded by `maxLength`.
 */
export function diffText(before: string, after: string, maxLength = 4000): TextDiffSegment[] {
  const a = before.slice(0, maxLength);
  const b = after.slice(0, maxLength);
  if (a === b) return a === '' ? [] : [{ type: 'same', value: a }];

  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const n = tokensA.length;
  const m = tokensB.length;

  // LCS table (bounded: 2000 x 2000 cells max)
  if (n * m > 4_000_000) {
    return [
      { type: 'removed', value: a },
      { type: 'added', value: b },
    ];
  }

  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] =
        tokensA[i] === tokensB[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const segments: TextDiffSegment[] = [];
  const push = (type: TextDiffSegment['type'], value: string) => {
    if (value === '') return;
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.value += value;
    else segments.push({ type, value });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (tokensA[i] === tokensB[j]) {
      push('same', tokensA[i]!);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push('removed', tokensA[i]!);
      i += 1;
    } else {
      push('added', tokensB[j]!);
      j += 1;
    }
  }
  while (i < n) {
    push('removed', tokensA[i]!);
    i += 1;
  }
  while (j < m) {
    push('added', tokensB[j]!);
    j += 1;
  }
  return segments;
}

function tokenize(text: string): string[] {
  // Split into CJK characters, latin words, whitespace runs and single symbols.
  return text.match(/\s+|[\u4e00-\u9fff\u3040-\u30ff]|[A-Za-z0-9']+|[\s\S]/g) ?? [];
}
