import { useCallback, useMemo, useReducer, useRef } from 'react';
import { mergeBilingual, setSecondary, type MergeOptions } from '../core/bilingual';
import { diffDocs, type DocDiff } from '../core/diff';
import { nextCueId } from '../core/ids';
import {
  applyFix,
  applyReplacePlan,
  deleteCues,
  deleteEmptyCues,
  mergeCues,
  normalizeStart,
  renumber,
  shiftTimeline,
  sortByStart,
  splitCue,
  trimOverlaps,
  enforceMinDuration,
  updateCue,
  type ReplacePlan,
} from '../core/ops';
import { parseSubtitles, type ParseOptions } from '../core/parse';
import { serializeSubtitles } from '../core/serialize';
import { createEmptyDoc, type BilingualLayout, type Cue, type Doc, type FixId, type SubtitleFormat } from '../core/types';
import { summarizeIssues, validateDoc, type IssueSummary } from '../core/validate';

export interface Toast {
  id: number;
  tone: 'ok' | 'warn' | 'error' | 'info';
  message: string;
}

export interface HistoryEntry {
  label: string;
  doc: Doc;
  /** Cue that was active when the snapshot was taken. */
  activeCueId: string | null;
  at: number;
}

interface State {
  doc: Doc;
  /** Snapshot used as the diff baseline (the document as imported/last saved). */
  baseline: Doc;
  activeCueId: string | null;
  selectedIds: string[];
  history: HistoryEntry[];
  historyIndex: number;
  toasts: Toast[];
  /** Bumped whenever the document changes, used to avoid stale diffs. */
  revision: number;
}

type Action =
  | { type: 'load'; doc: Doc; label: string }
  | { type: 'mutate'; doc: Doc; label: string; mergeKey?: string; activeCueId?: string | null }
  | { type: 'setActive'; cueId: string | null }
  | { type: 'select'; ids: string[] }
  | { type: 'toggleSelect'; cueId: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'toast'; toast: Omit<Toast, 'id'> }
  | { type: 'dismissToast'; id: number }
  | { type: 'resetBaseline' };

const MAX_HISTORY = 120;
const MERGE_WINDOW_MS = 900;

let toastSeq = 0;

function pushHistory(state: State, entry: HistoryEntry): Pick<State, 'history' | 'historyIndex'> {
  const truncated = state.history.slice(0, state.historyIndex + 1);
  truncated.push(entry);
  while (truncated.length > MAX_HISTORY) truncated.shift();
  return { history: truncated, historyIndex: truncated.length - 1 };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'load': {
      const entry: HistoryEntry = {
        label: action.label,
        doc: action.doc,
        activeCueId: action.doc.cues[0]?.id ?? null,
        at: Date.now(),
      };
      return {
        ...state,
        doc: action.doc,
        baseline: action.doc,
        activeCueId: entry.activeCueId,
        selectedIds: [],
        history: [entry],
        historyIndex: 0,
        revision: state.revision + 1,
      };
    }
    case 'mutate': {
      if (action.doc === state.doc) return state;
      const now = Date.now();
      const top = state.history[state.historyIndex];
      const canMerge =
        action.mergeKey !== undefined &&
        top !== undefined &&
        state.historyIndex === state.history.length - 1 &&
        now - top.at < MERGE_WINDOW_MS &&
        top.label === action.label;

      if (canMerge && top) {
        const history = [...state.history];
        history[state.historyIndex] = { ...top, doc: action.doc, at: now };
        return {
          ...state,
          doc: action.doc,
          history,
          activeCueId: action.activeCueId === undefined ? state.activeCueId : action.activeCueId,
          revision: state.revision + 1,
        };
      }

      const entry: HistoryEntry = {
        label: action.label,
        doc: action.doc,
        activeCueId: action.activeCueId === undefined ? state.activeCueId : action.activeCueId,
        at: now,
      };
      return {
        ...state,
        doc: action.doc,
        activeCueId: entry.activeCueId,
        ...pushHistory(state, entry),
        revision: state.revision + 1,
      };
    }
    case 'setActive':
      return { ...state, activeCueId: action.cueId };
    case 'select':
      return { ...state, selectedIds: action.ids };
    case 'toggleSelect': {
      const exists = state.selectedIds.includes(action.cueId);
      return {
        ...state,
        selectedIds: exists
          ? state.selectedIds.filter((id) => id !== action.cueId)
          : [...state.selectedIds, action.cueId],
        activeCueId: action.cueId,
      };
    }
    case 'undo': {
      if (state.historyIndex <= 0) return state;
      const index = state.historyIndex - 1;
      const entry = state.history[index]!;
      return {
        ...state,
        doc: entry.doc,
        activeCueId: entry.activeCueId,
        historyIndex: index,
        revision: state.revision + 1,
      };
    }
    case 'redo': {
      if (state.historyIndex >= state.history.length - 1) return state;
      const index = state.historyIndex + 1;
      const entry = state.history[index]!;
      return {
        ...state,
        doc: entry.doc,
        activeCueId: entry.activeCueId,
        historyIndex: index,
        revision: state.revision + 1,
      };
    }
    case 'toast': {
      toastSeq += 1;
      const toast: Toast = { ...action.toast, id: toastSeq };
      return { ...state, toasts: [...state.toasts, toast].slice(-4) };
    }
    case 'dismissToast':
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };
    case 'resetBaseline':
      return { ...state, baseline: state.doc };
    default:
      return state;
  }
}

