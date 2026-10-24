import { describe, expect, it } from 'vitest';
import { formatTimecode, parseTimecode, parseTimingLine, formatDuration } from '../src/core/timecode';

describe('parseTimecode', () => {
  it('parses SRT comma timestamps', () => {
    expect(parseTimecode('00:01:02,500')?.ms).toBe(62_500);
  });

  it('parses WebVTT dot timestamps', () => {
    expect(parseTimecode('00:01:02.500')?.ms).toBe(62_500);
  });

  it('parses short MM:SS form', () => {
    expect(parseTimecode('01:02.250')?.ms).toBe(62_250);
  });

  it('parses 1 and 2 digit fractions', () => {
    expect(parseTimecode('00:00:01,5')?.ms).toBe(1500);
    expect(parseTimecode('00:00:01,05')?.ms).toBe(1050);
  });

  it('parses negative timestamps', () => {
    const parsed = parseTimecode('-00:00:01,000');
    expect(parsed?.ms).toBe(-1000);
    expect(parsed?.negative).toBe(true);
  });

  it('flags out-of-range seconds instead of failing', () => {
    const parsed = parseTimecode('00:00:75,000');
    expect(parsed?.ms).toBe(75_000);
    expect(parsed?.warning).toBeTruthy();
  });

  it('rejects garbage', () => {
    expect(parseTimecode('nope')).toBeNull();
    expect(parseTimecode('00:00')).toBeNull();
    expect(parseTimecode('')).toBeNull();
  });
});

describe('formatTimecode', () => {
  it('formats SRT with comma', () => {
    expect(formatTimecode(62_500, 'srt')).toBe('00:01:02,500');
  });

  it('formats VTT with dot', () => {
    expect(formatTimecode(62_500, 'vtt')).toBe('00:01:02.500');
  });

  it('keeps a minus sign for negative values', () => {
    expect(formatTimecode(-1500, 'srt')).toBe('-00:00:01,500');
  });

  it('rounds to the nearest millisecond', () => {
    expect(formatTimecode(1499.6, 'srt')).toBe('00:00:01,500');
  });

  it('handles hours beyond 99', () => {
    expect(formatTimecode(3600_000 * 120, 'srt')).toBe('120:00:00,000');
  });

  it('round trips through parseTimecode', () => {
    for (const ms of [0, 1, 999, 1000, 61_000, 3_599_999, 7_200_000]) {
      expect(parseTimecode(formatTimecode(ms, 'vtt'))?.ms).toBe(ms);
    }
  });
});

describe('formatDuration', () => {
  it('renders sub-second values in ms', () => {
    expect(formatDuration(320)).toBe('320ms');
  });
  it('renders seconds', () => {
    expect(formatDuration(2500)).toBe('2.5s');
  });
  it('renders minutes', () => {
    expect(formatDuration(123_000)).toBe('2m 03s');
  });
});

describe('parseTimingLine', () => {
  it('parses a clean line', () => {
    const parsed = parseTimingLine('00:00:01,000 --> 00:00:03,000');
    expect(parsed?.startMs).toBe(1000);
    expect(parsed?.endMs).toBe(3000);
    expect(parsed?.problems).toHaveLength(0);
  });

  it('extracts WebVTT settings', () => {
    const parsed = parseTimingLine('00:00:01.000 --> 00:00:03.000 align:start position:10%');
    expect(parsed?.settings).toBe('align:start position:10%');
  });

  it('reports damaged timestamps without discarding the line', () => {
    const parsed = parseTimingLine('00:00:0X,000 --> 00:00:03,000');
    expect(parsed).not.toBeNull();
    expect(parsed?.startMs).toBeNull();
    expect(parsed?.problems.join(' ')).toContain('开始时间无法识别');
  });

  it('returns null when there is no arrow', () => {
    expect(parseTimingLine('just text')).toBeNull();
  });

  it('tolerates leading junk before the start time', () => {
    const parsed = parseTimingLine('junk 00:00:01,000 --> 00:00:03,000');
    expect(parsed?.startMs).toBe(1000);
    expect(parsed?.problems.join(' ')).toContain('多余字符');
  });
});
