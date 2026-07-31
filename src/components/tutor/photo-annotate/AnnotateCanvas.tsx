/**
 * Холст разметки поверх фото (волна 2, план 1-ancient-quokka).
 *
 * ⚠️ Это НЕ форк `BoardCanvas` (1500 строк рамок, зон, живых курсоров и
 * совместного синка). Здесь один кадр и ноль совместности, поэтому переиспользуем
 * только чистое: геометрию штриха (`perfect-freehand` через `svg.ts`), модель
 * элементов и историю (`SceneHistory`). Инварианты ввода повторены сознательно,
 * потому что они куплены багами доски:
 *
 *  • живой штрих живёт в ref и рисуется в rAF — максимум один setState за кадр,
 *    иначе на iPad перо заметно отстаёт от пальца;
 *  • нажим учитывается ТОЛЬКО для `pointerType === 'pen'`; палец и мышь дают
 *    константу, иначе толщина «гуляет»;
 *  • пинч требует, чтобы ОБА указателя были `touch` — так ладонь, легшая рядом
 *    со стилусом, не превращает рисование в масштабирование;
 *  • ластик копит попадания и коммитит их ОДНИМ шагом на pointerup, иначе одно
 *    движение ластика разваливается на десяток шагов отмены;
 *  • `preventDefault` на pointerdown — иначе действие по умолчанию крадёт фокус
 *    у поля ввода текста и оно закрывается пустым (баг доски, раунд 3).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BoardElement,
  type ShapeKind,
  createShape,
  createStroke,
  createText,
  elementBoundsCached,
  hitTest,
} from '@/lib/whiteboard/model';
import { elementToSvg } from '@/lib/whiteboard/svg';
import { type PhotoDegrees } from '@/lib/photoOrientation';
import { SafeImage } from '@/components/common/photo-viewer';
import {
  type PhotoLayout,
  type Point,
  type Size,
  PEN_SIZE_FACTORS,
  basePenSize,
  baseTextSize,
  computeLayout,
  containerToImage,
  imageToContainer,
  rotatedSize,
} from './annotateGeometry';
import { type AnnotateTool } from './AnnotateToolbar';

/** Маркер — те же пропорции, что на доске, чтобы жест ощущался одинаково. */
const MARKER_OPACITY = 0.35;
const MARKER_SIZE_FACTOR = 4;
/** Допуск ластика в долях базовой толщины пера. */
const ERASER_TOLERANCE_FACTOR = 2.5;
const MIN_CAMERA_SCALE = 1;
const MAX_CAMERA_SCALE = 6;

interface Camera {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY_CAMERA: Camera = { scale: 1, x: 0, y: 0 };

type Drag =
  | { kind: 'stroke'; pointerId: number }
  | { kind: 'shape'; pointerId: number; start: Point }
  | { kind: 'erase'; pointerId: number }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number };

export interface AnnotateCanvasProps {
  photoUrl: string;
  degrees: PhotoDegrees;
  elements: BoardElement[];
  tool: AnnotateTool;
  color: string;
  sizeIndex: number;
  onCommit: (element: BoardElement) => void;
  onErase: (ids: string[]) => void;
}

