/**
 * Shared domain types for SubtitleFix.
 *
 * Everything here is plain data so it can be structured-cloned to a Web Worker
 * and snapshotted for undo/redo without special handling.
 */

export type SubtitleFormat = 'srt' | 'vtt';

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCode =
  // document level
  | 'fatal'
  | 'empty-file'
  | 'unsupported-format'
  | 'missing-vtt-header'
  | 'vtt-block-preserved'
  | 'bom-detected'
  | 'mixed-newlines'
  | 'orphan-text-merged'
  | 'orphan-text-unattached'
  | 'missing-blank-separator'
  | 'index-mismatch'
  // cue level
  | 'malformed-timing'
  | 'missing-index'
  | 'invalid-index'
  | 'start-after-end'
  | 'negative-time'
  | 'overlap'
  | 'out-of-order'
  | 'empty-text'
  | 'duplicate-number'
  | 'number-sequence'
  | 'too-short'
  | 'arrow-in-text'
  | 'settings-in-srt'
  | 'ass-tags';

/** Repairs the UI can apply to a single cue or to the whole document. */
export type FixId =
  | 'swap-times'
  | 'clamp-negative'
  | 'delete-empty'
  | 'renumber'
  | 'trim-overlap'
  | 'shift-all-positive'
  | 'min-duration'
  | 'sort-by-start'
  | 'merge-orphans';

export interface Cue {
  /** Stable internal id used for selection, undo and React keys. */
  id: string;
  /** 1-based number written to the file (SRT index / VTT cue identifier). */
  number: number;
  /** Start time in milliseconds. May be negative while editing. */
  start: number;
  /** End time in milliseconds. */
  end: number;
  /** Primary cue body. Newlines are `\n`; empty string means an empty cue. */
  text: string;
  /** Optional second-language body produced by the bilingual merge. */
  secondary?: string;
  /** WebVTT cue settings, e.g. `align:start position:10%`. */
  settings?: string;
  /** WebVTT cue identifier (kept verbatim when it is not a plain number). */
  identifier?: string;
}

export interface Issue {
  /** Deterministic id: safe as a React key and stable across recomputation. */
  id: string;
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  detail?: string;
  cueId?: string;
  cueNumber?: number;
  /** 1-based position in the cue list. */
  cuePosition?: number;
  fix?: FixId;
  fixLabel?: string;
}

export interface VttBlock {
  kind: 'note' | 'style' | 'region';
  raw: string;
}

export type NewlineStyle = 'lf' | 'crlf' | 'cr' | 'mixed';

export type DocSource = 'empty' | 'file' | 'paste' | 'sample' | 'merge';

export interface DocMeta {
  fileName?: string;
  bom: boolean;
  newline: NewlineStyle;
  /** Raw `WEBVTT ...` header line for VTT documents. */
  vttHeader: string;
  /** Lines between the header and the first cue (VTT header metadata). */
  vttHeaderMeta: string[];
  /** NOTE / STYLE / REGION blocks, preserved verbatim and re-emitted on export. */
  vttBlocks: VttBlock[];
  /** Parsing diagnostics. Recomputed validation issues live separately. */
  issues: Issue[];
  source: DocSource;
  /** Unattached text that could not be associated with any cue. */
  orphans: string[];
}

export interface BilingualLayout {
  enabled: boolean;
  order: 'primary-first' | 'secondary-first';
  separator: '\n' | ' / ' | ' — ';
}

export interface Doc {
  format: SubtitleFormat;
  cues: Cue[];
  meta: DocMeta;
  bilingual: BilingualLayout;
  /** Human readable document title, shown in the top bar. */
  title: string;
}

export const DEFAULT_BILINGUAL: BilingualLayout = {
  enabled: true,
  order: 'primary-first',
  separator: '\n',
};

export function emptyMeta(source: DocSource = 'empty'): DocMeta {
  return {
    bom: false,
    newline: 'lf',
    vttHeader: '',
    vttHeaderMeta: [],
    vttBlocks: [],
    issues: [],
    source,
    orphans: [],
  };
}

export function createEmptyDoc(): Doc {
  return {
    format: 'srt',
    cues: [],
    meta: emptyMeta('empty'),
    bilingual: { ...DEFAULT_BILINGUAL },
    title: '未命名字幕',
  };
}
