import { nextCueId } from './ids';
import { normalizeCueText } from './parse';
import type { Cue, Doc, FixId } from './types';

/** Immutable helpers. Every operation returns a new Doc, never mutates the input. */

export function withCues(doc: Doc, cues: Cue[]): Doc {
  return { ...doc, cues };
}

export function mapCues(doc: Doc, fn: (cue: Cue, index: number) => Cue): Doc {
  return { ...doc, cues: doc.cues.map(fn) };
}

export function updateCue(doc: Doc, cueId: string, patch: Partial<Omit<Cue, 'id'>>): Doc {
  return mapCues(doc, (cue) => (cue.id === cueId ? { ...cue, ...patch } : cue));
}

/** Clamp an end time so it never precedes the start time. */
export function clampEnd(start: number, end: number): number {
  return end < start ? start : end;
}

// ---------------------------------------------------------------------------
// Shifting
// ---------------------------------------------------------------------------

export interface ShiftOptions {
  /** Only shift these cue ids; omit to shift every cue. */
  cueIds?: string[];
  /** Keep all times >= 0 by clamping instead of allowing negative values. */
  clampAtZero?: boolean;
}

export interface ShiftResult {
  doc: Doc;
  /** How many cues were modified. */
  changed: number;
  /** Clamped cues, reported so the UI can tell the user nothing vanished. */
  clamped: number;
}

/**
 * Shift the timeline by `deltaMs` (positive = later, negative = earlier).
 *
 * Negative shifts that cross zero are handled explicitly: with `clampAtZero`
 * times stop at 00:00:00.000, otherwise the negative value is kept and the
 * validator flags it so the user can decide. Nothing is ever deleted.
 */
export function shiftTimeline(doc: Doc, deltaMs: number, options: ShiftOptions = {}): ShiftResult {
  const delta = Math.round(deltaMs);
  if (delta === 0) return { doc, changed: 0, clamped: 0 };
  const target = options.cueIds ? new Set(options.cueIds) : null;
  let changed = 0;
  let clamped = 0;

  const cues = doc.cues.map((cue) => {
    if (target && !target.has(cue.id)) return cue;
    changed += 1;
    let start = cue.start + delta;
    let end = cue.end + delta;
    if (options.clampAtZero) {
      if (start < 0) {
        start = 0;
        clamped += 1;
      }
      if (end < 0) {
        end = 0;
        clamped += 1;
      }
      if (end < start) end = start;
    }
    return { ...cue, start, end };
  });

  return { doc: withCues(doc, cues), changed, clamped };
}

/** Shift so the earliest cue starts exactly at zero (or at `targetStart`). */
export function normalizeStart(doc: Doc, targetStart = 0): ShiftResult {
  if (doc.cues.length === 0) return { doc, changed: 0, clamped: 0 };
  const min = Math.min(...doc.cues.map((cue) => cue.start));
  return shiftTimeline(doc, targetStart - min);
}

// ---------------------------------------------------------------------------
// Structural edits
// ---------------------------------------------------------------------------

export interface SplitResult {
  doc: Doc;
  /** Id of the newly created second half, or null when the split was refused. */
  newCueId: string | null;
  error?: string;
}

/**
 * Split one cue at an absolute time (ms).
 * The split point must be strictly inside the cue; text is divided by
 * proportional line allocation so manual line breaks are not destroyed.
 */
