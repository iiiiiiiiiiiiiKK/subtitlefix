import { useEffect, useState } from 'react';
import { IconArrowLeft, IconArrowRight, IconClock, IconCopy, IconDownload, IconLanguages, IconMerge, IconPaste, IconPlay, IconRedo, IconSearch, IconSplit, IconTrash, IconUndo, IconUpload, IconWand } from './icons';

export interface ToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  hasCues: boolean;
  selectedCount: number;
  disabled?: boolean;
  onImportFile: () => void;
  onDemo: () => void;
  onPaste: () => void;
  onSearch: () => void;
  onBilingual: () => void;
  onSplit: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onFixAll: () => void;
  onShift: (deltaMs: number, scope: 'all' | 'selection') => void;
  onNormalize: () => void;
  onCopy: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const QUICK_STEPS = [-5000, -1000, -100, -10, 10, 100, 1000, 5000];

export function Toolbar(props: ToolbarProps) {
  const [shift, setShift] = useState('100');
  const [unit, setUnit] = useState<'ms' | 's'>('ms');
  const [scope, setScope] = useState<'all' | 'selection'>('all');
  const [shiftError, setShiftError] = useState<string | null>(null);

  useEffect(() => {
    if (props.selectedCount > 0 && scope === 'selection') return;
    if (props.selectedCount === 0 && scope === 'selection') setScope('all');
  }, [props.selectedCount, scope]);

  const applyShift = (sign: 1 | -1) => {
    const value = Number(shift);
    if (!Number.isFinite(value) || value <= 0) {
      setShiftError('请输入大于 0 的数值');
      return;
    }
    setShiftError(null);
    const delta = Math.round((unit === 's' ? value * 1000 : value) * sign);
    props.onShift(delta, props.selectedCount > 0 ? scope : 'all');
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="字幕操作工具栏">
      <div className="toolbar__group">
        <button type="button" className="btn" onClick={props.onImportFile} data-testid="btn-import">
          <IconUpload size={16} /> 导入
        </button>
        <button
          type="button"
          className="btn btn--demo"
          onClick={props.onDemo}
          title="用一个故意弄坏的示例字幕，走一遍完整修复流程"
          data-testid="btn-demo"
        >
          <IconPlay size={15} /> 演示
        </button>
        <button type="button" className="btn" onClick={props.onPaste}>
          <IconPaste size={16} /> 粘贴
        </button>
        <button type="button" className="btn" onClick={props.onSearch} data-testid="btn-search">
          <IconSearch size={16} /> 查找替换
        </button>
        <button type="button" className="btn" onClick={props.onBilingual} data-testid="btn-bilingual">
          <IconLanguages size={16} /> 双语合并
        </button>
      </div>

      <div className="divider" />

      <div className="toolbar__group">
        <button
          type="button"
          className="btn"
          onClick={props.onSplit}
          disabled={!props.hasCues}
          title="拆分当前字幕（快捷键 S）"
        >
          <IconSplit size={16} /> 拆分
        </button>
        <button
          type="button"
          className="btn"
          onClick={props.onMerge}
          disabled={props.selectedCount < 2}
          title="合并所选字幕（需相邻）"
          data-testid="btn-merge"
        >
          <IconMerge size={16} /> 合并
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={props.onDelete}
          disabled={props.selectedCount === 0}
          title="删除所选字幕（Delete）"
        >
          <IconTrash size={16} /> 删除
        </button>
      </div>

      <div className="divider" />

      <div className="toolbar__group toolbar__group--shift">
        <span className="toolbar__label">
          <IconClock size={14} /> 时间平移
        </span>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => applyShift(-1)}
          title="按输入值提前"
          data-testid="btn-shift-earlier"
        >
          <IconArrowLeft size={14} /> 提前
        </button>
        <input
          className={`input input--mono toolbar__shift-input${shiftError ? ' input--invalid' : ''}`}
          value={shift}
          onChange={(event) => {
            setShift(event.target.value);
            setShiftError(null);
          }}
          inputMode="decimal"
          aria-label="平移数值"
          aria-invalid={shiftError !== null}
          title={shiftError ?? '平移数值'}
          data-testid="input-shift-value"
        />
        <select
          className="select toolbar__unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value as 'ms' | 's')}
          aria-label="平移单位"
        >
          <option value="ms">ms</option>
          <option value="s">秒</option>
        </select>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => applyShift(1)}
          title="按输入值延后"
          data-testid="btn-shift-later"
        >
          延后 <IconArrowRight size={14} />
        </button>
        <select
          className="select toolbar__scope"
          value={props.selectedCount > 0 ? scope : 'all'}
          onChange={(event) => setScope(event.target.value as 'all' | 'selection')}
          aria-label="平移范围"
          disabled={props.selectedCount === 0}
        >
          <option value="all">全部字幕</option>
          <option value="selection">仅选中（{props.selectedCount}）</option>
        </select>
        <button type="button" className="btn btn--sm btn--ghost" onClick={props.onNormalize} title="把最早的字幕对齐到 00:00">
          对齐 0
        </button>
        <div className="toolbar__quick" aria-label="快捷平移">
          {QUICK_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              className="quick-shift"
              onClick={() => props.onShift(step, props.selectedCount > 0 ? scope : 'all')}
              title={`${step > 0 ? '+' : ''}${step}ms`}
            >
              {step > 0 ? `+${step}` : step}
            </button>
          ))}
        </div>
      </div>

      <div className="divider" />

      <div className="toolbar__group">
        <button type="button" className="btn" onClick={props.onFixAll} data-testid="btn-fix">
          <IconWand size={16} /> 一键修复
        </button>
      </div>

      <div className="toolbar__spacer" />

      <div className="toolbar__group">
        <button
          type="button"
          className="icon-btn"
          onClick={props.onUndo}
          disabled={!props.canUndo}
          title="撤销（Ctrl+Z）"
          aria-label="撤销"
          data-testid="btn-undo"
        >
          <IconUndo size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={props.onRedo}
          disabled={!props.canRedo}
          title="重做（Ctrl+Shift+Z）"
          aria-label="重做"
          data-testid="btn-redo"
        >
          <IconRedo size={17} />
        </button>
        <button type="button" className="btn" onClick={props.onCopy} disabled={!props.hasCues} title="复制当前格式文本">
          <IconCopy size={16} /> 复制
        </button>
        <button type="button" className="btn btn--primary" onClick={props.onExport} disabled={!props.hasCues} data-testid="btn-export">
          <IconDownload size={16} /> 导出
        </button>
      </div>
    </div>
  );
}
