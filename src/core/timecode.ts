/**
 * Timecode parsing / formatting and timing-line parsing.
 *
 * All arithmetic happens on integer milliseconds. Timestamps are never rewritten
 * with a blanket regex on the whole file — only recognised timing lines are
 * touched, so cue bodies keep their punctuation, line breaks and Unicode intact.
 */

import type { SubtitleFormat } from './types';

export interface ParsedTime {
  ms: number;
  negative: boolean;
  /** Non-fatal normalisation note (e.g. seconds >= 60 were carried over). */
  warning?: string;
}

/** `[-]HH:MM:SS[,.]mmm` or `[-]MM:SS[,.]mmm` (fraction optional, 1-3 digits). */
const TIMECODE_RE = /^(-)?(?:(\d{2,}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/;

export function parseTimecode(input: string): ParsedTime | null {
  if (typeof input !== 'string') return null;
  const m = TIMECODE_RE.exec(input.trim());
  if (!m) return null;

  const sign = m[1] ? -1 : 1;
  const hours = m[2] === undefined ? null : Number(m[2]);
  const minutes = Number(m[3]);
  const seconds = Number(m[4]);
  const fraction = m[5] ?? '';

  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  // `MM:SS` without a fraction is ambiguous (minutes or hours?); only accept the
  // short form when the millisecond part is present.
  if (hours === null && m[5] === undefined) return null;

  const millis = fraction === '' ? 0 : Number(fraction.padEnd(3, '0'));
  let warning: string | undefined;
  if (seconds >= 60) warning = '秒数超过 59，已按 60 进制换算';
  if (hours !== null && minutes >= 60) warning = '分钟超过 59，已按 60 进制换算';

  const total =
    hours === null
      ? minutes * 60_000 + seconds * 1000 + millis
      : hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + millis;

  return { ms: sign * total, negative: sign < 0, ...(warning ? { warning } : {}) };
}

/** True when the token is shaped like a timestamp (used for fault tolerance). */
export function looksLikeTimecode(token: string): boolean {
  return parseTimecode(token) !== null;
}

/**
 * Format milliseconds as a subtitle timestamp.
 * Negative values are rendered with a leading `-` so the editor can show them;
 * exporters guard against writing them (see `validate`).
 */
export function formatTimecode(ms: number, format: SubtitleFormat = 'srt'): string {
  const negative = ms < 0;
  let rest = Math.round(Math.abs(ms));

  const hours = Math.floor(rest / 3_600_000);
  rest -= hours * 3_600_000;
  const minutes = Math.floor(rest / 60_000);
  rest -= minutes * 60_000;
  const seconds = Math.floor(rest / 1000);
  const millis = rest - seconds * 1000;

  const sep = format === 'vtt' ? '.' : ',';
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const msPart = String(millis).padStart(3, '0');

  return `${negative ? '-' : ''}${hh}:${mm}:${ss}${sep}${msPart}`;
}

/** Compact, human-friendly duration for the UI (`1.25s`, `2m 03s`). */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(abs)}ms`;
  if (abs < 60_000) return `${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 2).replace(/\.?0+$/, '')}s`;
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.round((abs - minutes * 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** `mm:ss` label used by the timeline strip. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export interface TimingParse {
  raw: string;
  startMs: number | null;
  endMs: number | null;
  startRaw: string;
  endRaw: string;
  /** WebVTT cue settings that follow the end timestamp. */
  settings: string;
  problems: string[];
}

/**
 * Parse a `start --> end [settings]` line leniently.
 * Returns `null` when the line has no arrow at all.
 */
export function parseTimingLine(line: string): TimingParse | null {
  const arrow = line.indexOf('-->');
  if (arrow === -1) return null;

  const problems: string[] = [];
  const left = line.slice(0, arrow).trim();
  const right = line.slice(arrow + 3).trim();

  let startRaw = left;
  if (/\s/.test(left)) {
    const tokens = left.split(/\s+/);
    const last = tokens[tokens.length - 1] ?? '';
    if (looksLikeTimecode(last)) {
      startRaw = last;
      problems.push('开始时间前存在多余字符，已忽略');
    }
  }

  let endRaw = right;
  let settings = '';
  const endMatch = /^(\S+)\s*([\s\S]*)$/.exec(right);
  if (endMatch) {
    const first = endMatch[1] ?? '';
    if (looksLikeTimecode(first)) {
      endRaw = first;
      settings = (endMatch[2] ?? '').trim();
    } else {
      // Tolerate a stray token glued to the timestamp, e.g. `00:00:04,000X`.
      const glued = /^(-?\d{1,3}(?::\d{1,2}){1,2}[.,]\d{1,3})(.*)$/.exec(first);
      if (glued) {
        endRaw = glued[1] ?? first;
        settings = `${glued[2] ?? ''} ${endMatch[2] ?? ''}`.trim();
        problems.push('结束时间后存在无法识别的字符');
      }
    }
  }

  const start = parseTimecode(startRaw);
  const end = parseTimecode(endRaw);
  if (!start) problems.push('开始时间无法识别');
  if (!end) problems.push('结束时间无法识别');
  if (start?.warning) problems.push(`开始时间：${start.warning}`);
  if (end?.warning) problems.push(`结束时间：${end.warning}`);

  return {
    raw: line,
    startMs: start ? start.ms : null,
    endMs: end ? end.ms : null,
    startRaw,
    endRaw,
    settings,
    problems,
  };
}

/** Heuristic: does this line *claim* to be a timing line? */
export function isTimingCandidate(line: string): boolean {
  if (!line.includes('-->')) return false;
  const parsed = parseTimingLine(line);
  if (!parsed) return false;
  if (parsed.startMs !== null || parsed.endMs !== null) return true;
  // Both timestamps damaged but the shape is still right: keep the cue rather
  // than silently turning it into cue text.
  return /^[\s-]*[\d:.,]+\s*-->\s*[\d:.,]+/.test(line);
}

/** Round to the nearest millisecond and clamp to a safe integer. */
export function toMillis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}
