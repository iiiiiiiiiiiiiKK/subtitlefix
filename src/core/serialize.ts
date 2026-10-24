import { formatTimecode } from './timecode';
import type { Cue, Doc, NewlineStyle, SubtitleFormat } from './types';

export interface SerializeOptions {
  format?: SubtitleFormat;
  newline?: '\n' | '\r\n';
  /** Add a UTF-8 BOM to the output (some legacy players require it). */
  bom?: boolean;
  /** Keep WebVTT NOTE/STYLE/REGION blocks (only meaningful for VTT output). */
  keepVttBlocks?: boolean;
  /** Keep cue settings when exporting VTT. */
  keepSettings?: boolean;
  /** Emit `HH:MM:SS.mmm` (VTT style) or `HH:MM:SS,mmm` (SRT style). */
  timecodeStyle?: SubtitleFormat;
  /** Merge the bilingual secondary body into the cue text. */
  includeSecondary?: boolean;
}

const DEFAULT_OPTIONS: Required<Omit<SerializeOptions, 'newline' | 'bom' | 'timecodeStyle'>> = {
  format: 'srt',
  keepVttBlocks: true,
  keepSettings: true,
  includeSecondary: true,
};

/**
 * Serialise the document back to SRT or WebVTT text.
 *
 * Notes on deliberate behaviour:
 * - Cue bodies are written verbatim (only `\n` -> target newline), so trailing
 *   spaces, tags and CJK punctuation survive.
 * - SRT output never contains WebVTT cue settings; they are dropped with a
 *   warning raised by the validator, not silently here.
 * - VTT output always starts with a `WEBVTT` header; the original header text
 *   is reused when available.
 */
export function serializeSubtitles(doc: Doc, options: SerializeOptions = {}): string {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  const format = options.format ?? doc.format;
  const newline = options.newline ?? (doc.meta.newline === 'crlf' ? '\r\n' : '\n');
  const timecodeStyle = options.timecodeStyle ?? format;

  const blocks: string[] = [];

  if (format === 'vtt') {
    const header = doc.meta.vttHeader?.trim() ? doc.meta.vttHeader.trim() : 'WEBVTT';
    blocks.push([header, ...(doc.meta.vttHeaderMeta ?? [])].join('\n'));
    if (merged.keepVttBlocks && doc.meta.vttBlocks.length > 0) {
      for (const block of doc.meta.vttBlocks) blocks.push(block.raw);
    }
  } else if (doc.meta.vttBlocks.length > 0) {
    // SRT cannot carry NOTE/STYLE/REGION: convert them to SRT-safe text so the
    // information is not silently destroyed.
    const converted = doc.meta.vttBlocks
      .map((block) => block.raw.split('\n').map((line) => `# ${line}`).join('\n'))
      .join('\n');
    blocks.push(converted);
  }

  for (const cue of doc.cues) {
    const text = cueText(cue, merged.includeSecondary, doc);
    const lines: string[] = [];

    if (format === 'srt') {
      lines.push(String(cue.number));
      lines.push(
        `${formatTimecode(cue.start, timecodeStyle)} --> ${formatTimecode(cue.end, timecodeStyle)}`,
      );
      lines.push(text);
    } else {
      if (cue.identifier && !/^\d+$/.test(cue.identifier)) {
        lines.push(cue.identifier);
      }
      const settings =
        merged.keepSettings && cue.settings && format === 'vtt' ? ` ${cue.settings}` : '';
      lines.push(
        `${formatTimecode(cue.start, timecodeStyle)} --> ${formatTimecode(cue.end, timecodeStyle)}${settings}`,
      );
      if (text !== '') lines.push(text);
    }
    blocks.push(lines.join('\n'));
  }

  let output = blocks.join('\n\n');
  if (output.length > 0 && !output.endsWith('\n')) output += '\n';
  if (newline !== '\n') output = output.replace(/\n/g, newline);
  if (options.bom) output = `\uFEFF${output}`;
  return output;
}

export function cueText(cue: Cue, includeSecondary: boolean, doc: Doc): string {
  const primary = cue.text ?? '';
  const secondary = includeSecondary ? cue.secondary ?? '' : '';
  if (secondary === '') return primary;
  if (primary === '') return secondary;

  const { order, separator } = doc.bilingual;
  const first = order === 'primary-first' ? primary : secondary;
  const second = order === 'primary-first' ? secondary : primary;

  if (separator === '\n') return `${first}\n${second}`;
  return first
    .split('\n')
    .map((line, index) => {
      const other = second.split('\n')[index] ?? second;
      return `${line}${separator}${other}`;
    })
    .join('\n');
}

export function suggestedFileName(doc: Doc, format: SubtitleFormat): string {
  const base = (doc.meta.fileName ?? doc.title ?? 'subtitles')
    .replace(/\.(srt|vtt|txt|sbv|ass|ssa)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim();
  const safe = base === '' ? 'subtitles' : base;
  const suffix = doc.bilingual.enabled && doc.cues.some((cue) => cue.secondary) ? '.bilingual' : '';
  return `${safe}${suffix}.${format}`;
}

export function newlineFor(style: NewlineStyle): '\n' | '\r\n' {
  return style === 'crlf' ? '\r\n' : '\n';
}
