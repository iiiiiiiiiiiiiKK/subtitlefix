import { useMemo, useState } from 'react';
import type { Issue, IssueSeverity } from '../core/types';
import type { IssueSummary } from '../core/validate';
import { IconAlert, IconCheck, IconInfo, IconWand } from './icons';

type Filter = 'all' | IssueSeverity;

export interface IssuePanelProps {
  issues: Issue[];
  summary: IssueSummary;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onJump: (issue: Issue) => void;
  onApplyFix: (issue: Issue) => void;
}

const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  error: '错误',
  warning: '警告',
  info: '提示',
};

export function IssuePanel(props: IssuePanelProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const visible = useMemo(
    () => (filter === 'all' ? props.issues : props.issues.filter((issue) => issue.severity === filter)),
    [props.issues, filter],
  );

  return (
    <section className={`issues${props.collapsed ? ' issues--collapsed' : ''}`} aria-label="问题检查结果">
      <header className="issues__head">
        <button
          type="button"
          className="issues__toggle"
          onClick={props.onToggleCollapsed}
          aria-expanded={!props.collapsed}
          title={props.collapsed ? '展开问题列表' : '收起问题列表'}
        >
          <span className={`issues__caret${props.collapsed ? '' : ' is-open'}`} aria-hidden>
            ▸
          </span>
          <span className="issues__title">问题检查</span>
        </button>

        <div className="issues__tabs" role="tablist" aria-label="按严重程度筛选">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`issues__tab${filter === 'all' ? ' is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部 <span className="issues__count">{props.summary.total}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'error'}
            className={`issues__tab issues__tab--error${filter === 'error' ? ' is-active' : ''}`}
            onClick={() => setFilter('error')}
          >
            错误 <span className="issues__count">{props.summary.error}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'warning'}
            className={`issues__tab issues__tab--warning${filter === 'warning' ? ' is-active' : ''}`}
            onClick={() => setFilter('warning')}
          >
            警告 <span className="issues__count">{props.summary.warning}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'info'}
            className={`issues__tab issues__tab--info${filter === 'info' ? ' is-active' : ''}`}
            onClick={() => setFilter('info')}
          >
            提示 <span className="issues__count">{props.summary.info}</span>
          </button>
        </div>

        <span className="issues__affected dim">影响 {props.summary.cuesAffected} 条字幕</span>
      </header>

      {props.collapsed ? null : (
        <div className="issues__body">
          {visible.length === 0 ? (
            <div className="issues__empty">
              <IconCheck size={16} />
              <span>
                {props.issues.length === 0
                  ? '没有检测到问题，可以放心导出。'
                  : `当前筛选下没有问题（共 ${props.issues.length} 条）`}
              </span>
            </div>
          ) : (
            <ul className="issues__list" data-testid="issue-list">
              {visible.map((issue) => (
                <li key={issue.id} className={`issue issue--${issue.severity}`}>
                  <button
                    type="button"
                    className="issue__main"
                    onClick={() => props.onJump(issue)}
                    title={issue.cuePosition ? `跳转到第 ${issue.cuePosition} 条字幕` : undefined}
                  >
                    <span className="issue__icon" aria-hidden>
                      {issue.severity === 'error' ? (
                        <IconAlert size={14} />
                      ) : issue.severity === 'warning' ? (
                        <IconAlert size={14} />
                      ) : (
                        <IconInfo size={14} />
                      )}
                    </span>
                    <span className="issue__body">
                      <span className="issue__message">{issue.message}</span>
                      {issue.detail ? <span className="issue__detail">{issue.detail}</span> : null}
                    </span>
                    <span className={`issue__tag issue__tag--${issue.severity}`}>
                      {SEVERITY_LABEL[issue.severity]}
                    </span>
                  </button>
                  {issue.fix ? (
                    <button
                      type="button"
                      className="btn btn--sm issue__fix"
                      onClick={() => props.onApplyFix(issue)}
                      title={issue.fixLabel}
                    >
                      <IconWand size={13} /> 修复
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
