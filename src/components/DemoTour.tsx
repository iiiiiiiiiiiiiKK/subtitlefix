import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TOUR_STEPS, type DemoTab } from '../core/demo';
import { IconArrowLeft, IconArrowRight, IconCheck, IconPlay, IconX } from './icons';
import { Modal } from './Modal';

export interface DemoTourProps {
  open: boolean;
  step: number;
  /** Runs a step's side effect. Must be idempotent per step index. */
  onRunAction: (index: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onFinish: () => void;
  onSkip: () => void;
  /** Phones/tablets show one pane at a time, so the tour drives the tab bar. */
  onShowTab: (tab: DemoTab) => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 380;
const GAP = 14;
const PAD = 6;

/**
 * Coach-mark tour.
 *
 * Places a spotlight over the element referenced by the current step and shows a
 * card next to it. Everything is positioned from measured rects, so it survives
 * scroll, resize, responsive breakpoints and the virtualised cue list.
 */
export function DemoTour({
  open,
  step,
  onRunAction,
  onNext,
  onPrev,
  onFinish,
  onSkip,
  onShowTab,
}: DemoTourProps) {
  const current = TOUR_STEPS[step];
  const cardRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ width: CARD_WIDTH, height: 220 });
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });

  const measure = useCallback(() => {
    setViewport((prev) => {
      const next = { width: window.innerWidth, height: window.innerHeight };
      return prev.width === next.width && prev.height === next.height ? prev : next;
    });
    if (!current?.target) {
      setRect((prev) => (prev === null ? prev : null));
      return;
    }
    const el = document.querySelector(current.target);
    if (!el) {
      setRect((prev) => (prev === null ? prev : null));
      return;
    }
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) {
      setRect((prev) => (prev === null ? prev : null));
      return;
    }
    const nextRect = {
      top: Math.round(box.top),
      left: Math.round(box.left),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
    setRect((prev) =>
      prev &&
      prev.top === nextRect.top &&
      prev.left === nextRect.left &&
      prev.width === nextRect.width &&
      prev.height === nextRect.height
        ? prev
        : nextRect,
    );
  }, [current?.target]);

  // Reveal the right pane first (phones), then measure once layout settled.
  useEffect(() => {
    if (!open || !current) return;
    onShowTab(current.tab);
    const timer = window.setTimeout(() => {
      const el = current.target ? document.querySelector(current.target) : null;
      // jsdom (and older browsers) may not implement scrollIntoView.
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      measure();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open, step, current, onShowTab, measure]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    const observer = new ResizeObserver(() => measure());
    const el = current?.target ? document.querySelector(current.target) : null;
    if (el) observer.observe(el);
    // The spotlight must follow layout changes the tour does not control (app
    // state updates, pane switches, the virtualised list re-rendering).
    const poll = window.setInterval(measure, 350);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      observer.disconnect();
      window.clearInterval(poll);
    };
  }, [open, measure, current?.target]);

  // The action for a step fires exactly once, after the pane is visible.
  const ranStep = useRef<number | null>(null);
  useEffect(() => {
    if (!open || !current) return;
    if (ranStep.current === step) return;
    ranStep.current = step;
    onRunAction(step);
  }, [open, step, current, onRunAction]);

  useLayoutEffect(() => {
    if (cardRef.current) {
      const box = cardRef.current.getBoundingClientRect();
      setCardSize({ width: box.width, height: box.height });
    }
  }, [open, step]);

  // Keyboard: ← → to move, Esc to skip.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
      } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        if (step >= TOUR_STEPS.length - 1) onFinish();
        else onNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onPrev();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, step, onNext, onPrev, onFinish, onSkip]);

  const layout = useMemo(() => {
    const isNarrow = viewport.width <= 760;
    if (!rect || isNarrow) {
      return {
        mode: 'centered' as const,
        style: isNarrow
          ? { left: '50%', bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))', transform: 'translateX(-50%)' }
          : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' },
      };
    }

    const below = rect.top + rect.height + GAP;
    const spaceBelow = viewport.height - below;
    const spaceAbove = rect.top - GAP;
    const width = Math.min(CARD_WIDTH, viewport.width - 24);
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), viewport.width - width - 12);

    if (spaceBelow >= cardSize.height + 12 || spaceBelow >= spaceAbove) {
      return {
        mode: 'anchored' as const,
        style: {
          left,
          width,
          top: Math.min(below, Math.max(12, viewport.height - cardSize.height - 12)),
        },
      };
    }
    return {
      mode: 'anchored' as const,
      style: {
        left,
        width,
        top: Math.max(12, rect.top - cardSize.height - GAP),
      },
    };
  }, [rect, viewport, cardSize.height]);

  if (!open || !current) return null;

  const isFirst = step === 0;
  const isLast = step === TOUR_STEPS.length - 1;
  const progress = ((step + 1) / TOUR_STEPS.length) * 100;

  return (
    <div className="tour" role="dialog" aria-label="功能演示" data-testid="demo-tour">
      {/* Spotlight: the hole is created by a huge outer shadow. */}
      {rect && layout.mode === 'anchored' ? (
        <div
          className="tour__spotlight"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
          aria-hidden
        />
      ) : (
        <div className="tour__scrim" aria-hidden />
      )}

      <div
        ref={cardRef}
        className={`tour__card tour__card--${layout.mode}`}
        style={layout.style}
        data-testid="demo-tour-card"
      >
        <div className="tour__progress" aria-hidden>
          <span style={{ width: `${progress}%` }} />
        </div>

        <header className="tour__head">
          <span className="tour__badge">
            演示 {step + 1}/{TOUR_STEPS.length}
          </span>
          <button type="button" className="icon-btn" onClick={onSkip} aria-label="退出演示">
            <IconX size={15} />
          </button>
        </header>

        <h2 className="tour__title" data-testid="demo-tour-title">
          {current.title}
        </h2>
        <p className="tour__body">{current.body}</p>

        {current.did ? (
          <p className="tour__did" data-testid="demo-tour-did">
            <IconCheck size={14} /> {current.did}
          </p>
        ) : null}

        <footer className="tour__foot">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onSkip}>
            跳过演示
          </button>
          <div className="tour__nav">
            <button
              type="button"
              className="btn btn--sm"
              onClick={onPrev}
              disabled={isFirst}
              aria-label="上一步"
            >
              <IconArrowLeft size={14} /> 上一步
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={isLast ? onFinish : onNext}
              data-testid="demo-tour-next"
            >
              {isLast ? '开始用我自己的字幕' : current.cta ?? '下一步'}
              {isLast ? null : <IconArrowRight size={14} />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export interface DemoConfirmProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Shown when the demo is requested while the user already has their own
 * subtitles open: the tour loads its own document, so consent is required.
 */
export function DemoConfirm({ open, onCancel, onConfirm }: DemoConfirmProps) {
  return (
    <Modal
      open={open}
      title="要打开演示吗？"
      subtitle="演示会载入一份示例字幕，替换当前工作表的内容（可用 Ctrl+Z 撤销）。"
      onClose={onCancel}
      width={520}
      testId="demo-confirm"
      footer={
        <>
          <span className="dialog__hint">你的文件不会被上传或删除，只是被示例替换。</span>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              继续编辑我的字幕
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={onConfirm}
              data-testid="demo-confirm-yes"
            >
              <IconPlay size={14} /> 打开演示
            </button>
          </div>
        </>
      }
    >
      <ul className="tour__confirm-list">
        <li>演示用的是一份故意弄坏的示例字幕，共 8 条。</li>
        <li>它会现场演示：修时间倒序、裁掉重叠、重排编号、导出前看差异。</li>
        <li>演示结束后可以撤销回到你原来的内容。</li>
      </ul>
    </Modal>
  );
}
