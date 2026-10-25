import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BilingualDialog } from './components/BilingualDialog';
import { CueList } from './components/CueList';
import { DemoTour, DemoConfirm } from './components/DemoTour';
import { EditorPanel } from './components/EditorPanel';
import { ExportDialog } from './components/ExportDialog';
import { IssuePanel } from './components/IssuePanel';
import { PasteDialog, loadSampleText } from './components/PasteDialog';
import { SearchDialog } from './components/SearchDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { Toasts } from './components/Toasts';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { IconPlay, IconShield, IconUpload } from './components/icons';
import {
  DEMO_FILE_NAME,
  DEMO_SRT,
  DEMO_TITLE,
  TOUR_STEPS,
  hasSeenTour,
  markTourSeen,
  type DemoTab,
} from './core/demo';
import { applyFix, searchCues } from './core/ops';
import { suggestedFileName } from './core/serialize';
import type { Doc, FixId, Issue, SubtitleFormat } from './core/types';
import { copyToClipboard, downloadText, isSubtitleFileName, readTextFile } from './lib/files';
import { useTheme } from './lib/useTheme';
import { useSubtitleStore } from './state/useSubtitleStore';
import './styles/app.css';
import './styles/tour.css';

/** Files above this size are parsed in a Web Worker to keep the UI responsive. */
const WORKER_THRESHOLD_BYTES = 220_000;

type MobileView = 'list' | 'editor' | 'issues';

