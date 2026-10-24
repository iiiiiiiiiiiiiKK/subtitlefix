import { nextCueId } from './ids';
import { isTimingCandidate, parseTimingLine } from './timecode';
import type {
  Cue,
  Doc,
  DocSource,
  Issue,
  NewlineStyle,
  SubtitleFormat,
  VttBlock,
} from './types';
import { DEFAULT_BILINGUAL } from './types';

export interface ParseOptions {
  /** Force a format instead of auto-detecting. */
  format?: SubtitleFormat | 'auto';
  fileName?: string;
  source?: DocSource;
  /** Human title for the document. */
  title?: string;
}

export interface FormatDetection {
  format: SubtitleFormat;
  reason: string;
}

const VTT_HEADER_RE = /^\uFEFF?WEBVTT(?:[ \t].*)?$/i;
const INTEGER_RE = /^\d{1,9}$/;

export function stripBom(raw: string): { text: string; bom: boolean } {
  if (raw.charCodeAt(0) === 0xfeff) return { text: raw.slice(1), bom: true };
  return { text: raw, bom: false };
}

export function detectNewline(text: string): NewlineStyle {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const styles = [crlf > 0, cr > 0, lf > 0].filter(Boolean).length;
  if (styles > 1) return 'mixed';
  if (crlf > 0) return 'crlf';
  if (cr > 0) return 'cr';
  return 'lf';
}

/** Split on any newline convention without losing empty lines. */
export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export function detectFormat(raw: string, fileName?: string): FormatDetection {
  const { text } = stripBom(raw);
  const head = text.trimStart().slice(0, 400);
  if (VTT_HEADER_RE.test(head.split('\n')[0] ?? '')) {
    return { format: 'vtt', reason: '文件以 WEBVTT 头部开始' };
  }
  const lines = splitLines(text);
  let comma = 0;
  let dot = 0;
  for (const line of lines) {
    if (line.includes('-->')) {
      if (/\d,\d{1,3}/.test(line)) comma += 1;
      if (/\d\.\d{1,3}/.test(line)) dot += 1;
    }
    if (comma + dot > 20) break;
  }
  if (comma > 0 && comma >= dot) return { format: 'srt', reason: '时间轴使用逗号作为毫秒分隔符' };
  if (dot > 0) return { format: 'vtt', reason: '时间轴使用点号作为毫秒分隔符' };
  const lower = (fileName ?? '').toLowerCase();
  if (lower.endsWith('.vtt')) return { format: 'vtt', reason: '文件扩展名为 .vtt' };
  if (lower.endsWith('.srt')) return { format: 'srt', reason: '文件扩展名为 .srt' };
  if (/\bNOTE\b|\bSTYLE\b/.test(text)) return { format: 'vtt', reason: '包含 WebVTT 块标记' };
  return { format: 'srt', reason: '默认按 SRT 解析' };
}

interface CueDraft {
  identifier?: string;
  number: number;
  start: number;
  end: number;
  text: string;
  settings?: string;
}

/**
 * Parse SRT / WebVTT into a document.
 *
 * The parser is deliberately fault tolerant: a broken timing line never drops
 * the cue body, it only raises an issue. Cue bodies are copied verbatim so
 * punctuation, emoji, CJK spacing and manual line breaks survive a round trip.
 */
