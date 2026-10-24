import { parseTimecode } from '../core/timecode';

export interface UserTimeParse {
  ok: boolean;
  ms: number;
  error?: string;
}

/**
 * Parse what a human actually types into a time field.
 *
 * Accepted: `00:00:01,250`, `00:00:01.250`, `0:01,250`, `1:02.5`, `62.5`,
 * `62500` (plain milliseconds), `+1.5s` / `-250ms` relative to `baseMs`.
 */
export function parseUserTime(input: string, baseMs = 0, allowRelative = true): UserTimeParse {
  const raw = input.trim();
  if (raw === '') return { ok: false, ms: baseMs, error: '不能为空' };

  if (allowRelative) {
    const relative = /^([+-])\s*([\d.]+)\s*(ms|s|m)?$/i.exec(raw);
    if (relative) {
      const sign = relative[1] === '-' ? -1 : 1;
      const value = Number(relative[2]);
      if (Number.isNaN(value)) return { ok: false, ms: baseMs, error: '无法识别的数字' };
      const unit = (relative[3] ?? 'ms').toLowerCase();
      const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60_000 : 1;
      return { ok: true, ms: Math.round(baseMs + sign * value * multiplier) };
    }
  }

  const parsed = parseTimecode(raw);
  if (parsed) return { ok: true, ms: parsed.ms };

  // Plain seconds: `1.5` or `12`.
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return { ok: true, ms: Math.round(Number(raw) * 1000) };
  }

  return { ok: false, ms: baseMs, error: '格式应为 00:00:01,000 或 1.5（秒）' };
}

export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