function initialState(): State {
  const doc = createEmptyDoc();
  return {
    doc,
    baseline: doc,
    activeCueId: null,
    selectedIds: [],
    history: [],
    historyIndex: -1,
    toasts: [],
    revision: 0,
  };
}

export interface SubtitleStore {
  doc: Doc;
  baseline: Doc;
  activeCueId: string | null;
  activeCue: Cue | null;
  activeIndex: number;
  selectedIds: string[];
  historyIndex: number;
  historyLength: number;
  historyLabels: string[];
  canUndo: boolean;
  canRedo: boolean;
  toasts: Toast[];
  issues: ReturnType<typeof validateDoc>;
  summary: IssueSummary;
  diff: DocDiff;
  dirty: boolean;

  loadFromText: (text: string, options?: ParseOptions) => void;
  /** Install a document that was already parsed (e.g. by the Web Worker). */
  applyParsedDoc: (doc: Doc, fileName?: string) => void;
  /** Replace the current doc through the history stack (used by "一键修复"). */
  replaceDoc: (doc: Doc, label: string) => void;
  renameDoc: (title: string) => void;
  insertCue: (start: number, end: number) => string | null;
  pasteText: (text: string, title?: string) => void;
  setActive: (cueId: string | null) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (cueId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  editCue: (cueId: string, patch: Partial<Omit<Cue, 'id'>>, mergeKey?: string) => void;
  shift: (deltaMs: number, options?: { cueIds?: string[]; clampAtZero?: boolean }) => void;
  normalizeToZero: () => void;
  split: (cueId: string, atMs: number) => boolean;
  merge: (cueIds: string[]) => boolean;
  remove: (cueIds: string[]) => void;
  removeEmpty: () => void;
  applyFixAction: (fix: FixId, cueId?: string) => void;
  runRenumber: () => void;
  runSort: () => void;
  runTrimOverlaps: () => void;
  runMinDuration: (ms?: number) => void;
  replace: (plan: ReplacePlan) => void;
  setFormat: (format: SubtitleFormat) => void;
  setBilingual: (patch: Partial<BilingualLayout>) => void;
  setSecondaryText: (cueId: string, text: string) => void;
  mergeSecondDocument: (secondary: Doc, options?: MergeOptions) => void;
  undo: () => void;
  redo: () => void;
  toast: (tone: Toast['tone'], message: string) => void;
  dismissToast: (id: number) => void;
  markSaved: () => void;
  exportText: (format: SubtitleFormat, newline?: '\n' | '\r\n', bom?: boolean) => string;
}

export function useSubtitleStore(): SubtitleStore {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const issues = useMemo(() => validateDoc(state.doc), [state.doc]);
  const summary = useMemo(() => summarizeIssues(issues), [issues]);
  const diff = useMemo(() => diffDocs(state.baseline, state.doc), [state.baseline, state.doc]);

  const activeIndex = state.activeCueId
    ? state.doc.cues.findIndex((cue) => cue.id === state.activeCueId)
    : -1;

  const toast = useCallback((tone: Toast['tone'], message: string) => {
    dispatch({ type: 'toast', toast: { tone, message } });
  }, []);

  const mutate = useCallback(
    (doc: Doc, label: string, options: { mergeKey?: string; activeCueId?: string | null } = {}) => {
      dispatch({ type: 'mutate', doc, label, ...options });
    },
    [],
  );

  const loadFromText = useCallback(
    (text: string, options: ParseOptions = {}) => {
      const doc = parseSubtitles(text, options);
      dispatch({
        type: 'load',
        doc,
        label: options.fileName ? `导入 ${options.fileName}` : '导入字幕',
      });
      const errors = doc.meta.issues.filter((issue) => issue.severity === 'error').length;
      if (doc.cues.length === 0) {
        toast('error', '没有解析到任何字幕，请检查文件格式');
      } else if (errors > 0) {
        toast('warn', `已导入 ${doc.cues.length} 条字幕，发现 ${errors} 个需要处理的问题`);
      } else {
        toast('ok', `已导入 ${doc.cues.length} 条字幕`);
      }
    },
    [toast],
  );

  const pasteText = useCallback(
    (text: string, title?: string) => {
      const doc = parseSubtitles(text, { source: 'paste', ...(title ? { title } : {}) });
      dispatch({ type: 'load', doc, label: '粘贴文本' });
      if (doc.cues.length === 0) toast('error', '粘贴的文本里没有可识别的字幕');
      else toast('ok', `已解析 ${doc.cues.length} 条字幕`);
    },
    [toast],
  );

  const editCue = useCallback(
    (cueId: string, patch: Partial<Omit<Cue, 'id'>>, mergeKey?: string) => {
      const current = stateRef.current.doc;
      mutate(updateCue(current, cueId, patch), '编辑字幕', {
        ...(mergeKey ? { mergeKey } : {}),
        activeCueId: cueId,
      });
    },
    [mutate],
  );

  const shift = useCallback(
    (deltaMs: number, options: { cueIds?: string[]; clampAtZero?: boolean } = {}) => {
      const current = stateRef.current.doc;
      const result = shiftTimeline(current, deltaMs, options);
      if (result.changed === 0) {
        toast('info', '没有可平移的字幕');
        return;
      }
      mutate(result.doc, `平移 ${deltaMs > 0 ? '+' : ''}${deltaMs}ms`);
      const direction = deltaMs > 0 ? '延后' : '提前';
      toast(
        result.clamped > 0 ? 'warn' : 'ok',
        `已${direction} ${result.changed} 条字幕（${Math.abs(deltaMs)}ms）${
          result.clamped > 0 ? `，其中 ${result.clamped} 个时间点已限制在 0` : ''
        }`,
      );
    },
    [mutate, toast],
  );

  const normalizeToZero = useCallback(() => {
    const result = normalizeStart(stateRef.current.doc);
    if (result.changed === 0) {
      toast('info', '字幕已经从头开始');
      return;
    }
    mutate(result.doc, '对齐到 00:00');
    toast('ok', '已把最早的字幕对齐到 00:00:00.000');
  }, [mutate, toast]);

  const split = useCallback(
    (cueId: string, atMs: number) => {
      const result = splitCue(stateRef.current.doc, cueId, atMs);
      if (!result.newCueId) {
        toast('error', result.error ?? '拆分失败');
        return false;
      }
      mutate(result.doc, '拆分字幕', { activeCueId: result.newCueId });
      toast('ok', '已拆分为两条字幕');
      return true;
    },
    [mutate, toast],
  );

  const merge = useCallback(
    (cueIds: string[]) => {
      const result = mergeCues(stateRef.current.doc, cueIds);
      if (!result.mergedCueId) {
        toast('error', result.error ?? '合并失败');
        return false;
      }
      dispatch({ type: 'select', ids: [] });
      mutate(result.doc, '合并字幕', { activeCueId: result.mergedCueId });
      toast('ok', '已合并所选字幕');
      return true;
    },
    [mutate, toast],
  );

  const remove = useCallback(
    (cueIds: string[]) => {
      const current = stateRef.current.doc;
      const next = deleteCues(current, cueIds);
      if (next === current || next.cues.length === current.cues.length) {
        toast('info', '没有可删除的字幕');
        return;
      }
      const removed = current.cues.length - next.cues.length;
      const nextActive = next.cues[Math.max(0, Math.min(activeIndex, next.cues.length - 1))]?.id ?? null;
      mutate(next, `删除 ${removed} 条字幕`, { activeCueId: nextActive });
      dispatch({ type: 'select', ids: [] });
      toast('ok', `已删除 ${removed} 条字幕（可撤销）`);
    },
    [activeIndex, mutate, toast],
  );

  const removeEmpty = useCallback(() => {
    const current = stateRef.current.doc;
    const { doc: next, removed } = deleteEmptyCues(current);
    if (removed === 0) {
      toast('info', '没有空字幕');
      return;
    }
    mutate(next, `删除 ${removed} 条空字幕`);
    toast('ok', `已删除 ${removed} 条空字幕（可撤销）`);
  }, [mutate, toast]);

  const applyFixAction = useCallback(
    (fix: FixId, cueId?: string) => {
      const outcome = applyFix(stateRef.current.doc, fix, cueId);
      if (outcome.doc !== stateRef.current.doc) {
        mutate(outcome.doc, outcome.message);
      }
      toast(outcome.doc === stateRef.current.doc ? 'info' : 'ok', outcome.message);
    },
    [mutate, toast],
  );

  const runRenumber = useCallback(() => {
    const next = renumber(stateRef.current.doc);
    if (next === stateRef.current.doc) {
      toast('info', '编号已经是连续的');
      return;
    }
    mutate(next, '重排编号');
    toast('ok', '已按顺序重排编号');
  }, [mutate, toast]);

  const runSort = useCallback(() => {
    const next = sortByStart(stateRef.current.doc);
    mutate(next, '按时间排序');
    toast('ok', '已按开始时间排序');
  }, [mutate, toast]);

  const runTrimOverlaps = useCallback(() => {
    const { doc: next, trimmed } = trimOverlaps(stateRef.current.doc);
    if (trimmed === 0) {
      toast('info', '没有时间重叠');
      return;
    }
    mutate(next, '裁掉重叠');
    toast('ok', `已裁掉 ${trimmed} 处重叠（正文未改动）`);
  }, [mutate, toast]);

  const runMinDuration = useCallback(
    (ms = 500) => {
      const { doc: next, adjusted } = enforceMinDuration(stateRef.current.doc, ms);
      if (adjusted === 0) {
        toast('info', '没有过短的字幕');
        return;
      }
      mutate(next, '延长过短字幕');
      toast('ok', `已延长 ${adjusted} 条字幕到至少 ${ms}ms`);
    },
    [mutate, toast],
  );

  const replace = useCallback(
    (plan: ReplacePlan) => {
      if (plan.items.length === 0) {
        toast('info', '没有需要替换的内容');
        return;
      }
      mutate(applyReplacePlan(stateRef.current.doc, plan), `批量替换 ${plan.totalReplacements} 处`);
      toast('ok', `已替换 ${plan.totalReplacements} 处内容（可撤销）`);
    },
    [mutate, toast],
  );

  const setFormat = useCallback(
    (format: SubtitleFormat) => {
      const current = stateRef.current.doc;
      if (current.format === format) return;
      mutate({ ...current, format }, `切换为 ${format.toUpperCase()}`);
      toast('ok', `输出格式已切换为 ${format.toUpperCase()}，导出时会按该格式校验`);
    },
    [mutate, toast],
  );

  const setBilingual = useCallback(
    (patch: Partial<BilingualLayout>) => {
      const current = stateRef.current.doc;
      mutate({ ...current, bilingual: { ...current.bilingual, ...patch } }, '双语设置');
    },
    [mutate],
  );

  const setSecondaryText = useCallback(
    (cueId: string, text: string) => {
      mutate(setSecondary(stateRef.current.doc, cueId, text), '编辑译文', {
        mergeKey: `secondary-${cueId}`,
        activeCueId: cueId,
      });
    },
    [mutate],
  );

  const mergeSecondDocument = useCallback(
    (secondary: Doc, options: MergeOptions = {}) => {
      const result = mergeBilingual(stateRef.current.doc, secondary, options);
      mutate(result.doc, '合并双语字幕');
      const { report } = result;
      toast(
        report.matchedCount === 0 ? 'warn' : 'ok',
        `双语合并完成：${report.matchedCount}/${report.primaryCount} 条已配对，${report.unmatchedSecondary} 条译文未匹配`,
      );
    },
    [mutate, toast],
  );

  const applyParsedDoc = useCallback(
    (doc: Doc, fileName?: string) => {
      const next = fileName ? { ...doc, meta: { ...doc.meta, fileName } } : doc;
      dispatch({ type: 'load', doc: next, label: fileName ? `导入 ${fileName}` : '导入字幕' });
      const errors = next.meta.issues.filter((issue) => issue.severity === 'error').length;
      if (next.cues.length === 0) toast('error', '没有解析到任何字幕，请检查文件格式');
      else if (errors > 0) toast('warn', `已导入 ${next.cues.length} 条字幕，发现 ${errors} 个需要处理的问题`);
      else toast('ok', `已导入 ${next.cues.length} 条字幕`);
    },
    [toast],
  );

  const replaceDoc = useCallback(
    (doc: Doc, label: string) => {
      mutate(doc, label);
    },
    [mutate],
  );

  const renameDoc = useCallback(
    (title: string) => {
      const current = stateRef.current.doc;
      if (current.title === title) return;
      mutate(
        { ...current, title, meta: { ...current.meta, fileName: current.meta.fileName } },
        '重命名字幕',
      );
    },
    [mutate],
  );

  const insertCue = useCallback(
    (start: number, end: number) => {
      const current = stateRef.current.doc;
      const lastIndex = current.cues.length - 1;
      const id = nextCueId();
      const cue: Cue = { id, number: current.cues.length + 1, start, end, text: '' };
      const cues = [...current.cues, cue];
      mutate({ ...current, cues }, '新增字幕', { activeCueId: id });
      toast('ok', `已在末尾新增第 ${lastIndex + 2} 条字幕`);
      return id;
    },
    [mutate, toast],
  );

  const exportText = useCallback(
    (format: SubtitleFormat, newline?: '\n' | '\r\n', bom?: boolean) =>
      serializeSubtitles(stateRef.current.doc, {
        format,
        ...(newline ? { newline } : {}),
        ...(bom !== undefined ? { bom } : {}),
      }),
    [],
  );

  return {
    doc: state.doc,
    baseline: state.baseline,
    activeCueId: state.activeCueId,
    activeCue: activeIndex >= 0 ? state.doc.cues[activeIndex] ?? null : null,
    activeIndex,
    selectedIds: state.selectedIds,
    historyIndex: state.historyIndex,
    historyLength: state.history.length,
    historyLabels: state.history.map((entry) => entry.label),
    canUndo: state.historyIndex > 0,
    canRedo: state.historyIndex >= 0 && state.historyIndex < state.history.length - 1,
    toasts: state.toasts,
    issues,
    summary,
    diff,
    dirty: state.baseline !== state.doc,
    loadFromText,
    applyParsedDoc,
    replaceDoc,
    renameDoc,
    insertCue,
    pasteText,
    setActive: useCallback((cueId: string | null) => dispatch({ type: 'setActive', cueId }), []),
    setSelection: useCallback((ids: string[]) => dispatch({ type: 'select', ids }), []),
    toggleSelection: useCallback((cueId: string) => dispatch({ type: 'toggleSelect', cueId }), []),
    selectAll: useCallback(() => {
      dispatch({ type: 'select', ids: stateRef.current.doc.cues.map((cue) => cue.id) });
    }, []),
    clearSelection: useCallback(() => dispatch({ type: 'select', ids: [] }), []),
    editCue,
    shift,
    normalizeToZero,
    split,
    merge,
    remove,
    removeEmpty,
    applyFixAction,
    runRenumber,
    runSort,
    runTrimOverlaps,
    runMinDuration,
    replace,
    setFormat,
    setBilingual,
    setSecondaryText,
    mergeSecondDocument,
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    toast,
    dismissToast: useCallback((id: number) => dispatch({ type: 'dismissToast', id }), []),
    markSaved: useCallback(() => dispatch({ type: 'resetBaseline' }), []),
    exportText,
  };
}