export function parseSubtitles(raw: string, options: ParseOptions = {}): Doc {
  const issues: Issue[] = [];
  const { text: noBom, bom } = stripBom(raw ?? '');
  const newline = detectNewline(noBom);
  const requested = options.format && options.format !== 'auto' ? options.format : null;
  const detection = detectFormat(noBom, options.fileName);
  const format: SubtitleFormat = requested ?? detection.format;

  if (newline === 'mixed') {
    issues.push({
      id: 'doc-mixed-newlines',
      code: 'mixed-newlines',
      severity: 'info',
      message: '文件混用了多种换行符（CRLF / LF / CR）',
      detail: '导出时统一为 LF，不会影响字幕正文。',
    });
  }
  if (bom) {
    issues.push({
      id: 'doc-bom',
      code: 'bom-detected',
      severity: 'info',
      message: '文件带有 UTF-8 BOM',
      detail: 'BOM 已在解析时移除，避免部分播放器把第一行编号读坏。',
    });
  }

  const meta = {
    bom,
    newline,
    vttHeader: '',
    vttHeaderMeta: [] as string[],
    vttBlocks: [] as VttBlock[],
    issues,
    source: (options.source ?? 'file') as DocSource,
    orphans: [] as string[],
    ...(options.fileName ? { fileName: options.fileName } : {}),
  };

  if (noBom.trim() === '') {
    issues.push({
      id: 'doc-empty',
      code: 'empty-file',
      severity: 'error',
      message: '文件内容为空',
    });
    return {
      format,
      cues: [],
      meta,
      bilingual: { ...DEFAULT_BILINGUAL },
      title: options.title ?? options.fileName ?? '空字幕',
    };
  }

  const lines = splitLines(noBom);
  let cursor = 0;

  // ---- WebVTT header ------------------------------------------------------
  if (format === 'vtt') {
    // Allow leading blank lines before the header.
    while (cursor < lines.length && (lines[cursor] ?? '').trim() === '') cursor += 1;
    const first = lines[cursor] ?? '';
    if (VTT_HEADER_RE.test(first)) {
      meta.vttHeader = first.replace(/^\uFEFF/, '');
      cursor += 1;
      const headerMeta: string[] = [];
      while (cursor < lines.length && (lines[cursor] ?? '').trim() !== '') {
        const line = lines[cursor] ?? '';
        if (isVttBlockStart(line)) break;
        headerMeta.push(line);
        cursor += 1;
      }
      meta.vttHeaderMeta = headerMeta;
    } else {
      issues.push({
        id: 'doc-missing-vtt-header',
        code: 'missing-vtt-header',
        severity: 'warning',
        message: '未找到 WEBVTT 头部，文件可能不是标准 WebVTT',
        detail: '导出时会自动补上 `WEBVTT` 头部。',
      });
    }
  }

  const drafts: CueDraft[] = [];
  let sequence = 0;

  while (cursor < lines.length) {
    const line = lines[cursor] ?? '';

    if (line.trim() === '') {
      cursor += 1;
      continue;
    }

    // ---- WebVTT NOTE / STYLE / REGION ------------------------------------
    if (format === 'vtt' && isVttBlockStart(line)) {
      const kind = vttBlockKind(line);
      const block: string[] = [line];
      cursor += 1;
      while (cursor < lines.length && (lines[cursor] ?? '').trim() !== '') {
        block.push(lines[cursor] ?? '');
        cursor += 1;
      }
      meta.vttBlocks.push({ kind, raw: block.join('\n') });
      issues.push({
        id: `doc-vtt-block-${meta.vttBlocks.length}`,
        code: 'vtt-block-preserved',
        severity: 'info',
        message: `保留了 ${kind.toUpperCase()} 块（${block.length} 行）`,
        detail: 'NOTE / STYLE / REGION 会原样写回导出文件。',
      });
      continue;
    }

    if (isTimingCandidate(line)) {
      const parsed = parseTimingLine(line)!;
      sequence += 1;
      const draft: CueDraft = {
        number: sequence,
        start: parsed.startMs ?? 0,
        end: parsed.endMs ?? 0,
        text: '',
        ...(parsed.settings ? { settings: parsed.settings } : {}),
      };
      if (parsed.problems.length > 0) {
        issues.push({
          id: `cue-${sequence}-timing`,
          code: 'malformed-timing',
          severity: 'error',
          message: `第 ${sequence} 条字幕的时间轴格式异常`,
          detail: `${parsed.problems.join('；')}｜原始行：${parsed.raw.trim()}`,
          cueNumber: sequence,
          cuePosition: drafts.length + 1,
          fix: parsed.startMs !== null && parsed.endMs !== null ? 'swap-times' : undefined,
          fixLabel: parsed.startMs !== null && parsed.endMs !== null ? '交换开始/结束时间' : undefined,
        });
      }
      if (format === 'srt' && parsed.settings) {
        issues.push({
          id: `cue-${sequence}-settings`,
          code: 'settings-in-srt',
          severity: 'info',
          message: `第 ${sequence} 条字幕带 WebVTT 设置，SRT 不支持`,
          detail: parsed.settings,
          cueNumber: sequence,
          cuePosition: drafts.length + 1,
        });
      }
      cursor += 1;
      const textLines = readCueBody(lines, cursor, format);
      draft.text = textLines.lines.join('\n');
      cursor = textLines.next;
      if (textLines.hadBlankSeparatorLoss) {
        issues.push({
          id: `cue-${sequence}-sep`,
          code: 'missing-blank-separator',
          severity: 'warning',
          message: `第 ${sequence} 条字幕与下一条之间缺少空行`,
          detail: '已按时间轴行自动切分，建议导出后由播放器确认。',
          cueNumber: sequence,
          cuePosition: drafts.length + 1,
        });
      }
      drafts.push(draft);
      continue;
    }

    // A bare integer that is followed by a timing line is an SRT index.
    const next = nextNonEmpty(lines, cursor + 1);
    if (INTEGER_RE.test(line.trim()) && next !== -1 && isTimingCandidate(lines[next] ?? '')) {
      const number = Number(line.trim());
      const timingLine = lines[next] ?? '';
      const parsed = parseTimingLine(timingLine)!;
      sequence += 1;
      if (number !== sequence) {
        issues.push({
          id: `cue-${sequence}-index`,
          code: 'number-sequence',
          severity: 'warning',
          message: `第 ${sequence} 条字幕的编号为 ${number}，序号不连续`,
          detail: '编号可以在左侧列表中直接编辑，或使用「重排编号」批量修复。',
          cueNumber: number,
          cuePosition: drafts.length + 1,
          fix: 'renumber',
          fixLabel: '按顺序重排编号',
        });
      }
      if (parsed.problems.length > 0) {
        issues.push({
          id: `cue-${sequence}-timing`,
          code: 'malformed-timing',
          severity: 'error',
          message: `第 ${sequence} 条字幕的时间轴格式异常`,
          detail: `${parsed.problems.join('；')}｜原始行：${parsed.raw.trim()}`,
          cueNumber: number,
          cuePosition: drafts.length + 1,
        });
      }
      const draft: CueDraft = {
        number,
        start: parsed.startMs ?? 0,
        end: parsed.endMs ?? 0,
        text: '',
        ...(parsed.settings ? { settings: parsed.settings } : {}),
      };
      cursor = next + 1;
      const textLines = readCueBody(lines, cursor, format);
      draft.text = textLines.lines.join('\n');
      cursor = textLines.next;
      if (textLines.hadBlankSeparatorLoss) {
        issues.push({
          id: `cue-${sequence}-sep`,
          code: 'missing-blank-separator',
          severity: 'warning',
          message: `第 ${sequence} 条字幕与下一条之间缺少空行`,
          detail: '已按时间轴行自动切分。',
          cueNumber: number,
          cuePosition: drafts.length + 1,
        });
      }
      drafts.push(draft);
      continue;
    }

    // ---- Orphan text ------------------------------------------------------
    const orphan: string[] = [line];
    cursor += 1;
    while (cursor < lines.length) {
      const peek = lines[cursor] ?? '';
      if (peek.trim() === '') break;
      if (isTimingCandidate(peek)) break;
      if (
        INTEGER_RE.test(peek.trim()) &&
        nextNonEmpty(lines, cursor + 1) !== -1 &&
        isTimingCandidate(lines[nextNonEmpty(lines, cursor + 1)] ?? '')
      ) {
        break;
      }
      orphan.push(peek);
      cursor += 1;
    }
    if (drafts.length > 0) {
      const previous = drafts[drafts.length - 1]!;
      previous.text = previous.text === '' ? orphan.join('\n') : `${previous.text}\n${orphan.join('\n')}`;
      issues.push({
        id: `doc-orphan-${drafts.length}`,
        code: 'orphan-text-merged',
        severity: 'warning',
        message: `第 ${drafts.length} 条字幕之后有 ${orphan.length} 行无法归属的文本`,
        detail: `已并入第 ${drafts.length} 条字幕正文，避免静默丢字：${truncate(orphan.join(' / '), 80)}`,
        cueNumber: previous.number,
        cuePosition: drafts.length,
      });
    } else {
      meta.orphans.push(...orphan);
      issues.push({
        id: 'doc-orphan-unattached',
        code: 'orphan-text-unattached',
        severity: 'error',
        message: `有 ${orphan.length} 行文本不属于任何字幕`,
        detail: truncate(orphan.join(' / '), 120),
        fix: 'merge-orphans',
        fixLabel: '并入最后一条字幕',
      });
    }
  }

  if (drafts.length === 0) {
    issues.push({
      id: 'doc-no-cues',
      code: 'fatal',
      severity: 'error',
      message: '未找到任何字幕条目',
      detail:
        meta.orphans.length > 0
          ? `文件中有 ${meta.orphans.length} 行文本，但没有任何时间轴行（形如 \`00:00:01,000 --> 00:00:03,000\`）。请确认这是字幕文件而不是纯文本。`
          : '需要至少一行形如 `00:00:01,000 --> 00:00:03,000` 的时间轴。',
    });
  }

  // Drop a trailing empty cue produced by a dangling index line.
  const cues: Cue[] = drafts.map((draft) => ({
    id: nextCueId(),
    number: draft.number,
    start: draft.start,
    end: draft.end,
    text: normalizeCueText(draft.text),
    ...(draft.settings ? { settings: draft.settings } : {}),
    ...(draft.identifier ? { identifier: draft.identifier } : {}),
  }));

  if (format === 'vtt' && meta.vttHeader === '') {
    meta.vttHeader = 'WEBVTT';
  }

  const title =
    options.title ?? (options.fileName ? stripExtension(options.fileName) : `粘贴的字幕（${format.toUpperCase()}）`);

  return {
    format,
    cues,
    meta,
    bilingual: { ...DEFAULT_BILINGUAL },
    title,
  };
}

