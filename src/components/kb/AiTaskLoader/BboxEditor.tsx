import { useCallback, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ImageBbox } from '@/lib/kbAiExtractApi';

/**
 * Редактор рамки кропа (волна 2, 2026-07-11): AI предложил bbox рисунка —
 * тутор двигает/растягивает рамку поверх исходного изображения.
 *
 * Pointer Events + setPointerCapture — единый код мышь/тач (Safari 13+, rule 80);
 * `touch-action: none` на оверлее (иначе iOS скроллит вместо драга). Координаты
 * рамки — нормализованные доли 0..1 → редактор не зависит от отображаемого
 * размера. Без внешних либ (react-image-crop потребовал бы approve зависимости).
 */

interface BboxEditorProps {
  /** Signed URL исходного изображения. */
  imageUrl: string;
  /** Начальная рамка (доли 0..1). */
  initialBbox: ImageBbox;
  onConfirm: (bbox: ImageBbox) => void;
  onCancel: () => void;
}

type DragMode =
  | { kind: 'move'; startX: number; startY: number; startBbox: ImageBbox }
  | { kind: 'resize'; handle: string; startX: number; startY: number; startBbox: ImageBbox };

/** Минимальная сторона рамки (доли) — зеркало edge MIN_BBOX_SIDE. */
const MIN_SIDE = 0.03;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function applyDrag(mode: DragMode, dx: number, dy: number): ImageBbox {
  const b = mode.startBbox;
  if (mode.kind === 'move') {
    return {
      x: clamp01(Math.min(b.x + dx, 1 - b.w)),
      y: clamp01(Math.min(b.y + dy, 1 - b.h)),
      w: b.w,
      h: b.h,
    };
  }
  // resize: handle = combination of n/s/w/e
  let { x, y, w, h } = b;
  if (mode.handle.includes('w')) {
    const newX = clamp01(Math.min(b.x + dx, b.x + b.w - MIN_SIDE));
    w = b.w + (b.x - newX);
    x = newX;
  }
  if (mode.handle.includes('e')) {
    w = Math.max(MIN_SIDE, Math.min(b.w + dx, 1 - b.x));
  }
  if (mode.handle.includes('n')) {
    const newY = clamp01(Math.min(b.y + dy, b.y + b.h - MIN_SIDE));
    h = b.h + (b.y - newY);
    y = newY;
  }
  if (mode.handle.includes('s')) {
    h = Math.max(MIN_SIDE, Math.min(b.h + dy, 1 - b.y));
  }
  return { x, y, w, h };
}

/** 4 угла + 4 стороны; позиционные классы для хендлов ≥24px (touch-таргеты). */
const HANDLES: Array<{ id: string; className: string; cursor: string }> = [
  { id: 'nw', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { id: 'ne', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { id: 'sw', className: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { id: 'se', className: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { id: 'n', className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'ns-resize' },
  { id: 's', className: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'ns-resize' },
  { id: 'w', className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { id: 'e', className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

export function BboxEditor({ imageUrl, initialBbox, onConfirm, onCancel }: BboxEditorProps) {
  const [bbox, setBbox] = useState<ImageBbox>(initialBbox);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);

  const startDrag = useCallback(
    (e: React.PointerEvent, mode: 'move' | string) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current =
        mode === 'move'
          ? { kind: 'move', startX: e.clientX, startY: e.clientY, startBbox: bbox }
          : { kind: 'resize', handle: mode, startX: e.clientX, startY: e.clientY, startBbox: bbox };
    },
    [bbox],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    setBbox(applyDrag(drag, dx, dy));
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div className="fixed inset-0 z-[320] flex flex-col items-center justify-center bg-black/70 p-4">
      <p className="mb-2 text-center text-sm font-medium text-white">
        Выделите рамкой рисунок задачи — лишнее будет обрезано
      </p>

      <div
        ref={containerRef}
        className="relative max-h-[70vh] max-w-full select-none overflow-hidden rounded-lg"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ touchAction: 'none' }}
      >
        <img
          src={imageUrl}
          alt="Исходное изображение"
          draggable={false}
          className="block max-h-[70vh] max-w-full"
        />

        {/* Затемнение вне рамки — 4 полосы вокруг bbox. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 bg-black/50"
          style={{ height: `${bbox.y * 100}%` }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/50"
          style={{ height: `${(1 - bbox.y - bbox.h) * 100}%` }}
        />
        <div
          className="pointer-events-none absolute left-0 bg-black/50"
          style={{ top: `${bbox.y * 100}%`, height: `${bbox.h * 100}%`, width: `${bbox.x * 100}%` }}
        />
        <div
          className="pointer-events-none absolute right-0 bg-black/50"
          style={{ top: `${bbox.y * 100}%`, height: `${bbox.h * 100}%`, width: `${(1 - bbox.x - bbox.w) * 100}%` }}
        />

        {/* Рамка: тело = перемещение, хендлы = ресайз. */}
        <div
          className="absolute cursor-move border-2 border-socrat-primary"
          style={{
            left: `${bbox.x * 100}%`,
            top: `${bbox.y * 100}%`,
            width: `${bbox.w * 100}%`,
            height: `${bbox.h * 100}%`,
          }}
          onPointerDown={(e) => startDrag(e, 'move')}
        >
          {HANDLES.map((h) => (
            <span
              key={h.id}
              onPointerDown={(e) => startDrag(e, h.id)}
              className={`absolute h-6 w-6 rounded-full border-2 border-socrat-primary bg-white ${h.className}`}
              style={{ cursor: h.cursor }}
            />
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onConfirm(bbox)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-socrat-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-socrat-primary-dark [touch-action:manipulation]"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Применить рамку
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/40 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 [touch-action:manipulation]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Отмена
        </button>
      </div>
    </div>
  );
}
