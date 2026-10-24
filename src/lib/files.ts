/** Browser-side file helpers: reading, downloading and clipboard fallbacks. */

export const MAX_SAFE_FILE_BYTES = 40 * 1024 * 1024;

export interface ReadResult {
  text: string;
  fileName: string;
  size: number;
}

export function readTextFile(file: File): Promise<ReadResult> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_SAFE_FILE_BYTES) {
      reject(new Error(`文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），上限为 40MB`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败，可能已被其他程序占用'));
    reader.onload = () => {
      const buffer = reader.result;
      if (!(buffer instanceof ArrayBuffer)) {
        reject(new Error('无法读取文件内容'));
        return;
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      } catch {
        reject(new Error('文件编码无法识别，请另存为 UTF-8 后重试'));
        return;
      }
      // A UTF-16 file decodes to text full of NUL characters; detect and retry.
      if (text.includes('\u0000')) {
        try {
          text = new TextDecoder('utf-16le').decode(buffer);
        } catch {
          /* keep the UTF-8 attempt */
        }
      }
      resolve({ text, fileName: file.name, size: file.size });
    };
    reader.readAsArrayBuffer(file);
  });
}

export function downloadText(fileName: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give Safari a tick before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function isSubtitleFileName(name: string): boolean {
  return /\.(srt|vtt|txt|sbv)$/i.test(name);
}