interface BodyRead {
  lines: string[];
  next: number;
  hadBlankSeparatorLoss: boolean;
}

/**
 * Read cue body lines starting at `start`.
 * Stops at a blank line, at the next timing line, or at an `index + timing`
 * pair. A missing blank separator is reported but never truncated.
 */
function readCueBody(lines: string[], start: number, format: SubtitleFormat): BodyRead {
  const body: string[] = [];
  let cursor = start;
  let loss = false;

  while (cursor < lines.length) {
    const line = lines[cursor] ?? '';
    if (line.trim() === '') {
      cursor += 1;
      // Collapse consecutive blank lines, but stop once a new cue begins.
      const peek = nextNonEmpty(lines, cursor);
      if (peek === -1) break;
      const peekLine = lines[peek] ?? '';
      const startsCue =
        isTimingCandidate(peekLine) ||
        (INTEGER_RE.test(peekLine.trim()) &&
          nextNonEmpty(lines, peek + 1) !== -1 &&
          isTimingCandidate(lines[nextNonEmpty(lines, peek + 1)] ?? '')) ||
        (format === 'vtt' && isVttBlockStart(peekLine));
      if (startsCue) break;
      body.push('');
      continue;
    }
    if (isTimingCandidate(line)) {
      loss = true;
      break;
    }
    const peek = nextNonEmpty(lines, cursor + 1);
    if (
      INTEGER_RE.test(line.trim()) &&
      peek !== -1 &&
      isTimingCandidate(lines[peek] ?? '')
    ) {
      loss = true;
      break;
    }
    if (format === 'vtt' && isVttBlockStart(line)) break;
    body.push(line);
    cursor += 1;
  }

  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  return { lines: body, next: cursor, hadBlankSeparatorLoss: loss };
}

function nextNonEmpty(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() !== '') return i;
  }
  return -1;
}

function isVttBlockStart(line: string): boolean {
  return /^(NOTE|STYLE|REGION)(\s|$)/.test(line.trim());
}

function vttBlockKind(line: string): VttBlock['kind'] {
  const trimmed = line.trim();
  if (trimmed.startsWith('NOTE')) return 'note';
  if (trimmed.startsWith('STYLE')) return 'style';
  return 'region';
}

/** Keep cue bodies verbatim; only normalise line endings and drop edge blank lines. */
export function normalizeCueText(text: string): string {
  const lines = splitLines(text);
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.join('\n');
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.(srt|vtt|txt|sbv|ass|ssa)$/i, '');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