export function AnnotateCanvas({
  photoUrl,
  degrees,
  elements,
  tool,
  color,
  sizeIndex,
  onCommit,
  onErase,
}: AnnotateCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<Size | null>(null);
  const [camera, setCamera] = useState<Camera>(IDENTITY_CAMERA);
  const [livePoints, setLivePoints] = useState<number[] | null>(null);
  const [liveShape, setLiveShape] = useState<{ kind: ShapeKind; x: number; y: number; w: number; h: number } | null>(null);
  const [textDraft, setTextDraft] = useState<{ at: Point; value: string } | null>(null);

  const livePointsRef = useRef<number[] | null>(null);
  const liveShapeRef = useRef<typeof liveShape>(null);
  const dragRef = useRef<Drag | null>(null);
  /**
   * ⚠️ Храним и ТИП указателя, не только координаты.
   *
   * Без типа любые два указателя считались пинчем: ладонь, легшая на планшет
   * рядом со стилусом, отменяла начатый штрих и дёргала масштаб — а это ровно
   * главный пилотный сценарий (Ульяна пишет с планшета). Правило то же, что на
   * доске: пинч только когда ОБА указателя `touch`, а при активном пере палец
   * игнорируется целиком.
   */
  const pointersRef = useRef(new Map<number, { point: Point; type: string }>());
  /** Идентификатор активного пера — пока он есть, касания не рисуют и не пинчат. */
  const penPointerRef = useRef<number | null>(null);
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const erasedRef = useRef<Set<string>>(new Set());
  const frameRef = useRef<number | null>(null);

  // ─── Размер контейнера ─────────────────────────────────────────────────────

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const read = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setContainerSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  // Смена угла обнуляет камеру: вписывание пересчитано, старый сдвиг к новому
  // кадру отношения не имеет.
  useEffect(() => {
    setCamera(IDENTITY_CAMERA);
  }, [degrees]);

  const baseLayout = useMemo(
    () => (natural ? computeLayout(natural, containerSize, degrees) : null),
    [containerSize, degrees, natural],
  );

  /** Раскладка с учётом камеры — в ней и живут все преобразования указателя. */
  const layout = useMemo<PhotoLayout | null>(
    () =>
      baseLayout
        ? {
            ...baseLayout,
            displayScale: baseLayout.displayScale * camera.scale,
            center: {
              x: baseLayout.center.x + camera.x,
              y: baseLayout.center.y + camera.y,
            },
          }
        : null,
    [baseLayout, camera],
  );

  const layoutRef = useRef<PhotoLayout | null>(layout);
  layoutRef.current = layout;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  const penSize = natural ? basePenSize(natural) * PEN_SIZE_FACTORS[sizeIndex] : 3;
  const penSizeRef = useRef(penSize);
  penSizeRef.current = penSize;

  const scheduleFrame = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setLivePoints(livePointsRef.current ? livePointsRef.current.slice() : null);
      setLiveShape(liveShapeRef.current ? { ...liveShapeRef.current } : null);
    });
  }, []);

  const resetLive = useCallback(() => {
    livePointsRef.current = null;
    liveShapeRef.current = null;
    setLivePoints(null);
    setLiveShape(null);
  }, []);

  const toContainerPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const eraseAt = useCallback(
    (imagePoint: Point) => {
      const tolerance = penSizeRef.current * ERASER_TOLERANCE_FACTOR;
      const hits: string[] = [];
      const list = elementsRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const el = list[i];
        if (erasedRef.current.has(el.id)) continue;
        if (hitTest(el, imagePoint.x, imagePoint.y, tolerance)) {
          erasedRef.current.add(el.id);
          hits.push(el.id);
        }
      }
      return hits;
    },
    [],
  );

  // ─── Указатели ─────────────────────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const currentLayout = layoutRef.current;
      if (!currentLayout) return;

      // Крадёт фокус у поля текста, если не остановить (баг доски, раунд 3).
      event.preventDefault();

      const point = toContainerPoint(event.clientX, event.clientY);

      // Перо в работе — касания игнорируем полностью, даже не запоминаем.
      // Это и есть отсечение ладони: она приходит как `touch`.
      if (penPointerRef.current !== null && event.pointerType !== 'pen') return;

      pointersRef.current.set(event.pointerId, { point, type: event.pointerType });
      if (event.pointerType === 'pen') {
        penPointerRef.current = event.pointerId;
        // Перо главнее: всё, что успели начать пальцем, отменяем.
        pinchRef.current = null;
        for (const [id, entry] of pointersRef.current) {
          if (entry.type !== 'pen') pointersRef.current.delete(id);
        }
      }

      const touchPointers = Array.from(pointersRef.current.values()).filter(
        (entry) => entry.type === 'touch',
      );

      // Пинч — ТОЛЬКО два касания. Пара «перо + ладонь» под это не подходит.
      if (touchPointers.length === 2 && penPointerRef.current === null) {
        const [a, b] = touchPointers;
        pinchRef.current = {
          distance: Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y),
          scale: camera.scale,
        };
        dragRef.current = null;
        resetLive();
        return;
      }
      if (pointersRef.current.size > 2) return;
      // Второй указатель, не сложившийся в пинч (например, вторая ладонь), —
      // просто игнорируем, не ломая уже идущий жест.
      if (dragRef.current) return;

      // ⚠️ Захват указателя — в try: на неактивном pointerId браузер бросает
      // NotFoundError, и необработанное исключение оборвало бы обработчик до
      // старта жеста — рисование молча перестало бы работать. Захват здесь
      // удобство (не терять указатель за краем элемента), а не обязанность.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* рисуем и без захвата */
      }
      const image = containerToImage(point, currentLayout);
      const activeTool = toolRef.current;

      if (activeTool === 'pan') {
        dragRef.current = { kind: 'pan', pointerId: event.pointerId, lastX: point.x, lastY: point.y };
        return;
      }

      if (activeTool === 'text') {
        setTextDraft({ at: image, value: '' });
        return;
      }

      if (activeTool === 'eraser') {
        erasedRef.current = new Set();
        dragRef.current = { kind: 'erase', pointerId: event.pointerId };
        eraseAt(image);
        return;
      }

      if (activeTool === 'pen' || activeTool === 'marker') {
        const pressure =
          event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
        dragRef.current = { kind: 'stroke', pointerId: event.pointerId };
        livePointsRef.current = [image.x, image.y, pressure];
        scheduleFrame();
        return;
      }

      dragRef.current = { kind: 'shape', pointerId: event.pointerId, start: image };
      liveShapeRef.current = { kind: activeTool as ShapeKind, x: image.x, y: image.y, w: 0, h: 0 };
      scheduleFrame();
    },
    [camera.scale, eraseAt, resetLive, scheduleFrame, toContainerPoint],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const currentLayout = layoutRef.current;
      if (!currentLayout) return;
      if (!pointersRef.current.has(event.pointerId)) return;

      const point = toContainerPoint(event.clientX, event.clientY);
      pointersRef.current.set(event.pointerId, { point, type: event.pointerType });

      const pinch = pinchRef.current;
      const touchPointers = Array.from(pointersRef.current.values()).filter(
        (entry) => entry.type === 'touch',
      );
      if (pinch && touchPointers.length === 2) {
        const [a, b] = touchPointers;
        const distance = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
        if (pinch.distance > 0) {
          const next = Math.min(
            MAX_CAMERA_SCALE,
            Math.max(MIN_CAMERA_SCALE, pinch.scale * (distance / pinch.distance)),
          );
          setCamera((prev) => (prev.scale === next ? prev : { ...prev, scale: next }));
        }
        return;
      }

      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      if (drag.kind === 'pan') {
        const dx = point.x - drag.lastX;
        const dy = point.y - drag.lastY;
        drag.lastX = point.x;
        drag.lastY = point.y;
        setCamera((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        return;
      }

      const image = containerToImage(point, currentLayout);

      if (drag.kind === 'stroke') {
        const points = livePointsRef.current;
        if (!points) return;
        // Между кадрами перо успевает выдать несколько сэмплов — берём их все,
        // иначе длинная дуга (химическая связь, овал вокруг ошибки) выходит
        // угловатой. Метод необязательный: на мыши и старом WebKit его нет.
        const coalesced =
          event.pointerType === 'pen' && typeof event.nativeEvent.getCoalescedEvents === 'function'
            ? event.nativeEvent.getCoalescedEvents()
            : [];
        if (coalesced.length > 1) {
          for (const sample of coalesced) {
            const p = containerToImage(
              toContainerPoint(sample.clientX, sample.clientY),
              currentLayout,
            );
            points.push(p.x, p.y, sample.pressure > 0 ? sample.pressure : 0.5);
          }
        } else {
          const pressure =
            event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
          points.push(image.x, image.y, pressure);
        }
        scheduleFrame();
        return;
      }

      if (drag.kind === 'shape') {
        liveShapeRef.current = {
          kind: liveShapeRef.current?.kind ?? 'rect',
          x: drag.start.x,
          y: drag.start.y,
          w: image.x - drag.start.x,
          h: image.y - drag.start.y,
        };
        scheduleFrame();
        return;
      }

      if (drag.kind === 'erase') {
        eraseAt(image);
      }
    },
    [eraseAt, scheduleFrame, toContainerPoint],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(event.pointerId);
      if (penPointerRef.current === event.pointerId) penPointerRef.current = null;
      const remainingTouches = Array.from(pointersRef.current.values()).filter(
        (entry) => entry.type === 'touch',
      ).length;
      if (remainingTouches < 2) pinchRef.current = null;

      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        if (pointersRef.current.size === 0) dragRef.current = null;
        return;
      }
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (drag.kind === 'stroke') {
        const points = livePointsRef.current;
        if (points && points.length >= 6) {
          const marker = toolRef.current === 'marker';
          onCommit(
            marker
              ? createStroke(points, color, penSizeRef.current * MARKER_SIZE_FACTOR, MARKER_OPACITY)
              : createStroke(points, color, penSizeRef.current),
          );
        }
      } else if (drag.kind === 'shape') {
        const shape = liveShapeRef.current;
        const minSide = penSizeRef.current * 2;
        if (shape && (Math.abs(shape.w) > minSide || Math.abs(shape.h) > minSide)) {
          onCommit(
            createShape(shape.kind, shape.x, shape.y, shape.w, shape.h, color, penSizeRef.current),
          );
        }
      } else if (drag.kind === 'erase') {
        // Один коммит на жест = один шаг отмены.
        const ids = Array.from(erasedRef.current);
        erasedRef.current = new Set();
        if (ids.length > 0) onErase(ids);
      }

      resetLive();
    },
    [color, onCommit, onErase, resetLive],
  );

  // ─── Ввод текста ───────────────────────────────────────────────────────────

  const commitText = useCallback(() => {
    const draft = textDraft;
    setTextDraft(null);
    if (!draft || !draft.value.trim() || !natural) return;
    onCommit(createText(draft.at.x, draft.at.y, draft.value.trim(), color, baseTextSize(natural)));
  }, [color, natural, onCommit, textDraft]);

  // ─── Рендер ────────────────────────────────────────────────────────────────

  const liveElements = useMemo(() => {
    const out: BoardElement[] = [];
    if (livePoints && livePoints.length >= 3) {
      const marker = tool === 'marker';
      out.push({
        id: '__live_stroke__',
        version: 1,
        versionNonce: 0,
        seq: Number.MAX_SAFE_INTEGER,
        type: 'stroke',
        points: livePoints,
        color,
        size: marker ? penSize * MARKER_SIZE_FACTOR : penSize,
        ...(marker ? { opacity: MARKER_OPACITY } : {}),
      });
    }
    if (liveShape) {
      out.push({
        id: '__live_shape__',
        version: 1,
        versionNonce: 0,
        seq: Number.MAX_SAFE_INTEGER,
        type: 'shape',
        kind: liveShape.kind,
        x: liveShape.x,
        y: liveShape.y,
        w: liveShape.w,
        h: liveShape.h,
        color,
        size: penSize,
      });
    }
    return out;
  }, [color, liveShape, livePoints, penSize, tool]);

  const displaySize = natural
    ? {
        width: natural.width * (baseLayout?.displayScale ?? 1),
        height: natural.height * (baseLayout?.displayScale ?? 1),
      }
    : null;

  const rotated = natural ? rotatedSize(natural, degrees) : null;
  const textAnchor = textDraft && layout ? imageToContainer(textDraft.at, layout) : null;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      // none — иначе браузер съест жесты рисования и пинча раньше нас.
      style={{ touchAction: 'none', cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        ref={stageRef}
        className="absolute inset-0 grid place-items-center"
        style={{
          transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`,
          willChange: 'transform',
        }}
      >
        <div
          className="relative"
          style={
            displaySize
              ? { width: `${displaySize.width}px`, height: `${displaySize.height}px` }
              : undefined
          }
        >
          <SafeImage
            src={photoUrl}
            alt="Работа ученика"
            loading="eager"
            draggable={false}
            className="block h-full w-full select-none object-contain"
            style={{ transform: `rotate(${degrees}deg)` }}
            onNaturalSize={setNatural}
          />
          {natural ? (
            <svg
              // viewBox в пикселях НЕповёрнутого снимка: разметка привязана к
              // самому фото, поэтому переживает поворот без пересчёта.
              viewBox={`0 0 ${natural.width} ${natural.height}`}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{ transform: `rotate(${degrees}deg)` }}
              aria-hidden="true"
            >
              {[...elements, ...liveElements].map((element) =>
                elementToSvg(element).map((node, i) => {
                  const key = `${element.id}-${i}`;
                  if (node.tag === 'text') {
                    return (
                      <text key={key} {...(node.attrs as Record<string, string | number>)}>
                        {node.text}
                      </text>
                    );
                  }
                  const Tag = node.tag as 'path' | 'rect' | 'ellipse' | 'line';
                  return <Tag key={key} {...(node.attrs as Record<string, string | number>)} />;
                }),
              )}
            </svg>
          ) : null}
        </div>
      </div>

      {textAnchor ? (
        <input
          autoFocus
          value={textDraft?.value ?? ''}
          onChange={(event) =>
            setTextDraft((prev) => (prev ? { ...prev, value: event.target.value } : prev))
          }
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitText();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setTextDraft(null);
            }
          }}
          placeholder="Подпись"
          // 16px — иначе iOS зумит форму при фокусе (rule 80).
          className="absolute z-10 rounded-md border border-white/40 bg-slate-900/90 px-2 py-1 text-base text-white outline-none"
          style={{ left: textAnchor.x, top: textAnchor.y, minWidth: 140 }}
        />
      ) : null}

      {rotated && camera.scale > MIN_CAMERA_SCALE ? (
        <button
          type="button"
          onClick={() => setCamera(IDENTITY_CAMERA)}
          className="absolute bottom-3 right-3 rounded-full bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-white"
          style={{ touchAction: 'manipulation' }}
        >
          Показать целиком
        </button>
      ) : null}
    </div>
  );
}
