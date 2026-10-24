import { useMemo, useRef, useState } from 'react';
import { mergeBilingual, type MatchStrategy, type MergeReport } from '../core/bilingual';
import { parseSubtitles } from '../core/parse';
import { formatTimecode } from '../core/timecode';
import type { Doc } from '../core/types';
import { readTextFile } from '../lib/files';
import { IconAlert, IconCheck, IconLanguages, IconUpload } from './icons';
import { Modal } from './Modal';

export interface BilingualDialogProps {
  open: boolean;
  doc: Doc;
  onClose: () => void;
  onApply: (secondary: Doc, options: Parameters<typeof mergeBilingual>[2]) => void;
}

type Source = 'file' | 'paste';

export function BilingualDialog({ open, doc, onClose, onApply }: BilingualDialogProps) {
  const [strategy, setStrategy] = useState<MatchStrategy>('overlap');
  const [minRatio, setMinRatio] = useState(20);
  const [maxDistance, setMaxDistance] = useState(2000);
  const [keepUnmatched, setKeepUnmatched] = useState(true);
  const [secondaryDoc, setSecondaryDoc] = useState<Doc | null>(null);
  const [secondaryName, setSecondaryName] = useState('');
  const [source, setSource] = useState<Source>('file');
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const options = useMemo(
    () => ({
      strategy,
      minOverlapRatio: minRatio / 100,
      maxStartDistanceMs: maxDistance,
      keepUnmatched,
      unmatchedPosition: 'end' as const,
    }),
    [strategy, minRatio, maxDistance, keepUnmatched],
  );

  const preview = useMemo<{ doc: Doc; report: MergeReport } | null>(() => {
    if (!secondaryDoc) return null;
    return mergeBilingual(doc, secondaryDoc, options);
  }, [doc, secondaryDoc, options]);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { text, fileName } = await readTextFile(file);
      const parsed = parseSubtitles(text, { fileName, source: 'file' });
      if (parsed.cues.length === 0) {
        setError('这个文件里没有解析到字幕，无法作为副轨使用');
        setSecondaryDoc(null);
      } else {
        setSecondaryDoc(parsed);
        setSecondaryName(fileName);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件读取失败');
    } finally {
      setBusy(false);
    }
  };

  const handlePaste = () => {
    setError(null);
    if (pasted.trim() === '') {
      setError('请先粘贴副轨字幕文本');
      return;
    }
    const parsed = parseSubtitles(pasted, { title: '粘贴的副轨' });
    if (parsed.cues.length === 0) {
      setError('粘贴的内容里没有可识别的字幕');
      setSecondaryDoc(null);
      return;
    }
    setSecondaryDoc(parsed);
    setSecondaryName('粘贴的副轨');
  };

  return (
    <Modal
      open={open}
      title="双语字幕合并"
      subtitle="副轨只用来提供译文，主轨的时间轴不会被修改。"
      onClose={onClose}
      width={880}
      testId="bilingual-dialog"
      footer={
        <>
          <span className="dialog__hint">
            {preview
              ? `预计配对 ${preview.report.matchedCount} / ${preview.report.primaryCount} 条`
              : '先提供副轨字幕文件或粘贴文本'}
          </span>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!secondaryDoc || !preview || preview.report.matchedCount === 0}
              onClick={() => {
                if (secondaryDoc) {
                  onApply(secondaryDoc, options);
                  onClose();
                }
              }}
              data-testid="bilingual-apply"
            >
              应用合并
            </button>
          </div>
        </>
      }
    >
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={source === 'file'}
          className={`tabs__tab${source === 'file' ? ' is-active' : ''}`}
          onClick={() => setSource('file')}
        >
          上传副轨文件
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === 'paste'}
          className={`tabs__tab${source === 'paste' ? ' is-active' : ''}`}
          onClick={() => setSource('paste')}
        >
          粘贴副轨文本
        </button>
      </div>

      {source === 'file' ? (
        <div
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
        >
          <IconUpload size={22} />
          <p className="dropzone__title">拖入副轨字幕文件，或点击选择</p>
          <p className="dim">支持 .srt / .vtt，与主轨同语言或另一种语言都可以</p>
          <button type="button" className="btn btn--primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? '读取中…' : '选择文件'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".srt,.vtt,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.target.value = '';
            }}
          />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="bilingual-paste">副轨文本</label>
          <textarea
            id="bilingual-paste"
            className="textarea"
            rows={6}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder={'1\n00:00:01,000 --> 00:00:03,000\n第二语言字幕'}
            spellCheck={false}
          />
          <button type="button" className="btn btn--sm" onClick={handlePaste} style={{ alignSelf: 'flex-start' }}>
            <IconCheck size={13} /> 解析这段文本
          </button>
        </div>
      )}

      {error ? (
        <p className="alert alert--error">
          <IconAlert size={14} /> {error}
        </p>
      ) : null}

      {secondaryDoc ? (
        <p className="alert alert--ok">
          <IconLanguages size={14} /> 副轨已解析：{secondaryName} · {secondaryDoc.cues.length} 条字幕（
          {secondaryDoc.format.toUpperCase()}）
        </p>
      ) : null}

      <div className="bilingual__options">
        <div className="field">
          <label htmlFor="bilingual-strategy">配对规则</label>
          <select
            id="bilingual-strategy"
            className="select"
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as MatchStrategy)}
          >
            <option value="overlap">按时间重叠</option>
            <option value="index">按字幕序号</option>
            <option value="nearest-start">按开始时间最接近</option>
          </select>
        </div>
        {strategy === 'overlap' ? (
          <div className="field">
            <label htmlFor="bilingual-ratio">最小重叠比例：{minRatio}%</label>
            <input
              id="bilingual-ratio"
              type="range"
              min={0}
              max={100}
              step={5}
              value={minRatio}
              onChange={(event) => setMinRatio(Number(event.target.value))}
            />
          </div>
        ) : null}
        {strategy === 'nearest-start' ? (
          <div className="field">
            <label htmlFor="bilingual-distance">最大起始时间差（ms）</label>
            <input
              id="bilingual-distance"
              className="input input--mono"
              type="number"
              min={0}
              step={100}
              value={maxDistance}
              onChange={(event) => setMaxDistance(Number(event.target.value))}
            />
          </div>
        ) : null}
        <label className="switch bilingual__keep">
          <input
            type="checkbox"
            checked={keepUnmatched}
            onChange={(event) => setKeepUnmatched(event.target.checked)}
          />
          <span>保留未匹配的副轨字幕（追加到末尾，正文放在译文行）</span>
        </label>
      </div>

      {preview ? (
        <div className="bilingual__preview">
          <div className="bilingual__stats">
            <span className="chip chip--ok">已配对 {preview.report.matchedCount}</span>
            <span className="chip chip--warn">主轨未配对 {preview.report.unmatchedPrimary}</span>
            <span className="chip chip--warn">副轨未使用 {preview.report.unmatchedSecondary}</span>
            <span className="chip">合并后 {preview.doc.cues.length} 条</span>
          </div>
          <ul className="bilingual__list" data-testid="bilingual-preview">
            {preview.doc.cues.slice(0, 60).map((cue, index) => (
              <li key={cue.id} className={`bilingual__row${cue.secondary ? '' : ' is-unmatched'}`}>
                <span className="bilingual__num mono">#{index + 1}</span>
                <span className="bilingual__time mono">
                  {formatTimecode(cue.start)} → {formatTimecode(cue.end)}
                </span>
                <span className="bilingual__texts">
                  <span className="bilingual__primary">{cue.text || <em className="dim">（空）</em>}</span>
                  <span className="bilingual__secondary">
                    {cue.secondary ?? <em className="dim">未匹配</em>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {preview.doc.cues.length > 60 ? (
            <p className="dim bilingual__more">仅预览前 60 条，应用后可在右侧编辑面板逐条微调。</p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