export function splitCue(doc: Doc, cueId: string, atMs: number): SplitResult {
  const index = doc.cues.findIndex((cue) => cue.id === cueId);
  if (index === -1) return { doc, newCueId: null, error: '找不到目标字幕' };
  const cue = doc.cues[index]!;
  const at = Math.round(atMs);
  if (at <= cue.start || at >= cue.end) {
    return { doc, newCueId: null, error: '拆分点必须位于字幕开始与结束之间' };
  }

  const lines = cue.text.split('\n');
  const ratio = (at - cue.start) / Math.max(1, cue.end - cue.start);
  let splitAt = Math.round(lines.length * ratio);
  if (lines.length > 1) splitAt = Math.min(Math.max(splitAt, 1), lines.length - 1);

  const firstText = splitAt >= lines.length ? lines.join('\n') : lines.slice(0, splitAt).join('\n');
  const secondText = splitAt >= lines.length ? '' : lines.slice(splitAt).join('\n');
  const newId = nextCueId();

  const first: Cue = { ...cue, end: at, text: normalizeCueText(firstText) };
  const second: Cue = {
    id: newId,
    number: cue.number + 1,
    start: at,
    end: cue.end,
    text: normalizeCueText(secondText),
    ...(cue.settings ? { settings: cue.settings } : {}),
  };

  const cues = [...doc.cues.slice(0, index), first, second, ...doc.cues.slice(index + 1)];
  return { doc: renumber({ ...doc, cues }), newCueId: newId };
}

export interface MergeResult {
  doc: Doc;
  mergedCueId: string | null;
  error?: string;
}

/**
 * Merge two or more cues into the first selected one.
 *
 * Rule: the merged cue spans from the earliest start to the latest end, and the
 * bodies are joined with a newline. Nothing is discarded.
 */
export function mergeCues(doc: Doc, cueIds: string[]): MergeResult {
  const ids = new Set(cueIds);
  const indices = doc.cues.map((cue, index) => (ids.has(cue.id) ? index : -1)).filter((i) => i >= 0);
  if (indices.length < 2) return { doc, mergedCueId: null, error: '请至少选择两条相邻字幕' };

  const firstIndex = indices[0]!;
  const lastIndex = indices[indices.length - 1]!;
  const contiguous = lastIndex - firstIndex + 1 === indices.length;
  if (!contiguous) return { doc, mergedCueId: null, error: '只能合并相邻的字幕' };

  const group = doc.cues.slice(firstIndex, lastIndex + 1);
  const start = Math.min(...group.map((cue) => cue.start));
  const end = Math.max(...group.map((cue) => cue.end));
  const text = group
    .map((cue) => cue.text)
    .filter((value) => value.trim() !== '')
    .join('\n');
  const secondary = group
    .map((cue) => cue.secondary ?? '')
    .filter((value) => value.trim() !== '')
    .join('\n');

  const merged: Cue = {
    ...group[0]!,
    start,
    end,
    text: normalizeCueText(text),
    ...(secondary ? { secondary: normalizeCueText(secondary) } : {}),
  };

  const cues = [...doc.cues.slice(0, firstIndex), merged, ...doc.cues.slice(lastIndex + 1)];
  return { doc: renumber({ ...doc, cues }), mergedCueId: merged.id };
}

export function deleteCues(doc: Doc, cueIds: string[]): Doc {
  const ids = new Set(cueIds);
  return renumber(withCues(doc, doc.cues.filter((cue) => !ids.has(cue.id))));
}

export function deleteEmptyCues(doc: Doc): { doc: Doc; removed: number } {
  const kept = doc.cues.filter((cue) => cue.text.trim() !== '');
  return { doc: renumber(withCues(doc, kept)), removed: doc.cues.length - kept.length };
}

/** Renumber cues 1..n. Idempotent. */
export function renumber(doc: Doc): Doc {
  let dirty = false;
  const cues = doc.cues.map((cue, index) => {
    if (cue.number === index + 1) return cue;
    dirty = true;
    return { ...cue, number: index + 1 };
  });
  return dirty ? withCues(doc, cues) : doc;
}

export function sortByStart(doc: Doc): Doc {
  const cues = [...doc.cues].sort((a, b) => a.start - b.start || a.end - b.end);
  return renumber(withCues(doc, cues));
}

