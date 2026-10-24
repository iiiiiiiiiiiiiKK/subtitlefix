import type { Cue, Doc, Issue, IssueSeverity, FixId } from './types';

export interface ValidateOptions {
  /** Overlap below this duration is treated as info noise instead of a warning. */
  overlapToleranceMs?: number;
  /** Flag cues shorter than this. */
  minDurationMs?: number;
}

const DEFAULT_OPTIONS: Required<ValidateOptions> = {
  overlapToleranceMs: 1,
  minDurationMs: 120,
};

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Recompute every validation issue from the current cue list.
 *
 * Parse-time diagnostics live in `doc.meta.issues`; this function only produces
 * issues that depend on the *current* state, so editing a cue clears its issue
 * immediately without a re-parse.
 */
export function validateDoc(doc: Doc, options: ValidateOptions = {}): Issue[] {
  const cfg = { ...DEFAULT_OPTIONS, ...options };
  const issues: Issue[] = [];

  doc.cues.forEach((cue, index) => {
    const position = index + 1;
    const base = { cueId: cue.id, cueNumber: cue.number, cuePosition: position };

    if (cue.start < 0 || cue.end < 0) {
      issues.push({
        id: `neg-${cue.id}`,
        code: 'negative-time',
        severity: 'error',
        message: `第 ${position} 条字幕存在负时间`,
        detail: `开始 ${cue.start}ms / 结束 ${cue.end}ms`,
        ...base,
        fix: 'shift-all-positive',
        fixLabel: '整体平移至 ≥ 0',
      });
    }

    if (cue.start > cue.end) {
      issues.push({
        id: `order-${cue.id}`,
        code: 'start-after-end',
        severity: 'error',
        message: `第 ${position} 条字幕开始时间晚于结束时间`,
        detail: `${fmt(cue.start)} → ${fmt(cue.end)}`,
        ...base,
        fix: 'swap-times',
        fixLabel: '交换开始/结束时间',
      });
    }

    if (cue.text.trim() === '') {
      issues.push({
        id: `empty-${cue.id}`,
        code: 'empty-text',
        severity: 'warning',
        message: `第 ${position} 条字幕正文为空`,
        ...base,
        fix: 'delete-empty',
        fixLabel: '删除空字幕',
      });
    }

    if (cue.start <= cue.end && cue.end - cue.start < cfg.minDurationMs) {
      issues.push({
        id: `short-${cue.id}`,
        code: 'too-short',
        severity: 'info',
        message: `第 ${position} 条字幕显示时长过短（${cue.end - cue.start}ms）`,
        detail: '短于一帧的字幕在多数播放器中无法看清。',
        ...base,
        fix: 'min-duration',
        fixLabel: '延长至最短时长',
      });
    }

    if (cue.text.includes('-->')) {
      issues.push({
        id: `arrow-${cue.id}`,
        code: 'arrow-in-text',
        severity: 'warning',
        message: `第 ${position} 条字幕正文包含 "-->"`,
        detail: '部分播放器会把该行误判为时间轴。',
        ...base,
      });
    }

    if (/\{\\[a-zA-Z]/.test(cue.text)) {
      issues.push({
        id: `ass-${cue.id}`,
        code: 'ass-tags',
        severity: 'info',
        message: `第 ${position} 条字幕包含 ASS/SSA 样式标签`,
        detail: 'SRT/VTT 不支持 {\\...} 语法，导出后可能原样显示。',
        ...base,
      });
    }
  });

  // Sequence / duplicate numbers
  const seen = new Map<number, number>();
  doc.cues.forEach((cue, index) => {
    const prev = seen.get(cue.number);
    if (prev !== undefined) {
      issues.push({
        id: `dupnum-${cue.id}`,
        code: 'duplicate-number',
        severity: 'warning',
        message: `第 ${index + 1} 条字幕编号 ${cue.number} 与第 ${prev} 条重复`,
        cueId: cue.id,
        cueNumber: cue.number,
        cuePosition: index + 1,
        fix: 'renumber',
        fixLabel: '按顺序重排编号',
      });
    } else {
      seen.set(cue.number, index + 1);
    }
  });

  const notSequential = doc.cues.some((cue, index) => cue.number !== index + 1);
  if (notSequential && doc.cues.length > 0) {
    const first = doc.cues.findIndex((cue, index) => cue.number !== index + 1);
    issues.push({
      id: 'seq-number',
      code: 'number-sequence',
      severity: 'info',
      message: '字幕编号不连续',
      detail: `第 ${first + 1} 条应为 ${first + 1}，实际为 ${doc.cues[first]?.number}`,
      cueId: doc.cues[first]?.id,
      cueNumber: doc.cues[first]?.number,
      cuePosition: first + 1,
      fix: 'renumber',
      fixLabel: '按顺序重排编号',
    });
  }

  // Chronological order + overlaps
  for (let i = 1; i < doc.cues.length; i += 1) {
    const prev = doc.cues[i - 1]!;
    const cur = doc.cues[i]!;
    if (cur.start < prev.start) {
      issues.push({
        id: `unsorted-${cur.id}`,
        code: 'out-of-order',
        severity: 'warning',
        message: `第 ${i + 1} 条字幕的开始时间早于上一条`,
        detail: `${fmt(prev.start)} 之后出现 ${fmt(cur.start)}`,
        cueId: cur.id,
        cueNumber: cur.number,
        cuePosition: i + 1,
        fix: 'sort-by-start',
        fixLabel: '按开始时间排序',
      });
    }
    const overlap = prev.end - cur.start;
    if (overlap > cfg.overlapToleranceMs) {
      issues.push({
        id: `overlap-${cur.id}`,
        code: 'overlap',
        severity: 'warning',
        message: `第 ${i} 条与第 ${i + 1} 条字幕时间重叠 ${overlap}ms`,
        detail: `上一条结束 ${fmt(prev.end)}，本条开始 ${fmt(cur.start)}`,
        cueId: cur.id,
        cueNumber: cur.number,
        cuePosition: i + 1,
        fix: 'trim-overlap',
        fixLabel: '裁掉重叠部分',
      });
    }
  }

  for (const issue of doc.meta.issues) issues.push(issue);

  return issues.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const pa = a.cuePosition ?? Number.MAX_SAFE_INTEGER;
    const pb = b.cuePosition ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
}

export interface IssueSummary {
  error: number;
  warning: number;
  info: number;
  total: number;
  /** Number of distinct cues referenced by at least one issue. */
  cuesAffected: number;
}

export function summarizeIssues(issues: Issue[]): IssueSummary {
  const cues = new Set<string>();
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') error += 1;
    else if (issue.severity === 'warning') warning += 1;
    else info += 1;
    if (issue.cueId) cues.add(issue.cueId);
  }
  return { error, warning, info, total: issues.length, cuesAffected: cues.size };
}

export function issuesForCue(issues: Issue[], cueId: string): Issue[] {
  return issues.filter((issue) => issue.cueId === cueId);
}

export const FIX_LABELS: Record<FixId, string> = {
  'swap-times': '交换开始/结束时间',
  'clamp-negative': '修正负时间',
  'delete-empty': '删除空字幕',
  renumber: '按顺序重排编号',
  'trim-overlap': '裁掉重叠部分',
  'shift-all-positive': '整体平移至 ≥ 0',
  'min-duration': '延长至最短时长',
  'sort-by-start': '按开始时间排序',
  'merge-orphans': '并入最后一条字幕',
};

function fmt(ms: number): string {
  return `${ms}ms`;
}

export function cueSeverity(issues: Issue[], cueId: string): IssueSeverity | null {
  const list = issuesForCue(issues, cueId);
  if (list.length === 0) return null;
  if (list.some((issue) => issue.severity === 'error')) return 'error';
  if (list.some((issue) => issue.severity === 'warning')) return 'warning';
  return 'info';
}

export function isCueEmpty(cue: Cue): boolean {
  return cue.text.trim() === '';
}
