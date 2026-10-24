import { useEffect, useRef, useState } from 'react';
import { formatTimecode, formatDuration } from '../core/timecode';
import type { Cue, Issue, SubtitleFormat } from '../core/types';
import { cueSeverity } from '../core/validate';

export interface CueListProps {
  cues: Cue[];
  format: SubtitleFormat;
  activeCueId: string | null;
  selectedIds: string[];
  issues: Issue[];
  /** Cue ids matching the current search, if a search is active. */
  highlightIds: Set<string> | null;
  query: string;
  onQueryChange: (query: string) => void;
  onClearQuery: () => void;
  onActivate: (cueId: string) => void;
  onToggleSelect: (cueId: string) => void;
  onSelectRange: (fromId: string, toId: string) => void;
  onScrollDone: () => void;
  scrollToId: string | null;
}

const ROW_HEIGHT = 68;
const OVERSCAN = 6;
const VIRTUALIZE_THRESHOLD = 300;

export function CueList(props: CueListProps) {
  const { scrollToId, cues, onScrollDone, activeCueId } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ height: 600, scrollTop: 0 });
  const lastClicked = useRef<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setViewport({ height: el.clientHeight, scrollTop: el.scrollTop });
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  const activeIndex = cues.findIndex((cue) => cue.id === activeCueId);

  useEffect(() => {
    if (!scrollToId) return;
    const index = cues.findIndex((cue) => cue.id === scrollToId);
    const el = scrollRef.current;
    if (index >= 0 && el) {
      const top = index * ROW_HEIGHT - el.clientHeight / 2 + ROW_HEIGHT / 2;
      el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    onScrollDone();
  }, [scrollToId, cues, onScrollDone]);

  const virtual = props.cues.length > VIRTUALIZE_THRESHOLD;
  const start = virtual
    ? Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN)
    : 0;
  const end = virtual
    ? Math.min(
        props.cues.length,
        Math.ceil((viewport.scrollTop + viewport.height) / ROW_HEIGHT) + OVERSCAN,
      )
    : props.cues.length;
  const visible = props.cues.slice(start, end);

  if (props.cues.length === 0) {
    return (
      <section className="cuelist cuelist--empty" aria-label="字幕列表">
        <div className="cuelist__placeholder">
          <p className="cuelist__placeholder-title">还没有字幕</p>
          <p className="muted">
            导入 <code>.srt</code> / <code>.vtt</code> 文件，粘贴字幕文本，或加载示例文件开始。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="cuelist" aria-label="字幕列表">
      <div className="cuelist__filter">
        <input
          className="input cuelist__filter-input"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder="快速过滤 / 高亮正文…"
          aria-label="快速过滤字幕"
          spellCheck={false}
          data-testid="list-filter"
        />
        {props.query !== '' ? (
          <span className="cuelist__filter-count">
            {props.highlightIds ? props.highlightIds.size : 0} 条命中
          </span>
        ) : null}
        {props.query !== '' ? (
          <button type="button" className="btn btn--sm btn--ghost" onClick={props.onClearQuery}>
            清除
          </button>
        ) : null}
      </div>
      <div className="cuelist__head">
        <span className="cuelist__col cuelist__col--num">#</span>
        <span className="cuelist__col cuelist__col--time">时间轴</span>
        <span className="cuelist__col cuelist__col--text">正文</span>
      </div>
      <div className="cuelist__scroll" ref={scrollRef} data-testid="cue-list">
        <div
          className="cuelist__inner"
          style={virtual ? { height: props.cues.length * ROW_HEIGHT } : undefined}
        >
          <div
            style={virtual ? { transform: `translateY(${start * ROW_HEIGHT}px)` } : undefined}
            className={virtual ? 'cuelist__window' : undefined}
          >
            {visible.map((cue, offset) => {
              const index = start + offset;
              const active = cue.id === props.activeCueId;
              const selected = props.selectedIds.includes(cue.id);
              const severity = cueSeverity(props.issues, cue.id);
              const matched = props.highlightIds ? props.highlightIds.has(cue.id) : false;
              return (
                <div
                  key={cue.id}
                  className={[
                    'cue-row',
                    active ? 'is-active' : '',
                    selected ? 'is-selected' : '',
                    matched ? 'is-match' : '',
                    severity ? `is-${severity}` : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ height: ROW_HEIGHT }}
                  onClick={(event) => {
                    if (event.shiftKey && lastClicked.current) {
                      props.onSelectRange(lastClicked.current, cue.id);
                    } else if (event.metaKey || event.ctrlKey) {
                      props.onToggleSelect(cue.id);
                    } else {
                      props.onActivate(cue.id);
                      lastClicked.current = cue.id;
                    }
                  }}
                  role="option"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  data-testid={`cue-row-${index + 1}`}
                  data-cue-id={cue.id}
                >
                  <span className="cue-row__num mono">
                    <span className={`cue-dot cue-dot--${severity ?? 'ok'}`} aria-hidden />
                    {cue.number}
                  </span>
                  <span className="cue-row__time mono">
                    <span className="cue-row__start">{formatTimecode(cue.start, props.format)}</span>
                    <span className="cue-row__arrow">→</span>
                    <span
                      className={
                        cue.end < cue.start ? 'cue-row__end cue-row__end--bad' : 'cue-row__end'
                      }
                    >
                      {formatTimecode(cue.end, props.format)}
                    </span>
                    <span className="cue-row__dur">{formatDuration(cue.end - cue.start)}</span>
                  </span>
                  <span className="cue-row__text">
                    {cue.text.trim() === '' ? (
                      <em className="cue-row__empty">（空字幕）</em>
                    ) : (
                      cue.text.split('\n').map((line, lineIndex) => (
                        <span key={lineIndex} className="cue-row__line">
                          {line === '' ? '\u00a0' : line}
                        </span>
                      ))
                    )}
                    {cue.secondary ? <span className="cue-row__secondary">{cue.secondary}</span> : null}
                  </span>
                  {severity ? (
                    <span className={`cue-row__flag cue-row__flag--${severity}`} aria-label={`${severity} issue`}>
                      {severity === 'error' ? '!' : severity === 'warning' ? '?' : 'i'}
                    </span>
                  ) : null}
                  {selected ? (
                    <span className="cue-row__check" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {activeIndex >= 0 ? (
        <div className="cuelist__foot mono">
          第 {activeIndex + 1} / {props.cues.length} 条
        </div>
      ) : null}
    </section>
  );
}