/** Trim overlaps by shortening the earlier cue. Never touches cue text. */
export function trimOverlaps(doc: Doc, toleranceMs = 1): { doc: Doc; trimmed: number } {
  const result: Cue[] = [];
  let trimmed = 0;
  for (const cue of doc.cues) {
    const prev = result[result.length - 1];
    if (prev && cue.start < prev.end - toleranceMs && cue.start > prev.start) {
      result[result.length - 1] = { ...prev, end: Math.max(prev.start, cue.start) };
      trimmed += 1;
    }
    result.push(cue);
  }
  return { doc: trimmed > 0 ? withCues(doc, result) : doc, trimmed };
}

/** Extend cues shorter than `minDurationMs` without creating new overlaps. */
export function enforceMinDuration(doc: Doc, minDurationMs = 500): { doc: Doc; adjusted: number } {
  let adjusted = 0;
  const cues = doc.cues.map((cue, index) => {
    const duration = cue.end - cue.start;
    if (duration >= minDurationMs) return cue;
    const next = doc.cues[index + 1];
    const limit = next ? Math.min(cue.start + minDurationMs, next.start) : cue.start + minDurationMs;
    if (limit <= cue.end) return cue;
    adjusted += 1;
    return { ...cue, end: limit };
  });
  return { doc: withCues(doc, cues), adjusted };
}

// ---------------------------------------------------------------------------
// Search & replace
// ---------------------------------------------------------------------------

export type SearchField = 'all' | 'text' | 'index' | 'time';
export type SearchScope = 'all' | 'selection';

export interface SearchOptions {
  field?: SearchField;
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
  /** Inclusive time range in ms, applied to cue start time. */
  fromMs?: number;
  toMs?: number;
  scope?: SearchScope;
  selectedIds?: string[];
}

