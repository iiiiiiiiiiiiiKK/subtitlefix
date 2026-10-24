import { nextCueId } from './ids';
import type { Cue, Doc } from './types';

export type MatchStrategy = 'overlap' | 'index' | 'nearest-start';

export interface MergeOptions {
  strategy?: MatchStrategy;
  /**
   * For `overlap`: minimum fraction of the *shorter* cue that must overlap.
   * 0 means "any touch", 1 means "identical ranges".
   */
  minOverlapRatio?: number;
  /** For `nearest-start`: max allowed distance between starts, in ms. */
  maxStartDistanceMs?: number;
  /** Keep secondary cues that never got paired as their own entries. */
  keepUnmatched?: boolean;
  /** Where unmatched secondary cues are appended (default: end). */
  unmatchedPosition?: 'end' | 'start' | 'interleaved';
}

export interface PairRecord {
  primaryId: string;
  primaryPosition: number;
  secondaryId: string | null;
  secondaryPosition: number | null;
  /** Overlap in ms, or start distance for `nearest-start`. */
  score: number;
  manual: boolean;
}

export interface MergeReport {
  pairings: PairRecord[];
  matchedCount: number;
  primaryCount: number;
  secondaryCount: number;
  unmatchedPrimary: number;
  unmatchedSecondary: number;
  strategy: MatchStrategy;
}

export interface MergeBilingualResult {
  doc: Doc;
  report: MergeReport;
}

const DEFAULTS: Required<Omit<MergeOptions, 'keepUnmatched' | 'unmatchedPosition'>> = {
  strategy: 'overlap',
  minOverlapRatio: 0.2,
  maxStartDistanceMs: 2000,
};

function overlapMs(a: Cue, b: Cue): number {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

function overlapRatio(a: Cue, b: Cue): number {
  const overlap = overlapMs(a, b);
  if (overlap <= 0) return 0;
  const shorter = Math.max(1, Math.min(a.end - a.start, b.end - b.start));
  return overlap / shorter;
}

/**
 * Merge a second-language document into the primary one.
 *
 * The primary timeline is authoritative: secondary cues never change primary
 * start/end times. Every pairing is returned in `report.pairings` so the UI can
 * show it and let the user re-pair cues manually.
 */
export function mergeBilingual(
  primary: Doc,
  secondary: Doc,
  options: MergeOptions = {},
): MergeBilingualResult {
  const cfg = { ...DEFAULTS, ...options };
  const strategy = options.strategy ?? cfg.strategy;
  const keepUnmatched = options.keepUnmatched ?? false;
  const unmatchedPosition = options.unmatchedPosition ?? 'end';

  const usedSecondary = new Set<string>();
  const pairings: PairRecord[] = [];

  const cues: Cue[] = primary.cues.map((cue, index) => {
    let best: { cue: Cue; score: number } | null = null;

    if (strategy === 'index') {
      const candidate = secondary.cues[index];
      if (candidate) best = { cue: candidate, score: 0 };
    } else {
      for (const candidate of secondary.cues) {
        if (usedSecondary.has(candidate.id)) continue;
        if (strategy === 'overlap') {
          const ratio = overlapRatio(cue, candidate);
          if (ratio >= cfg.minOverlapRatio && (!best || ratio > best.score)) {
            best = { cue: candidate, score: ratio };
          }
        } else {
          const distance = Math.abs(candidate.start - cue.start);
          if (distance <= cfg.maxStartDistanceMs && (!best || distance < best.score)) {
            best = { cue: candidate, score: distance };
          }
        }
      }
    }

    if (best) {
      usedSecondary.add(best.cue.id);
      pairings.push({
        primaryId: cue.id,
        primaryPosition: index + 1,
        secondaryId: best.cue.id,
        secondaryPosition: secondary.cues.indexOf(best.cue) + 1,
        score: best.score,
        manual: false,
      });
      return { ...cue, secondary: best.cue.text };
    }

    pairings.push({
      primaryId: cue.id,
      primaryPosition: index + 1,
      secondaryId: null,
      secondaryPosition: null,
      score: 0,
      manual: false,
    });
    return cue;
  });

  const leftover = secondary.cues.filter((cue) => !usedSecondary.has(cue.id));

  if (keepUnmatched && leftover.length > 0) {
    const extras: Cue[] = leftover.map((cue) => ({
      id: nextCueId(),
      number: cue.number,
      start: cue.start,
      end: cue.end,
      text: '',
      secondary: cue.text,
      ...(cue.settings ? { settings: cue.settings } : {}),
    }));

    if (unmatchedPosition === 'start') cues.unshift(...extras);
    else if (unmatchedPosition === 'interleaved') {
      for (const extra of extras) {
        const at = cues.findIndex((cue) => cue.start > extra.start);
        if (at === -1) cues.push(extra);
        else cues.splice(at, 0, extra);
      }
    } else cues.push(...extras);
  }

  const numbered = cues.map((cue, index) => ({ ...cue, number: index + 1 }));

  const matchedCount = pairings.filter((pair) => pair.secondaryId !== null).length;

  return {
    doc: {
      ...primary,
      cues: numbered,
      meta: {
        ...primary.meta,
        source: 'merge',
        issues: primary.meta.issues.filter((issue) => issue.code !== 'empty-file'),
      },
      bilingual: {
        ...primary.bilingual,
        enabled: true,
      },
    },
    report: {
      pairings,
      matchedCount,
      primaryCount: primary.cues.length,
      secondaryCount: secondary.cues.length,
      unmatchedPrimary: primary.cues.length - matchedCount,
      unmatchedSecondary: leftover.length,
      strategy,
    },
  };
}

/**
 * Set the secondary (translation) text of a single cue.
 *
 * An empty string is stored as-is rather than deleting the field: the editor
 * keeps its textarea mounted while the user types, and the serializer treats an
 * empty secondary line as "no translation".
 */
export function setSecondary(doc: Doc, cueId: string, secondary: string): Doc {
  return {
    ...doc,
    cues: doc.cues.map((cue) => (cue.id === cueId ? { ...cue, secondary } : cue)),
  };
}
