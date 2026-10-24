import { useEffect, useMemo, useState } from 'react';
import { planReplace, searchCues, type ReplacePlan, type SearchField } from '../core/ops';
import type { Doc } from '../core/types';
import { formatTimecode } from '../core/timecode';
import { IconAlert, IconSearch } from './icons';
import { Modal } from './Modal';

export interface SearchDialogProps {
  open: boolean;
  doc: Doc;
  selectedIds: string[];
  onClose: () => void;
  onJump: (cueId: string) => void;
  onReplace: (plan: ReplacePlan) => void;
}

type Tab = 'find' | 'replace';

export function SearchDialog({ open, doc, selectedIds, onClose, onJump, onReplace }: SearchDialogProps) {
  const [tab, setTab] = useState<Tab>('find');
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [field, setField] = useState<SearchField>('text');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<'all' | 'selection'>('all');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');

  useEffect(() => {
    if (!open) return;
    setTab('find');
    setQuery('');
    setReplacement('');
  }, [open]);

  const timeRange = useMemo(() => {
    const parse = (value: string): number | undefined => {
      const trimmed = value.trim();
      if (trimmed === '') return undefined;
      const parts = trimmed.split(':').map(Number);
      if (parts.some(Number.isNaN)) return undefined;
      if (parts.length === 3) return (parts[0]! * 3600 + parts[1]! * 60 + parts[2]!) * 1000;
      if (parts.length === 2) return (parts[0]! * 60 + parts[1]!) * 1000;
      return Number(trimmed) * 1000;
    };
    return { from: parse(fromTime), to: parse(toTime) };
  }, [fromTime, toTime]);

  const searchOptions = useMemo(
    () => ({
      field,
      caseSensitive,
      regex,
      wholeWord,
      scope,
      selectedIds,
      ...(timeRange.from !== undefined ? { fromMs: timeRange.from } : {}),
      ...(timeRange.to !== undefined ? { toMs: timeRange.to } : {}),
    }),
    [field, caseSensitive, regex, wholeWord, scope, selectedIds, timeRange],
  );

  const matches = useMemo(
    () => (query.trim() === '' ? [] : searchCues(doc, query, searchOptions)),
    [doc, query, searchOptions],
  );

  const plan = useMemo(
    () => (query.trim() === '' ? null : planReplace(doc, query, replacement, searchOptions)),
    [doc, query, replacement, searchOptions],
  );

  const cueCount = new Set(matches.map((match) => match.cueId)).size;

  return (
    <Modal
      open={open}
      title="查找与批量替换"
      subtitle="按正文、编号或时间范围定位字幕；替换前会先给你完整预览。"
      onClose={onClose}
      width={780}
      testId="search-dialog"
      footer={
        <>
          <span className="dialog__hint">
            {query.trim() === ''
              ? '输入关键词开始查找'
              : `命中 ${matches.length} 处，涉及 ${cueCount} 条字幕`}
          </span>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              关闭
            </button>
            {tab === 'replace' ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={!plan || plan.items.length === 0}
                onClick={() => {
                  if (plan) {
                    onReplace(plan);
                    onClose();
                  }
                }}
                data-testid="replace-apply"
              >
                替换 {plan?.totalReplacements ?? 0} 处
              </button>
            ) : null}
          </div>
        </>
      }
    >
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'find'}
          className={`tabs__tab${tab === 'find' ? ' is-active' : ''}`}
          onClick={() => setTab('find')}
        >
          查找
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'replace'}
          className={`tabs__tab${tab === 'replace' ? ' is-active' : ''}`}
          onClick={() => setTab('replace')}
        >
          批量替换
        </button>
      </div>

      <div className="search__row">
        <div className="field search__query">
          <label htmlFor="search-query">
            <IconSearch size={13} /> {tab === 'replace' ? '查找内容' : '关键词'}
          </label>
          <input
            id="search-query"
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={regex ? '支持正则，例如 \\d{2}:\\d{2}' : '输入关键词，例如 你好'}
            autoFocus
            data-testid="search-input"
            spellCheck={false}
          />
        </div>
        {tab === 'replace' ? (
          <div className="field search__query">
            <label htmlFor="search-replacement">替换为</label>
            <input
              id="search-replacement"
              className="input"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              placeholder={regex ? '可用 $1 $2 引用分组' : '留空表示删除匹配内容'}
              data-testid="replace-input"
              spellCheck={false}
            />
          </div>
        ) : null}
      </div>

      <div className="search__options">
        <div className="field">
          <label htmlFor="search-field">查找范围</label>
          <select
            id="search-field"
            className="select"
            value={field}
            onChange={(event) => setField(event.target.value as SearchField)}
          >
            <option value="text">正文</option>
            <option value="index">字幕编号</option>
            <option value="time">时间（HH:MM:SS）</option>
            <option value="all">全部字段</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="search-scope">字幕范围</label>
          <select
            id="search-scope"
            className="select"
            value={scope}
            onChange={(event) => setScope(event.target.value as 'all' | 'selection')}
            disabled={selectedIds.length === 0}
          >
            <option value="all">全部字幕</option>
            <option value="selection">仅选中的 {selectedIds.length} 条</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="search-from">起始时间</label>
          <input
            id="search-from"
            className="input input--mono"
            value={fromTime}
            onChange={(event) => setFromTime(event.target.value)}
            placeholder="00:00:10"
          />
        </div>
        <div className="field">
          <label htmlFor="search-to">结束时间</label>
          <input
            id="search-to"
            className="input input--mono"
            value={toTime}
            onChange={(event) => setToTime(event.target.value)}
            placeholder="00:05:00"
          />
        </div>
      </div>

      <div className="search__flags">
        <label className="switch">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.target.checked)}
          />
          <span>区分大小写</span>
        </label>
        <label className="switch">
          <input type="checkbox" checked={regex} onChange={(event) => setRegex(event.target.checked)} />
          <span>正则表达式</span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(event) => setWholeWord(event.target.checked)}
            disabled={regex}
          />
          <span>全词匹配</span>
        </label>
      </div>

      {plan?.patternError ? (
        <p className="alert alert--error">
          <IconAlert size={14} /> {plan.patternError}
        </p>
      ) : null}

      <div className="search__results">
        {tab === 'find' ? (
          matches.length === 0 ? (
            <p className="search__empty dim">{query.trim() === '' ? '输入关键词后显示匹配结果' : '没有匹配的字幕'}</p>
          ) : (
            <ul className="search__list" data-testid="search-results">
              {matches.slice(0, 300).map((match, index) => (
                <li key={`${match.cueId}-${match.field}-${match.start}-${index}`}>
                  <button type="button" className="search__item" onClick={() => onJump(match.cueId)}>
                    <span className="search__item-num mono">#{match.cuePosition}</span>
                    <span className="search__item-field">{match.field === 'secondary' ? '译文' : match.field === 'text' ? '正文' : match.field === 'index' ? '编号' : '时间'}</span>
                    <span className="search__item-preview">{match.preview}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : plan && plan.items.length > 0 ? (
          <>
            <div className="search__preview-head">
              <span>
                将修改 <strong>{plan.items.length}</strong> 条字幕，共 <strong>{plan.totalReplacements}</strong> 处
              </span>
              <span className="dim">确认无误后再点右下角「替换」</span>
            </div>
            <ul className="search__list search__list--preview" data-testid="replace-preview">
              {plan.items.slice(0, 200).map((item) => (
                <li key={`${item.cueId}-${item.field}`} className="replace-item">
                  <span className="replace-item__num mono">#{item.cuePosition}</span>
                  <div className="replace-item__body">
                    <span className="replace-item__before">{item.before}</span>
                    <span className="replace-item__after">{item.after}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="search__empty dim">
            {query.trim() === '' ? '输入查找内容与替换值' : '没有需要替换的内容'}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function describeTimeRange(from?: number, to?: number): string {
  if (from === undefined && to === undefined) return '全部时间';
  return `${from !== undefined ? formatTimecode(from) : '开头'} → ${to !== undefined ? formatTimecode(to) : '结尾'}`;
}