export interface SearchMatch {
  cueId: string;
  cuePosition: number;
  cueNumber: number;
  field: 'text' | 'secondary' | 'index' | 'time';
  /** Character offset into the searched string (text fields only). */
  start: number;
  end: number;
  preview: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPattern(query: string, options: SearchOptions): RegExp | null {
  if (query === '') return null;
  const flags = options.caseSensitive ? 'g' : 'gi';
  let source = options.regex ? query : escapeRegex(query);
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

export function searchCues(doc: Doc, query: string, options: SearchOptions = {}): SearchMatch[] {
  const field = options.field ?? 'all';
  const scope = options.scope ?? 'all';
  const selected = options.selectedIds ? new Set(options.selectedIds) : null;
  const pattern = field === 'text' || field === 'all' || field === 'index' ? buildPattern(query, options) : null;
  const matches: SearchMatch[] = [];

  const tolerant = !options.caseSensitive;
  const needle = tolerant ? query.toLowerCase() : query;

  doc.cues.forEach((cue, index) => {
    if (scope === 'selection' && selected && !selected.has(cue.id)) return;
    const inRange =
      (options.fromMs === undefined || cue.start >= options.fromMs) &&
      (options.toMs === undefined || cue.start <= options.toMs);
    if (!inRange) return;

    if (field === 'index' || field === 'all') {
      if (String(cue.number).includes(query) || needle === String(cue.number)) {
        matches.push({
          cueId: cue.id,
          cuePosition: index + 1,
          cueNumber: cue.number,
          field: 'index',
          start: 0,
          end: String(cue.number).length,
          preview: `#${cue.number}`,
        });
      }
    }

    if (field === 'time' || field === 'all') {
      const label = `${cue.start} ${cue.end}`;
      if (label.includes(query) || timesMatchText(cue, needle)) {
        matches.push({
          cueId: cue.id,
          cuePosition: index + 1,
          cueNumber: cue.number,
          field: 'time',
          start: 0,
          end: 0,
          preview: `${cue.start}ms → ${cue.end}ms`,
        });
      }
    }

    if (field === 'text' || field === 'all') {
      if (!pattern) return;
      const text = cue.text;
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      let count = 0;
      while ((m = pattern.exec(text)) !== null && count < 200) {
        matches.push({
          cueId: cue.id,
          cuePosition: index + 1,
          cueNumber: cue.number,
          field: 'text',
          start: m.index,
          end: m.index + m[0].length,
          preview: makePreview(text, m.index, m.index + m[0].length),
        });
        count += 1;
        if (m[0].length === 0) pattern.lastIndex += 1;
      }
      const secondary = cue.secondary ?? '';
      if (secondary) {
        pattern.lastIndex = 0;
        while ((m = pattern.exec(secondary)) !== null) {
          matches.push({
            cueId: cue.id,
            cuePosition: index + 1,
            cueNumber: cue.number,
            field: 'secondary',
            start: m.index,
            end: m.index + m[0].length,
            preview: makePreview(secondary, m.index, m.index + m[0].length),
          });
          if (m[0].length === 0) pattern.lastIndex += 1;
        }
      }
    }
  });

  return matches;
}

function timesMatchText(cue: Cue, needle: string): boolean {
  const asClock = (ms: number) => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  return asClock(cue.start).includes(needle) || asClock(cue.end).includes(needle);
}

function makePreview(text: string, start: number, end: number, pad = 24): string {
  const from = Math.max(0, start - pad);
  const to = Math.min(text.length, end + pad);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  return `${prefix}${text.slice(from, to).replace(/\n/g, ' ⏎ ')}${suffix}`;
}

export interface ReplaceOptions extends SearchOptions {
  /** Replace only these cue ids (used by "replace in selected cue"). */
  cueIds?: string[];
}

export interface ReplacePlanItem {
  cueId: string;
  cuePosition: number;
  before: string;
  after: string;
  field: 'text' | 'secondary' | 'index';
}

export interface ReplacePlan {
  items: ReplacePlanItem[];
  totalReplacements: number;
  patternError?: string;
}

/**
 * Build a replace *preview* without mutating the document.
 * This is what powers the "批量修改预览" panel and the pre-export diff dialog.
 */
export function planReplace(
  doc: Doc,
  query: string,
  replacement: string,
  options: ReplaceOptions = {},
): ReplacePlan {
  const items: ReplacePlanItem[] = [];
  let total = 0;

  if (query === '') return { items, totalReplacements: 0 };

  if (options.field === 'index') {
    const target = Number(replacement);
    if (!Number.isInteger(target)) {
      return { items, totalReplacements: 0, patternError: '编号替换必须填写整数' };
    }
    doc.cues.forEach((cue, index) => {
      if (String(cue.number) !== query) return;
      if (options.cueIds && !options.cueIds.includes(cue.id)) return;
      items.push({
        cueId: cue.id,
        cuePosition: index + 1,
        before: `#${cue.number}`,
        after: `#${target}`,
        field: 'index',
      });
      total += 1;
    });
    return { items, totalReplacements: total };
  }

  const pattern = buildPattern(query, options);
  if (!pattern) return { items, totalReplacements: 0, patternError: '正则表达式无效' };
  const allowed = options.cueIds ? new Set(options.cueIds) : null;

  doc.cues.forEach((cue, index) => {
    if (allowed && !allowed.has(cue.id)) return;

    const text = cue.text;
    pattern.lastIndex = 0;
    const replaced = text.replace(pattern, replacement);
    const count = countMatches(text, pattern);
    if (replaced !== text) {
      items.push({
        cueId: cue.id,
        cuePosition: index + 1,
        before: text,
        after: replaced,
        field: 'text',
      });
      total += count;
    }

    const secondary = cue.secondary ?? '';
    if (secondary) {
      pattern.lastIndex = 0;
      const replacedSecondary = secondary.replace(pattern, replacement);
      const countSecondary = countMatches(secondary, pattern);
      if (replacedSecondary !== secondary) {
        items.push({
          cueId: cue.id,
          cuePosition: index + 1,
          before: secondary,
          after: replacedSecondary,
          field: 'secondary',
        });
        total += countSecondary;
      }
    }
  });

  return { items, totalReplacements: total };
}

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    count += 1;
    if (m[0].length === 0) pattern.lastIndex += 1;
  }
  pattern.lastIndex = 0;
  return count;
}

