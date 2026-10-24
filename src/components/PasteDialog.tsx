import { useEffect, useRef, useState } from 'react';
import { getSample, SAMPLES } from '../core/samples';
import { detectFormat } from '../core/parse';
import type { SubtitleFormat } from '../core/types';
import { IconAlert, IconCheck, IconPaste, IconUpload } from './icons';
import { Modal } from './Modal';

export interface PasteDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string, format: SubtitleFormat | 'auto', title?: string) => void;
  onLoadSample: (sampleId: string) => void;
}

const PLACEHOLDER = `1
00:00:01,000 --> 00:00:03,000
把字幕文本粘贴到这里

2
00:00:04,000 --> 00:00:06,000
支持 SRT 与 WebVTT`;

export function PasteDialog({ open, onClose, onSubmit, onLoadSample }: PasteDialogProps) {
  const [text, setText] = useState('');
  const [format, setFormat] = useState<SubtitleFormat | 'auto'>('auto');
  const [title, setTitle] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setTitle('');
      setFormat('auto');
      window.setTimeout(() => areaRef.current?.focus(), 80);
    }
  }, [open]);

  const detection = text.trim() === '' ? null : detectFormat(text);
  const cueGuess = (text.match(/-->/g) ?? []).length;

  return (
    <Modal
      open={open}
      title="粘贴字幕文本"
      subtitle="直接从播放器、聊天记录或字幕站复制的内容都可以粘贴进来。"
      onClose={onClose}
      width={760}
      testId="paste-dialog"
      footer={
        <>
          <span className="dialog__hint">
            {text.trim() === '' ? (
              <>
                <IconAlert size={13} /> 内容为空时无法解析
              </>
            ) : (
              '解析后可在列表里逐条编辑，任何修改都可撤销'
            )}
          </span>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={text.trim() === ''}
              onClick={() => {
                onSubmit(text, format, title.trim() === '' ? undefined : title.trim());
                onClose();
              }}
              data-testid="paste-submit"
            >
              解析字幕
            </button>
          </div>
        </>
      }
    >
      <div className="paste">
        <div className="paste__title">
          <IconPaste size={15} /> 粘贴区
        </div>
        <textarea
          ref={areaRef}
          className="textarea paste__area"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          data-testid="paste-textarea"
          aria-label="字幕文本"
        />

        <div className="paste__meta">
          <div className="paste__detect">
            {detection ? (
              <>
                <IconCheck size={14} />
                检测为 <strong>{detection.format.toUpperCase()}</strong>（{detection.reason}）
                <span className="dim"> · 约 {cueGuess} 条时间轴</span>
              </>
            ) : (
              <span className="dim">粘贴后会自动识别格式</span>
            )}
          </div>
          <div className="paste__controls">
            <div className="field">
              <label htmlFor="paste-format">按此格式解析</label>
              <select
                id="paste-format"
                className="select"
                value={format}
                onChange={(event) => setFormat(event.target.value as SubtitleFormat | 'auto')}
              >
                <option value="auto">自动识别</option>
                <option value="srt">SRT</option>
                <option value="vtt">WebVTT</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="paste-title">文件名（可选）</label>
              <input
                id="paste-title"
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="粘贴的字幕"
              />
            </div>
          </div>
        </div>

        <div className="paste__samples">
          <span className="field__label">或者直接加载示例：</span>
          <div className="paste__sample-list">
            {SAMPLES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                className="sample-card"
                onClick={() => {
                  onLoadSample(sample.id);
                  onClose();
                }}
              >
                <IconUpload size={14} />
                <span className="sample-card__label">{sample.label}</span>
                <span className="sample-card__desc">{sample.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function loadSampleText(id: string): { text: string; fileName: string } | null {
  const sample = getSample(id);
  if (!sample) return null;
  return { text: sample.content, fileName: sample.fileName };
}
