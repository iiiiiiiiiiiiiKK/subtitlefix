import { useEffect, useMemo, useState } from 'react';
import { diffText, type DocDiff } from '../core/diff';
import { formatTimecode } from '../core/timecode';
import type { Doc, SubtitleFormat } from '../core/types';
import { IconAlert, IconCheck, IconDownload } from './icons';
import { Modal } from './Modal';

export interface ExportDialogProps {
  open: boolean;
  doc: Doc;
  diff: DocDiff;
  onClose: () => void;
  onExport: (options: { format: SubtitleFormat; newline: '\n' | '\r\n'; bom: boolean; includeSecondary: boolean }) => void;
  suggestedName: (format: SubtitleFormat) => string;
}

export function ExportDialog({ open, doc, diff, onClose, onExport, suggestedName }: ExportDialogProps) {
  const [format, setFormat] = useState<SubtitleFormat>(doc.format);
  const [newline, setNewline] = useState<'\n' | '\r\n'>(doc.meta.newline === 'crlf' ? '\r\n' : '\n');
  const [bom, setBom] = useState(doc.meta.bom);
  const [includeSecondary, setIncludeSecondary] = useState(doc.bilingual.enabled);
  const [showChanges, setShowChanges] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormat(doc.format);
    setNewline(doc.meta.newline === 'crlf' ? '\r\n' : '\n');
    setBom(false);
    setIncludeSecondary(doc.bilingual.enabled);
  }, [open, doc.format, doc.meta.newline, doc.bilingual.enabled]);

  const changed = useMemo(
    () => diff.cues.filter((row) => row.status !== 'unchanged'),
    [diff],
  );

  const hazards = useMemo(() => {
    const list: string[] = [];
    if (format === 'srt' && doc.cues.some((cue) => cue.settings)) {
      list.push('有字幕带有 WebVTT cue 设置，导出为 SRT 时会被丢弃（预览里已提示）。');
    }
    if (format === 'srt' && doc.meta.vttBlocks.length > 0) {
      list.push(
        `${doc.meta.vttBlocks.length} 个 NOTE/STYLE/REGION 块会以 "# " 注释形式写入 SRT，播放器可能直接显示。`,
      );
    }
    if (doc.cues.some((cue) => cue.start < 0 || cue.end < 0)) {
      list.push('仍有负时间字幕，部分播放器会拒绝加载。建议先使用「整体平移至 ≥ 0」。');
    }
    if (doc.cues.some((cue) => cue.start > cue.end)) {
      list.push('仍有开始时间晚于结束时间的字幕，导出后可能出现空白。');
    }
    if (format === 'vtt' && !doc.meta.vttHeader.trim()) {
      list.push('将自动补写 WEBVTT 头部。');
    }
    return list;
  }, [format, doc]);

  return (
    <Modal
      open={open}
      title="导出字幕"
      subtitle="导出前会展示与原始导入文件的差异，避免静默丢字。"
      onClose={onClose}
      width={800}
      testId="export-dialog"
      footer={
        <>
          <span className="dialog__hint">
            {diff.noTextLost ? (
              <>
                <IconCheck size={13} /> 没有字幕正文丢失
              </>
            ) : (
              <>
                <IconAlert size={13} /> 有 {diff.lostCues.length} 条字幕正文将不会出现在导出文件中
              </>
            )}
          </span>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onExport({ format, newline, bom, includeSecondary })}
              data-testid="export-confirm"
            >
              <IconDownload size={15} /> 下载 {suggestedName(format)}
            </button>
          </div>
        </>
      }
    >
      <div className="export__grid">
        <div className="field">
          <label htmlFor="export-format">输出格式</label>
          <select
            id="export-format"
            className="select"
            value={format}
            onChange={(event) => setFormat(event.target.value as SubtitleFormat)}
            data-testid="export-format"
          >
            <option value="srt">SRT（SubRip，逗号毫秒）</option>
            <option value="vtt">WebVTT（点号毫秒 + WEBVTT 头）</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="export-newline">换行符</label>
          <select
            id="export-newline"
            className="select"
            value={newline === '\r\n' ? 'crlf' : 'lf'}
            onChange={(event) => setNewline(event.target.value === 'crlf' ? '\r\n' : '\n')}
          >
            <option value="lf">LF（\n，跨平台推荐）</option>
            <option value="crlf">CRLF（\r\n，Windows 老播放器）</option>
          </select>
        </div>
        <label className="switch">
          <input type="checkbox" checked={bom} onChange={(event) => setBom(event.target.checked)} />
          <span>写入 UTF-8 BOM</span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={includeSecondary}
            onChange={(event) => setIncludeSecondary(event.target.checked)}
            disabled={!doc.cues.some((cue) => cue.secondary)}
          />
          <span>包含双语译文行</span>
        </label>
      </div>

      <div className="export__summary">
        <div className="export__stat">
          <span className="export__stat-value mono">{diff.beforeCount}</span>
          <span className="export__stat-label">导入时条数</span>
        </div>
        <div className="export__stat">
          <span className="export__stat-value mono">{diff.afterCount}</span>
          <span className="export__stat-label">当前条数</span>
        </div>
        <div className="export__stat">
          <span className={`export__stat-value mono${diff.textChanged > 0 ? ' is-changed' : ''}`}>
            {diff.textChanged}
          </span>
          <span className="export__stat-label">正文修改</span>
        </div>
        <div className="export__stat">
          <span className={`export__stat-value mono${diff.timingChanged > 0 ? ' is-changed' : ''}`}>
            {diff.timingChanged}
          </span>
          <span className="export__stat-label">时间轴修改</span>
        </div>
        <div className="export__stat">
          <span className={`export__stat-value mono${diff.removed > 0 ? ' is-danger' : ''}`}>{diff.removed}</span>
          <span className="export__stat-label">删除条数</span>
        </div>
        <div className="export__stat">
          <span className={`export__stat-value mono${diff.added > 0 ? ' is-changed' : ''}`}>{diff.added}</span>
          <span className="export__stat-label">新增条数</span>
        </div>
      </div>

      <div className="export__chars">
        <span>
          正文字符：{diff.beforeChars} → {diff.afterChars}
          {diff.afterChars < diff.beforeChars ? (
            <span className="export__charwarn"> （少了 {diff.beforeChars - diff.afterChars} 个字符）</span>
          ) : null}
        </span>
        <button type="button" className="btn btn--sm" onClick={() => setShowChanges((value) => !value)}>
          {showChanges ? '收起差异' : `查看差异（${changed.length} 条）`}
        </button>
      </div>

      {!diff.noTextLost ? (
        <div className="alert alert--error">
          <IconAlert size={14} />
          <div>
            <strong>有正文会丢失</strong>
            <ul className="export__lost">
              {diff.lostCues.slice(0, 5).map((cue) => (
                <li key={cue.number}>
                  #{cue.number}：{cue.text.slice(0, 60)}
                </li>
              ))}
            </ul>
            确认要导出吗？这一步无法在文件层面撤销。
          </div>
        </div>
      ) : null}

      {hazards.length > 0 ? (
        <div className="alert alert--warn">
          <IconAlert size={14} />
          <div>
            <strong>格式转换注意事项</strong>
            <ul className="export__lost">
              {hazards.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {showChanges ? (
        <ul className="export__diff" data-testid="export-diff">
          {changed.slice(0, 120).map((row, index) => (
            <li key={`${row.beforeNumber}-${index}`} className={`diff-row diff-row--${row.status}`}>
              <span className="diff-row__num mono">
                {row.status === 'removed' ? `−#${row.beforeNumber}` : row.status === 'added' ? `+#${row.afterNumber}` : `#${row.afterNumber}`}
              </span>
              <span className="diff-row__time mono">
                {row.afterStart !== null
                  ? `${formatTimecode(row.beforeStart)} → ${formatTimecode(row.afterStart!)}`
                  : `${formatTimecode(row.beforeStart)} → 已删除`}
              </span>
              <span className="diff-row__text">
                {row.status === 'text-changed' || row.status === 'both-changed' ? (
                  diffText(row.beforeText, row.afterText).map((segment, segIndex) => (
                    <span key={segIndex} className={`dtext dtext--${segment.type}`}>
                      {segment.value}
                    </span>
                  ))
                ) : row.status === 'removed' ? (
                  <span className="dtext dtext--removed">{row.beforeText}</span>
                ) : row.status === 'added' ? (
                  <span className="dtext dtext--added">{row.afterText}</span>
                ) : (
                  <span className="dim">时间轴调整</span>
                )}
              </span>
            </li>
          ))}
          {changed.length > 120 ? <li className="dim">仅显示前 120 条差异</li> : null}
        </ul>
      ) : null}
    </Modal>
  );
}
