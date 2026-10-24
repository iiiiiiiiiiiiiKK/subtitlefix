import { useEffect, useState } from 'react';
import type { IssueSummary } from '../core/validate';
import type { Doc } from '../core/types';
import { IconGithub, IconInfo, IconMoon, IconShield, IconSun } from './icons';
import type { ThemeMode } from '../lib/useTheme';

export const X_PROFILE_URL = 'https://x.com/0xkillcoin';
export const REPO_URL = 'https://github.com/iiiiiiiiiiiiiKK/subtitlefix';

export interface TopBarProps {
  doc: Doc;
  summary: IssueSummary;
  dirty: boolean;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onRename: (title: string) => void;
  onShowShortcuts: () => void;
}

export function TopBar({ doc, summary, dirty, theme, onToggleTheme, onRename, onShowShortcuts }: TopBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc.title);

  useEffect(() => {
    setDraft(doc.title);
  }, [doc.title]);

  const commit = () => {
    const value = draft.trim();
    onRename(value === '' ? doc.title : value);
    setEditing(false);
  };

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="brand-mark" aria-hidden>
          <span className="brand-mark__srt">SRT</span>
          <span className="brand-mark__vtt">VTT</span>
        </span>
        <div className="brand-text">
          <h1 className="brand-name">
            SubtitleFix <span className="brand-cn">字幕修理厂</span>
          </h1>
          <p className="brand-tag">浏览器本地字幕工作台 · 零上传</p>
        </div>
      </div>

      <div className="topbar__center">
        {editing ? (
          <input
            className="input topbar__rename"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setDraft(doc.title);
                setEditing(false);
              }
            }}
            aria-label="文件标题"
          />
        ) : (
          <button
            type="button"
            className="topbar__title"
            onClick={() => setEditing(true)}
            title="点击重命名"
          >
            {doc.title}
            {dirty ? <span className="dirty-dot" aria-label="有未导出的修改" /> : null}
          </button>
        )}
        <div className="topbar__stats">
          <span className="chip chip--accent">{doc.format.toUpperCase()}</span>
          <span className="chip">{doc.cues.length} 条字幕</span>
          {summary.error > 0 ? (
            <span className="chip chip--danger">{summary.error} 错误</span>
          ) : null}
          {summary.warning > 0 ? (
            <span className="chip chip--warn">{summary.warning} 警告</span>
          ) : null}
          {summary.total === 0 ? <span className="chip chip--ok">无问题</span> : null}
        </div>
      </div>

      <div className="topbar__actions">
        <span className="privacy-badge" title="所有解析与导出都在本机浏览器内完成">
          <IconShield size={14} /> 本地处理
        </span>
        <button type="button" className="icon-btn" onClick={onShowShortcuts} aria-label="快捷键与帮助" title="快捷键与帮助">
          <IconInfo size={17} />
        </button>
        <a
          className="author-link"
          href={X_PROFILE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="作者 𝕏（X）主页：https://x.com/0xkillcoin"
          title="作者 𝕏：@0xkillcoin"
        >
          <span className="author-link__glyph" aria-hidden>
            𝕏
          </span>
          <span className="author-link__handle">@0xkillcoin</span>
        </a>
        <a
          className="icon-btn"
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub 仓库"
          title="GitHub 仓库"
        >
          <IconGithub size={17} />
        </a>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
        </button>
      </div>
    </header>
  );
}