export default function App() {
  const store = useSubtitleStore();
  const { theme, toggle } = useTheme();

  const [pasteOpen, setPasteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bilingualOpen, setBilingualOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [issuesCollapsed, setIssuesCollapsed] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('list');
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [activeQuery, setActiveQuery] = useState('');
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  /** Set when the tour hands control to the export dialog and must resume after. */
  const [resumeTourAt, setResumeTourAt] = useState<number | null>(null);
  /** Non-null when the user asked for the demo while their own file was open. */
  const [demoConfirmOpen, setDemoConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // ---------------------------------------------------------------- import
  const importText = useCallback(
    (text: string, fileName: string) => {
      const bytes = text.length;
      if (bytes < WORKER_THRESHOLD_BYTES) {
        store.loadFromText(text, { fileName, source: 'file' });
        return;
      }
      setBusyMessage(`正在后台解析 ${(bytes / 1024 / 1024).toFixed(1)}MB 字幕…`);
      const worker = new Worker(new URL('./workers/subtitle.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<{ ok: boolean; doc?: Doc; error?: string }>) => {
        worker.terminate();
        setBusyMessage(null);
        if (event.data.ok && event.data.doc) {
          store.applyParsedDoc(event.data.doc, fileName);
        } else {
          store.toast('error', `解析失败：${event.data.error ?? '未知错误'}`);
        }
      };
      worker.onerror = () => {
        worker.terminate();
        setBusyMessage(null);
        store.toast('error', '后台解析线程出错，已改用主线程解析');
        store.loadFromText(text, { fileName, source: 'file' });
      };
      worker.postMessage({ id: 1, kind: 'parse', text, options: { fileName, source: 'file' } });
    },
    [store],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const file = list[0]!;
      if (list.length > 1) {
        store.toast('info', '一次只能打开一个字幕文件，已选择第一个');
      }
      if (!isSubtitleFileName(file.name)) {
        store.toast('warn', `${file.name} 不是 .srt / .vtt 文件，仍会尝试按文本解析`);
      }
      try {
        const { text, fileName } = await readTextFile(file);
        importText(text, fileName);
        setMobileView('list');
      } catch (error) {
        store.toast('error', error instanceof Error ? error.message : '文件读取失败');
      }
    },
    [importText, store],
  );

  // ------------------------------------------------------------ exporting
  const doExport = useCallback(
    (options: { format: SubtitleFormat; newline: '\n' | '\r\n'; bom: boolean; includeSecondary: boolean }) => {
      const doc = store.doc;
      const text = store.exportText(options.format, options.newline, options.bom);
      const name = suggestedFileName(doc, options.format);
      downloadText(name, text, options.format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8');
      store.markSaved();
      setExportOpen(false);
      store.toast('ok', `已导出 ${name}（${doc.cues.length} 条字幕）`);
    },
    [store],
  );

  const copyOutput = useCallback(async () => {
    const text = store.exportText(store.doc.format);
    const ok = await copyToClipboard(text);
    store.toast(ok ? 'ok' : 'error', ok ? `${store.doc.format.toUpperCase()} 已复制到剪贴板` : '复制失败，请使用导出按钮');
  }, [store]);

  // ------------------------------------------------------------- shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (store.doc.cues.length > 0) setExportOpen(true);
        return;
      }
      if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        fileInputRef.current?.click();
        return;
      }
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (mod && event.key.toLowerCase() === 'a' && !typing) {
        event.preventDefault();
        store.selectAll();
        return;
      }
      if (typing) return;
      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        setDragActive(false);
        return;
      }
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        navigate(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (event.key === 's' || event.key === 'S') {
        if (!store.activeCue) return;
        event.preventDefault();
        const mid = store.activeCue.start + Math.round((store.activeCue.end - store.activeCue.start) / 2);
        store.split(store.activeCue.id, mid);
        return;
      }
      if (event.key === 'm' || event.key === 'M') {
        if (store.selectedIds.length < 2) return;
        event.preventDefault();
        store.merge(store.selectedIds);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (store.selectedIds.length > 0) {
          event.preventDefault();
          store.remove(store.selectedIds);
        } else if (store.activeCueId) {
          event.preventDefault();
          store.remove([store.activeCueId]);
        }
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (target?.closest('.cuelist')) {
          event.preventDefault();
          navigate(event.key === 'ArrowDown' ? 1 : -1);
        }
      }
    };

    const navigate = (direction: -1 | 1) => {
      const cues = store.doc.cues;
      if (cues.length === 0) return;
      const index = store.activeCueId ? cues.findIndex((cue) => cue.id === store.activeCueId) : -1;
      const next = Math.max(0, Math.min(cues.length - 1, index + direction));
      const cue = cues[next];
      if (cue) {
        store.setActive(cue.id);
        setScrollToId(cue.id);
        setMobileView('editor');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  // -------------------------------------------------------------- search HL
  const highlightIds = useMemo(() => {
    if (activeQuery.trim() === '') return null;
    return new Set(searchCues(store.doc, activeQuery, { field: 'all' }).map((match) => match.cueId));
  }, [activeQuery, store.doc]);

  const jumpTo = useCallback(
    (cueId: string) => {
      store.setActive(cueId);
      setScrollToId(cueId);
      setMobileView('editor');
    },
    [store],
  );

  const issueJump = useCallback(
    (issue: Issue) => {
      if (issue.cueId) {
        jumpTo(issue.cueId);
        return;
      }
      if (issue.cuePosition && store.doc.cues[issue.cuePosition - 1]) {
        jumpTo(store.doc.cues[issue.cuePosition - 1]!.id);
      }
    },
    [jumpTo, store.doc.cues],
  );

  const issueFix = useCallback(
    (issue: Issue) => {
      if (!issue.fix) return;
      store.applyFixAction(issue.fix, issue.cueId);
    },
    [store],
  );

  const fixAll = useCallback(() => {
    let doc = store.doc;
    const steps: string[] = [];
    const before = doc;
    const pipeline: FixId[] = [
      'shift-all-positive',
      'swap-times',
      'trim-overlap',
      'renumber',
    ];
    for (const step of pipeline) {
      const outcome = applyFix(doc, step);
      if (outcome.doc !== doc) {
        steps.push(outcome.message);
        doc = outcome.doc;
      }
    }
    if (doc === before) {
      store.toast('info', '没有需要修复的问题');
      return;
    }
    store.replaceDoc(doc, '一键修复');
    store.toast('ok', `一键修复完成：${steps.join('；')}`);
  }, [store]);

  const splitActive = useCallback(() => {
    const cue = store.activeCue;
    if (!cue) {
      store.toast('info', '请先选择一条字幕');
      return;
    }
    const mid = cue.start + Math.round((cue.end - cue.start) / 2);
    store.split(cue.id, mid);
  }, [store]);

  const deleteAction = useCallback(() => {
    if (store.selectedIds.length > 0) store.remove(store.selectedIds);
    else if (store.activeCueId) store.remove([store.activeCueId]);
    else store.toast('info', '没有选中任何字幕');
  }, [store]);

  const addCue = useCallback(() => {
    const last = store.doc.cues[store.doc.cues.length - 1];
    const start = last ? last.end + 1000 : 0;
    store.insertCue(start, start + 2000);
  }, [store]);

  // ------------------------------------------------------------- guided demo
  const startTour = useCallback(
    (fromStep = 0) => {
      // The demo loads its own document, which replaces the undo history. Never
      // do that silently while the user has their own file open.
      const ownWork = store.doc.cues.length > 0 && store.doc.meta.fileName !== DEMO_FILE_NAME;
      if (fromStep === 0 && ownWork) {
        setDemoConfirmOpen(true);
        return;
      }
      setResumeTourAt(null);
      setTourStep(fromStep);
      setTourOpen(true);
    },
    [store.doc.cues.length, store.doc.meta.fileName],
  );

  const finishTour = useCallback(() => {
    setTourOpen(false);
    setResumeTourAt(null);
    markTourSeen();
    store.toast('info', '演示结束。把你的 .srt / .vtt 拖进窗口就能开始；想再看一次点工具栏的「演示」。');
  }, [store]);

  const skipTour = useCallback(() => {
    setTourOpen(false);
    setResumeTourAt(null);
    markTourSeen();
  }, []);

  const nextTourStep = useCallback(() => {
    setTourStep((step) => Math.min(step + 1, TOUR_STEPS.length - 1));
  }, []);

  const prevTourStep = useCallback(() => {
    setTourStep((step) => Math.max(step - 1, 0));
  }, []);

  /**
   * Side effect of a tour step. The step that opens the export dialog hands over
   * to that dialog (it is modal), then the tour resumes at `resumeTourAt`.
   */
  const runTourAction = useCallback(
    (index: number) => {
      const step = TOUR_STEPS[index];
      if (!step) return;
      switch (step.action) {
        case 'load-demo':
          store.loadFromText(DEMO_SRT, {
            fileName: DEMO_FILE_NAME,
            source: 'sample',
            title: DEMO_TITLE,
          });
          setMobileView('list');
          break;
        case 'fix-swap':
          store.applyFixAction('swap-times');
          break;
        case 'fix-overlap':
          store.runTrimOverlaps();
          break;
        case 'fix-all':
          fixAll();
          break;
        case 'open-export':
          setTourOpen(false);
          setExportOpen(true);
          setResumeTourAt(TOUR_STEPS.length - 1);
          break;
        default:
          break;
      }
    },
    [store, fixAll],
  );

  const showTourTab = useCallback((tab: DemoTab) => {
    setMobileView(tab);
  }, []);

  const closeExport = useCallback(() => {
    setExportOpen(false);
    if (resumeTourAt !== null) {
      setTourStep(resumeTourAt);
      setTourOpen(true);
      setResumeTourAt(null);
    }
  }, [resumeTourAt]);

  // First visit: open the demo automatically, but only once per browser.
  useEffect(() => {
    if (hasSeenTour()) return;
    const timer = window.setTimeout(() => {
      setTourStep(0);
      setTourOpen(true);
    }, 800);
    return () => window.clearTimeout(timer);
  }, []);

  // ------------------------------------------------------------------- drag
  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      dragDepth.current += 1;
      setDragActive(true);
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    };
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      dragDepth.current = 0;
      setDragActive(false);
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      void handleFiles(event.dataTransfer.files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFiles]);

  const hasCues = store.doc.cues.length > 0;

  return (
    <div className="app" data-has-cues={hasCues}>
      <TopBar
        doc={store.doc}
        summary={store.summary}
        dirty={store.dirty}
        theme={theme}
        onToggleTheme={toggle}
        onRename={(title) => store.renameDoc(title)}
        onShowShortcuts={() => setHelpOpen(true)}
      />

      <Toolbar
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        hasCues={hasCues}
        selectedCount={store.selectedIds.length}
        onImportFile={() => fileInputRef.current?.click()}
        onPaste={() => setPasteOpen(true)}
        onSearch={() => setSearchOpen(true)}
        onBilingual={() => setBilingualOpen(true)}
        onSplit={splitActive}
        onMerge={() => store.merge(store.selectedIds)}
        onDelete={deleteAction}
        onFixAll={fixAll}
        onShift={(delta, scope) =>
          store.shift(delta, scope === 'selection' ? { cueIds: store.selectedIds } : {})
        }
        onNormalize={store.normalizeToZero}
        onCopy={() => void copyOutput()}
        onExport={() => setExportOpen(true)}
        onUndo={store.undo}
        onRedo={store.redo}
        onDemo={() => startTour(0)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".srt,.vtt,.txt,text/plain"
        className="sr-only"
        data-testid="file-input"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) void handleFiles(files);
          event.target.value = '';
        }}
      />

      {busyMessage ? (
        <div className="busy" role="status">
          <span className="busy__spinner" aria-hidden /> {busyMessage}
        </div>
      ) : null}

      <nav className="mobile-tabs" role="tablist" aria-label="视图切换">
        {(
          [
            ['list', `列表 ${store.doc.cues.length}`],
            ['editor', '编辑'],
            ['issues', `问题 ${store.summary.total}`],
          ] as [MobileView, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mobileView === value}
            className={`mobile-tabs__tab${mobileView === value ? ' is-active' : ''}`}
            onClick={() => setMobileView(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className={`workspace workspace--${mobileView}`}>
        {hasCues ? (
          <CueList
            cues={store.doc.cues}
            format={store.doc.format}
            activeCueId={store.activeCueId}
            selectedIds={store.selectedIds}
            issues={store.issues}
            highlightIds={highlightIds}
            query={activeQuery}
            onQueryChange={setActiveQuery}
            onClearQuery={() => setActiveQuery('')}
            onActivate={(cueId) => {
              store.setActive(cueId);
              setMobileView('editor');
            }}
            onToggleSelect={store.toggleSelection}
            onSelectRange={(fromId, toId) => {
              const cues = store.doc.cues;
              const a = cues.findIndex((cue) => cue.id === fromId);
              const b = cues.findIndex((cue) => cue.id === toId);
              if (a === -1 || b === -1) return;
              const [start, end] = a < b ? [a, b] : [b, a];
              store.setSelection(cues.slice(start, end + 1).map((cue) => cue.id));
            }}
            onScrollDone={() => setScrollToId(null)}
            scrollToId={scrollToId}
          />
        ) : (
          <EmptyState
            onImport={() => fileInputRef.current?.click()}
            onPaste={() => setPasteOpen(true)}
            onDemo={() => startTour(0)}
            onSample={(id) => {
              const sample = loadSampleText(id);
              if (sample) importText(sample.text, sample.fileName);
            }}
          />
        )}

        <EditorPanel
          cue={store.activeCue}
          cueIndex={store.activeIndex}
          total={store.doc.cues.length}
          format={store.doc.format}
          issues={store.issues}
          hasPrev={store.activeIndex > 0}
          hasNext={store.activeIndex >= 0 && store.activeIndex < store.doc.cues.length - 1}
          onNavigate={(direction) => {
            const cues = store.doc.cues;
            const next = cues[store.activeIndex + direction];
            if (next) jumpTo(next.id);
          }}
          onPatch={(patch) => {
            if (store.activeCue) store.editCue(store.activeCue.id, patch, 'cue-patch');
          }}
          onPatchSecondary={(text) => {
            if (store.activeCue) store.setSecondaryText(store.activeCue.id, text);
          }}
          onSplitAt={(ms) => {
            if (store.activeCue) store.split(store.activeCue.id, ms);
          }}
          onDelete={deleteAction}
          onApplyFix={(fix) => {
            if (fix && store.activeCue) store.applyFixAction(fix, store.activeCue.id);
          }}
          onAddCue={addCue}
        />

        <IssuePanel
          issues={store.issues}
          summary={store.summary}
          collapsed={issuesCollapsed}
          onToggleCollapsed={() => setIssuesCollapsed((value) => !value)}
          onJump={issueJump}
          onApplyFix={issueFix}
        />
      </main>

      <PasteDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onSubmit={(text, format, title) => {
          store.pasteText(text, title);
          if (format !== 'auto') store.setFormat(format);
          setMobileView('list');
        }}
        onLoadSample={(id) => {
          const sample = loadSampleText(id);
          if (sample) importText(sample.text, sample.fileName);
        }}
      />

      <SearchDialog
        open={searchOpen}
        doc={store.doc}
        selectedIds={store.selectedIds}
        onClose={() => setSearchOpen(false)}
        onJump={(cueId) => {
          jumpTo(cueId);
          setSearchOpen(false);
        }}
        onReplace={(plan) => {
          store.replace(plan);
        }}
      />

      <BilingualDialog
        open={bilingualOpen}
        doc={store.doc}
        onClose={() => setBilingualOpen(false)}
        onApply={(secondary, options) => {
          store.mergeSecondDocument(secondary, options);
        }}
      />

      <ExportDialog
        open={exportOpen}
        doc={store.doc}
        diff={store.diff}
        onClose={closeExport}
        onExport={doExport}
        suggestedName={(format) => suggestedFileName(store.doc, format)}
      />

      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />

      <DemoTour
        open={tourOpen}
        step={tourStep}
        onRunAction={runTourAction}
        onNext={nextTourStep}
        onPrev={prevTourStep}
        onFinish={finishTour}
        onSkip={skipTour}
        onShowTab={showTourTab}
      />

      <DemoConfirm
        open={demoConfirmOpen}
        onCancel={() => setDemoConfirmOpen(false)}
        onConfirm={() => {
          setDemoConfirmOpen(false);
          setResumeTourAt(null);
          setTourStep(0);
          setTourOpen(true);
        }}
      />

      <Toasts toasts={store.toasts} onDismiss={store.dismissToast} />

      {dragActive ? (
        <div className="drag-overlay" aria-hidden>
          <div className="drag-overlay__box">
            <IconUpload size={30} />
            <p>松手即可导入字幕文件</p>
            <span className="dim">.srt / .vtt · 本地解析，不会上传</span>
          </div>
        </div>
      ) : null}

      <footer className="appfoot">
        <span>
          <IconShield size={13} /> 所有解析、修复与导出都在你的浏览器内完成，文件不会离开设备。
        </span>
        <span className="dim">
          {store.doc.meta.fileName ?? '未命名'} · {store.doc.format.toUpperCase()} ·{' '}
          {store.doc.meta.newline === 'crlf' ? 'CRLF' : store.doc.meta.newline === 'mixed' ? '混合换行' : 'LF'}
        </span>
      </footer>
    </div>
  );
}

interface EmptyStateProps {
  onImport: () => void;
  onPaste: () => void;
  onSample: (id: string) => void;
  onDemo: () => void;
}

function EmptyState({ onImport, onPaste, onSample, onDemo }: EmptyStateProps) {
  return (
    <section className="empty" aria-label="开始使用">
      <div className="empty__hero">
        <p className="empty__eyebrow">字幕时间对不上？先看清楚问题在哪</p>
        <h2 className="empty__title">
          把一份坏掉的字幕，
          <br className="empty__br" />
          当场<span className="empty__accent">修好</span>
        </h2>
        <p className="empty__lede">
          字幕最常见的三种毛病：<strong>时间轴错位</strong>（整体快/慢几秒）、
          <strong>条目重叠或倒序</strong>（播放器闪字幕甚至跳过）、<strong>格式不兼容</strong>
          （SRT 与 WebVTT 互转时丢内容）。这个工具把它们一条条找出来、修好，并在导出前告诉你改了什么。
        </p>

        <div className="empty__actions">
          <button
            type="button"
            className="btn btn--primary empty__cta"
            onClick={onDemo}
            data-testid="empty-demo"
          >
            <IconPlay size={16} /> 看 3 分钟演示（推荐）
          </button>
          <button type="button" className="btn empty__cta" onClick={onImport} data-testid="empty-import">
            <IconUpload size={16} /> 选择字幕文件
          </button>
          <button type="button" className="btn empty__cta" onClick={onPaste}>
            粘贴字幕文本
          </button>
        </div>
        <p className="empty__hint dim">
          演示会载入一份<strong>故意弄坏</strong>的示例字幕并现场把它修好；也可以直接把 .srt / .vtt 拖进窗口。
        </p>
      </div>

      <div className="empty__samples">
        <h3 className="empty__samples-title">或者直接试这些示例</h3>
        <div className="empty__sample-grid">
          <button type="button" className="empty__sample" onClick={() => onSample('demo-walkthrough')}>
            <span className="empty__sample-name">演示字幕（5 种故障）</span>
            <span className="empty__sample-desc">重叠 / 倒序 / 空字幕 / 编号断档 / 缺空行</span>
          </button>
          <button type="button" className="empty__sample" onClick={() => onSample('clean-vtt')}>
            <span className="empty__sample-name">WebVTT 示例</span>
            <span className="empty__sample-desc">NOTE / STYLE 块、cue 设置与命名标识</span>
          </button>
          <button type="button" className="empty__sample" onClick={() => onSample('bilingual-en')}>
            <span className="empty__sample-name">双语 · 英文轨</span>
            <span className="empty__sample-desc">作为双语合并的主轨载入</span>
          </button>
        </div>
      </div>

      <ul className="empty__points">
        <li>
          <strong>本地优先</strong>
          <span>零上传、零追踪，断网也能用</span>
        </li>
        <li>
          <strong>不丢正文</strong>
          <span>导出前逐条展示差异，正文缺失会被明确警告</span>
        </li>
        <li>
          <strong>可撤销</strong>
          <span>所有批量操作都能 Ctrl+Z 回退</span>
        </li>
      </ul>
    </section>
  );
}
