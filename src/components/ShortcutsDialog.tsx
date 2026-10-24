import { REPO_URL, X_PROFILE_URL } from './TopBar';
import { IconGithub, IconX } from './icons';
import { Modal } from './Modal';

export interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl/⌘', 'Z'], label: '撤销' },
  { keys: ['Ctrl/⌘', 'Shift', 'Z'], label: '重做' },
  { keys: ['Ctrl/⌘', 'F'], label: '查找与批量替换' },
  { keys: ['Ctrl/⌘', 'S'], label: '导出（打开导出对话框）' },
  { keys: ['Ctrl/⌘', 'O'], label: '导入文件' },
  { keys: ['Ctrl/⌘', 'V'], label: '在空白表格粘贴字幕文本' },
  { keys: ['Alt', '↑ / ↓'], label: '上一条 / 下一条字幕' },
  { keys: ['S'], label: '拆分当前字幕' },
  { keys: ['M'], label: '合并所选字幕' },
  { keys: ['Delete / Backspace'], label: '删除所选字幕' },
  { keys: ['↑ / ↓'], label: '在列表中移动选择（焦点在列表时）' },
  { keys: ['Shift', 'Click'], label: '连续多选' },
  { keys: ['Ctrl/⌘', 'Click'], label: '追加多选' },
  { keys: ['Ctrl/⌘', 'A'], label: '全选字幕（焦点在列表时）' },
  { keys: ['Esc'], label: '关闭对话框 / 取消输入' },
  { keys: ['?'], label: '打开这个帮助面板' },
];

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  return (
    <Modal
      open={open}
      title="快捷键与使用说明"
      subtitle="所有处理都在本地浏览器完成，不会上传任何字幕内容。"
      onClose={onClose}
      width={620}
      testId="shortcuts-dialog"
      footer={
        <>
          <span className="dialog__hint">作者 𝕏：@0xkillcoin</span>
          <div className="dialog__actions">
            <a className="btn" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              <IconGithub size={15} /> GitHub
            </a>
            <a className="btn btn--primary" href={X_PROFILE_URL} target="_blank" rel="noopener noreferrer">
              <IconX size={14} /> 关注作者
            </a>
          </div>
        </>
      }
    >
      <ul className="shortcuts">
        {SHORTCUTS.map((item) => (
          <li key={item.label} className="shortcuts__row">
            <span className="shortcuts__keys">
              {item.keys.map((key) => (
                <kbd key={key} className="kbd">
                  {key}
                </kbd>
              ))}
            </span>
            <span className="shortcuts__label">{item.label}</span>
          </li>
        ))}
      </ul>
      <div className="shortcuts__note">
        <h3>支持范围</h3>
        <p>
          完整支持 SRT 与 WebVTT（含 <code>WEBVTT</code> 头部、头部元数据、<code>NOTE</code> /
          <code>STYLE</code> / <code>REGION</code> 块、cue 设置与命名标识）。ASS/SSA、SUB、SMI 等格式不在支持范围内，
          会被当作纯文本处理并明确提示，而不是导出一个损坏的文件。
        </p>
        <h3>已知限制</h3>
        <p>
          未实现视频预览播放器；超大字幕文件（&gt;10 万条）在低端手机上可能变慢，但对 2 万条以内的文件已做虚拟滚动优化。
        </p>
      </div>
    </Modal>
  );
}
