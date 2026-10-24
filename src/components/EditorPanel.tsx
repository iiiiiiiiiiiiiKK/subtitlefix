import { useEffect, useMemo, useState } from 'react';
import { formatTimecode, formatDuration } from '../core/timecode';
import type { Cue, Issue, SubtitleFormat } from '../core/types';
import { parseUserTime } from '../lib/timeinput';
import { IconCheck, IconClock, IconSplit, IconTrash } from './icons';

export interface EditorPanelProps {
  cue: Cue | null;
  cueIndex: number;
  total: number;
  format: SubtitleFormat;
  issues: Issue[];
  hasPrev: boolean;
  hasNext: boolean;
  onNavigate: (direction: -1 | 1) => void;
  onPatch: (patch: Partial<Omit<Cue, 'id'>>) => void;
  onPatchSecondary: (text: string) => void;
  onSplitAt: (ms: number) => void;
  onDelete: () => void;
  onApplyFix: (fixId: Issue['fix']) => void;
  onAddCue: () => void;
}

interface TimeFieldProps {
  label: string;
  valueMs: number;
  format: SubtitleFormat;
  invalid: boolean;
  onCommit: (ms: number) => void;
  hint?: string;
  testId?: string;
}

function TimeField({ label, valueMs, format, invalid, onCommit, hint, testId }: TimeFieldProps) {
  const [draft, setDraft] = useState(formatTimecode(valueMs, format));
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(formatTimecode(valueMs, format));
      setError(null);
    }
  }, [valueMs, format, focused]);

  const commit = () => {
    const parsed = parseUserTime(draft, valueMs, false);
    if (!parsed.ok) {
      setError(parsed.error ?? '格式无效');
      return;
    }
    setError(null);
    setDraft(formatTimecode(parsed.ms, format));
    if (parsed.ms !== valueMs) onCommit(parsed.ms);
  };

  const nudge = (delta: number) => {
    onCommit(valueMs + delta);
    setDraft(formatTimecode(valueMs + delta, format));
  };

  return (
    <div className="field timefield">
      <label htmlFor={testId}>{label}</label>
      <div className="timefield__row">
        <input
          id={testId}
          data-testid={testId}
          className={`input input--mono${invalid || error ? ' input--invalid' : ''}`}
          value={draft}
          onFocus={() => setFocused(true)}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              nudge(event.shiftKey ? 1000 : 10);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              nudge(event.shiftKey ? -1000 : -10);
            }
          }}
          spellCheck={false}
        />
        <div className="timefield__nudges">
          <button type="button" className="btn btn--sm" onClick={() => nudge(-1000)} title="-1 秒">
            −1s
          </button>
          <button type="button" className="btn btn--sm" onClick={() => nudge(-10)} title="-10 毫秒">
            −10
          </button>
          <button type="button" className="btn btn--sm" onClick={() => nudge(10)} title="+10 毫秒">
            +10
          </button>
          <button type="button" className="btn btn--sm" onClick={() => nudge(1000)} title="+1 秒">
            +1s
          </button>
        </div>
      </div>
      {error ? (
        <span className="field__error">{error}</span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function EditorPanel(props: EditorPanelProps) {
  const { cue } = props;
  const [splitAt, setSplitAt] = useState('');
  const [showSplit, setShowSplit] = useState(false);
  /** Lets the user start a translation line for a cue that has none yet. */
  const [forceSecondary, setForceSecondary] = useState(false);

  const cueIssues = useMemo(
    () => (cue ? props.issues.filter((issue) => issue.cueId === cue.id) : []),
    [cue, props.issues],
  );

  useEffect(() => {
    setShowSplit(false);
    setSplitAt('');
    setForceSecondary(false);
  }, [cue?.id]);

  if (!cue) {
    return (
      <aside className="editor editor--empty" aria-label="编辑面板">
        <div className="editor__placeholder">
          <p className="editor__placeholder-title">未选择字幕</p>
          <p className="muted">从左侧列表中选择一条字幕开始编辑，或新增一条。</p>
          <button type="button" className="btn btn--primary" onClick={props.onAddCue}>
            新增字幕
          </button>
        </div>
      </aside>
    );
  }

  const duration = cue.end - cue.start;
  const reversed = cue.start > cue.end;
  const midPoint = props.cueIndex >= 0 && props.cueIndex < props.total - 1 ? cue.start + Math.round(duration / 2) : cue.end - 1;

  const commitSplit = () => {
    const parsed = parseUserTime(splitAt, midPoint, false);
    if (!parsed.ok) {
      props.onSplitAt(midPoint);
      setShowSplit(false);
      return;
    }
    props.onSplitAt(parsed.ms);
    setShowSplit(false);
    setSplitAt('');
  };

  return (
    <aside className="editor" aria-label="编辑面板" data-testid="editor-panel">
      <header className="editor__head">
        <div>
          <h2 className="editor__title">
            第 {props.cueIndex + 1} 条
            <span className="editor__of"> / {props.total}</span>
          </h2>
          <p className="editor__sub mono">
            {formatTimecode(cue.start, props.format)} → {formatTimecode(cue.end, props.format)}
            <span className="editor__dur"> · {formatDuration(duration)}</span>
          </p>
        </div>
        <div className="editor__nav">
          <button
            type="button"
            className="icon-btn"
            onClick={() => props.onNavigate(-1)}
            disabled={!props.hasPrev}
            aria-label="上一条"
            title="上一条（Alt+↑）"
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => props.onNavigate(1)}
            disabled={!props.hasNext}
            aria-label="下一条"
            title="下一条（Alt+↓）"
          >
            ↓
          </button>
        </div>
      </header>

      <div className="editor__body">
        {cueIssues.length > 0 ? (
          <ul className="editor__issues">
            {cueIssues.slice(0, 4).map((issue) => (
              <li key={issue.id} className={`editor__issue editor__issue--${issue.severity}`}>
                <span className="editor__issue-msg">{issue.message}</span>
                {issue.fix ? (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => props.onApplyFix(issue.fix)}
                  >
                    {issue.fixLabel ?? '修复'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="editor__clean">
            <IconCheck size={14} /> 这一条没有检测到问题
          </p>
        )}

        <div className="editor__row">
          <div className="field editor__numfield">
            <label htmlFor="cue-number">编号</label>
            <input
              id="cue-number"
              data-testid="input-cue-number"
              className="input input--mono"
              type="number"
              inputMode="numeric"
              value={cue.number}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) props.onPatch({ number: Math.trunc(value) });
              }}
            />
          </div>
          <div className="field editor__meta">
            <span className="field__label">时长</span>
            <span className={`editor__duration mono${reversed ? ' editor__duration--bad' : ''}`}>
              <IconClock size={13} /> {reversed ? `时间倒序 ${formatDuration(Math.abs(duration))}` : formatDuration(duration)}
            </span>
          </div>
        </div>

        <TimeField
          label="开始时间"
          valueMs={cue.start}
          format={props.format}
          invalid={reversed}
          onCommit={(ms) => props.onPatch({ start: ms })}
          hint="支持 00:00:01,000 / 1.5（秒）；↑↓ 微调 10ms，Shift+↑↓ 调 1s"
          testId="input-cue-start"
        />
        <TimeField
          label="结束时间"
          valueMs={cue.end}
          format={props.format}
          invalid={reversed}
          onCommit={(ms) => props.onPatch({ end: ms })}
          testId="input-cue-end"
        />

        <div className="field">
          <label htmlFor="cue-text">正文</label>
          <textarea
            id="cue-text"
            data-testid="input-cue-text"
            className="textarea editor__text"
            value={cue.text}
            rows={Math.min(10, Math.max(4, cue.text.split('\n').length + 1))}
            onChange={(event) => props.onPatch({ text: event.target.value })}
            placeholder="字幕正文，可包含多行；换行会原样保留在导出文件中"
            spellCheck={false}
          />
          <span className="field__hint">
            {cue.text.length} 字符 · {cue.text.split('\n').length} 行
          </span>
        </div>

        {cue.secondary !== undefined || forceSecondary ? (
          <div className="field">
            <label htmlFor="cue-secondary">译文（双语字幕）</label>
            <textarea
              id="cue-secondary"
              className="textarea editor__text"
              value={cue.secondary ?? ''}
              rows={3}
              onChange={(event) => props.onPatchSecondary(event.target.value)}
              placeholder="双语合并后的第二语言正文"
              spellCheck={false}
            />
            <span className="field__hint">清空后保存即移除译文行；导出时可选择是否包含译文。</span>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--ghost btn--sm editor__addsecondary"
            onClick={() => setForceSecondary(true)}
          >
            + 添加译文行
          </button>
        )}

        {props.format === 'vtt' ? (
          <div className="field">
            <label htmlFor="cue-settings">WebVTT 设置（可选）</label>
            <input
              id="cue-settings"
              className="input input--mono"
              value={cue.settings ?? ''}
              placeholder="align:start position:10%"
              onChange={(event) => props.onPatch({ settings: event.target.value })}
            />
            <span className="field__hint">导出 SRT 时会被忽略，导出 VTT 时原样写入。</span>
          </div>
        ) : null}

        {showSplit ? (
          <div className="editor__split">
            <div className="field">
              <label htmlFor="split-at">拆分时间点</label>
              <input
                id="split-at"
                className="input input--mono"
                value={splitAt}
                placeholder={formatTimecode(midPoint, props.format)}
                onChange={(event) => setSplitAt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitSplit();
                }}
                autoFocus
              />
            </div>
            <div className="editor__split-actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={commitSplit}>
                在此拆分
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setShowSplit(false)}>
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="editor__foot">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setSplitAt(formatTimecode(midPoint, props.format));
            setShowSplit((value) => !value);
          }}
          title="拆分当前字幕（S）"
        >
          <IconSplit size={15} /> 拆分
        </button>
        <button type="button" className="btn btn--danger" onClick={props.onDelete}>
          <IconTrash size={15} /> 删除本条
        </button>
      </footer>
    </aside>
  );
}