export function applyReplacePlan(doc: Doc, plan: ReplacePlan): Doc {
  if (plan.items.length === 0) return doc;
  const byCue = new Map<string, ReplacePlanItem[]>();
  for (const item of plan.items) {
    const list = byCue.get(item.cueId) ?? [];
    list.push(item);
    byCue.set(item.cueId, list);
  }
  const cues = doc.cues.map((cue) => {
    const items = byCue.get(cue.id);
    if (!items) return cue;
    let next = { ...cue };
    for (const item of items) {
      if (item.field === 'text') next = { ...next, text: item.after };
      else if (item.field === 'secondary') next = { ...next, secondary: item.after };
      else if (item.field === 'index') next = { ...next, number: Number(item.after.replace('#', '')) };
    }
    return next;
  });
  return withCues(doc, cues);
}

// ---------------------------------------------------------------------------
// Fix application
// ---------------------------------------------------------------------------

export interface FixOutcome {
  doc: Doc;
  message: string;
}

/** Apply one of the advertised repairs. Never deletes content unless the fix says so. */
export function applyFix(doc: Doc, fix: FixId, cueId?: string): FixOutcome {
  switch (fix) {
    case 'swap-times': {
      if (!cueId) {
        const broken = doc.cues.filter((cue) => cue.start > cue.end);
        if (broken.length === 0) return { doc, message: '没有需要交换的时间轴' };
        const cues = doc.cues.map((cue) =>
          cue.start > cue.end ? { ...cue, start: cue.end, end: cue.start } : cue,
        );
        return { doc: withCues(doc, cues), message: `已交换 ${broken.length} 条字幕的开始/结束时间` };
      }
      return {
        doc: mapCues(doc, (cue) =>
          cue.id === cueId && cue.start > cue.end ? { ...cue, start: cue.end, end: cue.start } : cue,
        ),
        message: '已交换该条字幕的开始/结束时间',
      };
    }
    case 'clamp-negative': {
      const cues = doc.cues.map((cue) =>
        cue.start < 0 || cue.end < 0
          ? { ...cue, start: Math.max(0, cue.start), end: Math.max(0, cue.end) }
          : cue,
      );
      const fixed = doc.cues.filter((cue) => cue.start < 0 || cue.end < 0).length;
      return { doc: withCues(doc, cues), message: fixed ? `已修正 ${fixed} 条负时间字幕` : '没有负时间字幕' };
    }
    case 'shift-all-positive': {
      const min = doc.cues.length > 0 ? Math.min(...doc.cues.map((cue) => cue.start)) : 0;
      if (min >= 0) return { doc, message: '所有字幕时间均已 ≥ 0' };
      const result = shiftTimeline(doc, -min);
      return { doc: result.doc, message: `已整体后移 ${-min}ms，最早字幕现在从 0 开始` };
    }
    case 'delete-empty': {
      const { doc: next, removed } = deleteEmptyCues(doc);
      return {
        doc: next,
        message: removed ? `已删除 ${removed} 条空字幕` : '没有空字幕',
      };
    }
    case 'renumber': {
      return { doc: renumber(doc), message: '已按顺序重排字幕编号' };
    }
    case 'trim-overlap': {
      const { doc: next, trimmed } = trimOverlaps(doc);
      return { doc: next, message: trimmed ? `已裁掉 ${trimmed} 处时间重叠` : '没有时间重叠' };
    }
    case 'min-duration': {
      const { doc: next, adjusted } = enforceMinDuration(doc);
      return { doc: next, message: adjusted ? `已延长 ${adjusted} 条过短字幕` : '没有过短字幕' };
    }
    case 'sort-by-start': {
      return { doc: sortByStart(doc), message: '已按开始时间排序' };
    }
    case 'merge-orphans': {
      return { doc, message: '暂无可并入的孤立文本' };
    }
    default:
      return { doc, message: '未识别的修复操作' };
  }
}
