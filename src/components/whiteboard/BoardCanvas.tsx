import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BoardBounds,
  type BoardElement,
  type BoardBackground,
  type BoardGridMm,
  type CameraState,
  type FramePlacement,
  type ImageElement,
  type PageSizeMm,
  type ResizeCorner,
  type ShapeKind,
  boundsIntersect,
  cameraWorldWindow,
  createShape,
  createStroke,
  elementBoundsCached,
  frameWorldBounds,
  hitTest,
  resizeRectFromCorner,
  rotatePoint,
  rotationFromPointer,
  roundMm,
  zoomCameraAt,
} from '@/lib/whiteboard/model';
import {
  type ImageUrlMap,
  type StrokeRenderOptions,
  DEFAULT_STROKE_OPTIONS,
  backgroundToSvg,
  elementToSvg,
} from '@/lib/whiteboard/svg';

// Холст доски — Фаза P0, B0: бесконечный холст с рамками-страницами (Р1 отменён
// решением владельца 29.07 по итогам живых прогонов).
//
// Система координат: МИР в мм; рамка лежит в placement, её элементы — в
// ЛОКАЛЬНЫХ мм рамки (наследие Фазы 1, благодаря которому exportPdf и вся
// геометрия элементов не менялись). Камера {cx, cy, zoom} — viewBox = её окно.
//
// Жесты:
// • внутри рамки — инструменты (штрих/ластик/текст/фигуры/select), как в Фазе 1;
// • по пустому холсту — панорамирование ОДНИМ указателем (любой инструмент);
// • два пальца — pan + pinch-zoom; колесо — зум к курсору (стандарт досок,
//   плавный фактор — закрывает B19 «резкий шаг зума»), Shift+колесо — гор. пан.
//
// Перф-инварианты (ревью 5.6 р.2–4 + виртуализация B0, НЕ ломать):
// 1. Живой ввод — ref + rAF (≤1 setState за кадр).
// 2. Culling: рамка вне окна камеры не монтируется ВООБЩЕ; элементы внутри
//    видимой рамки отбираются по кэшированным bbox. Окно отбора КВАНТОВАНО
//    (шаг 100 мм, запас 150 мм): identity стабильна при малых панах → memo
//    слоёв не сбрасывается на каждый кадр движения камеры.
// 3. Статичные слои — memo (FrameLayer); перетаскивание — transform-обёртка.
// 4. Ластик копит попадания и коммитит одним вызовом на pointerup.
// 5. Коммиты — вне setState-updater'ов; жест привязан к pointerId.

export type BoardTool = 'pen' | 'eraser' | 'text' | 'select' | 'rect' | 'ellipse' | 'line';

export interface FrameView {
  id: string;
  placement: FramePlacement;
  size: PageSizeMm;
  background: BoardBackground;
  gridMm: BoardGridMm;
  elements: BoardElement[];
  /** Подпись рамки: «Лист N» или имя ученика зоны. */
  title: string;
  /** Рамка-зона ученика (подсветка + чужая для записи не-владельцу). */
  isZone?: boolean;
  /** Локальная блокировка записи (для студ./гост. страниц чужих зон — Этап 3). */
  writable?: boolean;
}

export interface BoardSelection {
  frameId: string;
  ids: string[];
}

/** «Призрачная» ячейка-плюс: клик создаёт лист в этой позиции сетки (Этап 2). */
export interface GhostCell {
  key: string;
  /** Ячейка сетки — то, что уйдёт в app_state.frame нового листа. */
  cell: { col: number; row: number };
  placement: FramePlacement;
  size: PageSizeMm;
  label: string;
  /** Лист какой зоны создать (рулон ученика) — прокидывается в onGhostClick. */
  zoneTutorStudentId?: string | null;
}

interface BoardCanvasProps {
  frames: FrameView[];
  camera: CameraState;
  viewport: { w: number; h: number };
  onCameraChange: (camera: CameraState) => void;
  tool: BoardTool;
  color: string;
  size: number;
  strokeOptions?: StrokeRenderOptions;
  selection: BoardSelection | null;
  readOnly?: boolean;
  imageUrls?: ImageUrlMap;
  onSelectionChange: (selection: BoardSelection | null) => void;
  /** Все коммиты адресуются рамке. Локальные координаты. Один вызов на жест. */
  onCommitElement: (frameId: string, element: BoardElement) => void;
  onEraseElements: (frameId: string, ids: string[]) => void;
  onMoveSelection: (frameId: string, dx: number, dy: number) => void;
  onTransformElement: (frameId: string, id: string, patch: Partial<ImageElement>) => void;
  onRequestText: (frameId: string, x: number, y: number) => void;
  /** Ячейки-плюсы для добавления листов (сетка Chattern). */
  ghostCells?: GhostCell[];
  onGhostClick?: (ghost: GhostCell) => void;
}

const ERASER_TOLERANCE_MM = 1.5;
const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>();
/** Квант окна отбора: identity окна меняется раз в 100 мм пути камеры. */
const CULL_QUANT_MM = 100;
const CULL_MARGIN_MM = 150;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
/** Тап ≤ 8 px = «клик по призрачной ячейке»; дальше — это пан. */
const GHOST_TAP_SLOP_PX = 8;

/** Один элемент. Сравнение по идентичности (см. разбор р.2а: id+version морозили live). */
const ElementNode = memo(
  ({
    element,
    options,
    imageUrls,
  }: {
    element: BoardElement;
    options: StrokeRenderOptions;
    imageUrls?: ImageUrlMap;
  }) => {
    const nodes = elementToSvg(element, options, imageUrls);
    return (
      <>
        {nodes.map((node, i) => {
          const key = `${element.id}-${i}`;
          if (node.tag === 'text') {
            return (
              <text key={key} {...(node.attrs as Record<string, string | number>)}>
                {node.text}
              </text>
            );
          }
          const Tag = node.tag as 'path' | 'rect' | 'ellipse' | 'line' | 'image';
          return <Tag key={key} {...(node.attrs as Record<string, string | number>)} />;
        })}
      </>
    );
  },
  (prev, next) =>
    prev.element === next.element &&
    prev.options === next.options &&
    (prev.element.type !== 'image' || prev.imageUrls === next.imageUrls),
);
ElementNode.displayName = 'ElementNode';

/**
 * Рамка целиком: подложка-лист, разлиновка, подпись, статичные элементы
 * (с culling по локальному окну). Memo держится, пока не меняются элементы,
 * hidden-набор или квантованное окно.
 */
const FrameLayer = memo(
  ({
    frame,
    hiddenIds,
    options,
    imageUrls,
    localCullWindow,
    zoomHint,
  }: {
    frame: FrameView;
    hiddenIds: ReadonlySet<string>;
    options: StrokeRenderOptions;
    imageUrls?: ImageUrlMap;
    /** Квантованное окно камеры в ЛОКАЛЬНЫХ координатах рамки; null = рамка видна целиком. */
    localCullWindow: BoardBounds | null;
    /** Порог «слишком мелко» для пропуска микро-элементов (LOD, px/мм). */
    zoomHint: number;
  }) => {
    const backgroundNodes = useMemo(
      () => backgroundToSvg(frame.background, frame.gridMm, frame.size),
      [frame.background, frame.gridMm, frame.size],
    );

    const visibleElements = useMemo(() => {
      if (!localCullWindow) return frame.elements;
      const out: BoardElement[] = [];
      for (let i = 0; i < frame.elements.length; i++) {
        if (boundsIntersect(elementBoundsCached(frame.elements[i]), localCullWindow)) {
          out.push(frame.elements[i]);
        }
      }
      return out;
    }, [frame.elements, localCullWindow]);

    // LOD: на дальнем зуме (< ~0.5 px/мм) элементы мельче 2 мм неразличимы —
    // не рендерим (research: стандартный приём против «подвисает через полгода»).
    const lodElements = useMemo(() => {
      if (zoomHint >= 0.5) return visibleElements;
      const out: BoardElement[] = [];
      for (let i = 0; i < visibleElements.length; i++) {
        const b = elementBoundsCached(visibleElements[i]);
        if (b.maxX - b.minX >= 2 || b.maxY - b.minY >= 2) out.push(visibleElements[i]);
      }
      return out;
    }, [visibleElements, zoomHint]);

    return (
      <g transform={`translate(${frame.placement.x} ${frame.placement.y})`}>
        {/* Лист: белая подложка + кайма (зона — акцентная). Тень не используем:
            SVG-фильтры дороги на слабых WebKit (rule 80 аудитория). Подпись
            листа рендерится ВНЕ FrameLayer (screen-space слой в BoardCanvas):
            её размер зависит от zoom, а memo этого слоя от камеры не зависит. */}
        <rect
          x={-0.5}
          y={-0.5}
          width={frame.size.width + 1}
          height={frame.size.height + 1}
          fill="#FFFFFF"
          stroke={frame.isZone ? '#1B6B4A' : '#CBD5E1'}
          strokeWidth={frame.isZone ? 0.8 : 0.4}
        />
        {backgroundNodes.map((node, i) => (
          <path key={`bg-${i}`} {...(node.attrs as Record<string, string | number>)} />
        ))}
        {lodElements.map((element) =>
          hiddenIds.has(element.id) ? null : (
            <g key={element.id}>
              <ElementNode element={element} options={options} imageUrls={imageUrls} />
            </g>
          ),
        )}
      </g>
    );
  },
  (prev, next) =>
    prev.frame === next.frame &&
    prev.hiddenIds === next.hiddenIds &&
    prev.options === next.options &&
    prev.imageUrls === next.imageUrls &&
    boundsEqual(prev.localCullWindow, next.localCullWindow) &&
    prev.zoomHint === next.zoomHint,
);
FrameLayer.displayName = 'FrameLayer';

function boundsEqual(a: BoardBounds | null, b: BoardBounds | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

interface DragState {
  kind:
    | 'stroke'
    | 'shape'
    | 'marquee'
    | 'move'
    | 'erase'
    | 'pan-canvas'
    | 'pinch'
    | 'resize'
    | 'rotate';
  pointerId: number;
  pointerType: string;
  /** Рамка жеста (для pan/pinch — не задана). */
  frameId?: string;
  /** Локальные координаты старта в рамке. */
  startX: number;
  startY: number;
  panIds?: [number, number];
  targetId?: string;
  corner?: ResizeCorner;
}

interface LiveShape {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TransformDraft {
  id: string;
  frameId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export function BoardCanvas({
  frames,
  camera,
  viewport,
  onCameraChange,
  tool,
  color,
  size,
  strokeOptions = DEFAULT_STROKE_OPTIONS,
  selection,
  readOnly = false,
  imageUrls,
  onSelectionChange,
  onCommitElement,
  onEraseElements,
  onMoveSelection,
  onTransformElement,
  onRequestText,
  ghostCells,
  onGhostClick,
}: BoardCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const erasedRef = useRef<Set<string>>(new Set());
  const rectRef = useRef<DOMRect | null>(null);
  const touchPosRef = useRef(new Map<number, { x: number; y: number }>());
  const panLastRef = useRef<{ x: number; y: number; dist: number } | null>(null);
  /** Кандидат «тап по призрачной ячейке» — создание решается на pointerup. */
  const pendingGhostRef = useRef<
    { ghost: GhostCell; startX: number; startY: number; pointerId: number } | null
  >(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const livePointsRef = useRef<number[] | null>(null);
  const liveShapeRef = useRef<LiveShape | null>(null);
  const marqueeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const moveOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const transformDraftRef = useRef<TransformDraft | null>(null);
  const rafRef = useRef<number | null>(null);

  const [livePoints, setLivePoints] = useState<number[] | null>(null);
  const [liveShape, setLiveShape] = useState<LiveShape | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [moveOffset, setMoveOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(EMPTY_HIDDEN);
  const [transformDraft, setTransformDraft] = useState<TransformDraft | null>(null);
  /** Рамка активного жеста — стейт (а не чтение dragRef в memo: ref без ре-рендера). */
  const [gestureFrameId, setGestureFrameId] = useState<string | null>(null);

  // ─── Камера: окно, квантованный cull, видимые рамки ────────────────────────

  const worldWindow = useMemo(
    () => cameraWorldWindow(camera, viewport),
    [camera, viewport],
  );

  // Квантование: окно отбора прыгает шагами CULL_QUANT_MM, identity стабильна
  // при малых панах → FrameLayer-memo не сбрасывается каждый кадр движения.
  const cullWindow = useMemo<BoardBounds>(() => {
    const q = CULL_QUANT_MM;
    return {
      minX: Math.floor((worldWindow.minX - CULL_MARGIN_MM) / q) * q,
      minY: Math.floor((worldWindow.minY - CULL_MARGIN_MM) / q) * q,
      maxX: Math.ceil((worldWindow.maxX + CULL_MARGIN_MM) / q) * q,
      maxY: Math.ceil((worldWindow.maxY + CULL_MARGIN_MM) / q) * q,
    };
  }, [worldWindow]);

  const visibleFrames = useMemo(
    () => frames.filter((f) => boundsIntersect(frameWorldBounds(f.placement, f.size), cullWindow)),
    [frames, cullWindow],
  );

  /** Локальное окно отбора для рамки; null — рамка внутри окна целиком (без фильтра). */
  const localCullWindows = useMemo(() => {
    const map = new Map<string, BoardBounds | null>();
    for (let i = 0; i < visibleFrames.length; i++) {
      const f = visibleFrames[i];
      const fb = frameWorldBounds(f.placement, f.size);
      const fullyInside =
        fb.minX >= cullWindow.minX && fb.maxX <= cullWindow.maxX &&
        fb.minY >= cullWindow.minY && fb.maxY <= cullWindow.maxY;
      map.set(
        f.id,
        fullyInside
          ? null
          : {
              minX: cullWindow.minX - f.placement.x,
              minY: cullWindow.minY - f.placement.y,
              maxX: cullWindow.maxX - f.placement.x,
              maxY: cullWindow.maxY - f.placement.y,
            },
      );
    }
    return map;
  }, [visibleFrames, cullWindow]);

  const frameById = useMemo(() => {
    const map = new Map<string, FrameView>();
    for (let i = 0; i < frames.length; i++) map.set(frames[i].id, frames[i]);
    return map;
  }, [frames]);

  const selectionFrame = selection ? frameById.get(selection.frameId) ?? null : null;
  const selectedSet = useMemo(() => new Set(selection?.ids ?? []), [selection]);

  // ─── Координаты ─────────────────────────────────────────────────────────────

  /** Клиентские px → мировые мм (через rect и окно камеры — без искажения). */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      let rect = rectRef.current;
      if (!rect) {
        rect = svgRef.current?.getBoundingClientRect() ?? null;
        rectRef.current = rect;
      }
      if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
      const cam = cameraRef.current;
      return {
        x: cam.cx + (clientX - rect.left - rect.width / 2) / cam.zoom,
        y: cam.cy + (clientY - rect.top - rect.height / 2) / cam.zoom,
      };
    },
    [],
  );

  /** Верхняя (последняя в порядке массива) рамка под мировой точкой. */
  const findFrameAt = useCallback(
    (wx: number, wy: number): FrameView | null => {
      for (let i = frames.length - 1; i >= 0; i--) {
        const b = frameWorldBounds(frames[i].placement, frames[i].size);
        if (wx >= b.minX && wx <= b.maxX && wy >= b.minY && wy <= b.maxY) return frames[i];
      }
      return null;
    },
    [frames],
  );

  // Камера двигается жестами → rect не устаревает, но скролл страницы всё ещё
  // возможен (мобильный тулбар) — сбрасываем кэш (ревью р.4).
  useEffect(() => {
    const invalidate = () => {
      rectRef.current = null;
    };
    window.addEventListener('scroll', invalidate, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', invalidate, true);
  }, []);

  // ─── rAF-конвейер живого ввода ──────────────────────────────────────────────

  const scheduleFrame = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setLivePoints(livePointsRef.current ? livePointsRef.current.slice() : null);
      setLiveShape(liveShapeRef.current ? { ...liveShapeRef.current } : null);
      setMarquee(marqueeRef.current ? { ...marqueeRef.current } : null);
      setMoveOffset({ ...moveOffsetRef.current });
      setHiddenIds(erasedRef.current.size > 0 ? new Set(erasedRef.current) : EMPTY_HIDDEN);
      setTransformDraft(transformDraftRef.current ? { ...transformDraftRef.current } : null);
      setGestureFrameId(dragRef.current?.frameId ?? null);
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const resetLiveState = useCallback(() => {
    livePointsRef.current = null;
    liveShapeRef.current = null;
    marqueeRef.current = null;
    moveOffsetRef.current = { dx: 0, dy: 0 };
    erasedRef.current = new Set();
    panLastRef.current = null;
    pendingGhostRef.current = null;
    transformDraftRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setLivePoints(null);
    setLiveShape(null);
    setMarquee(null);
    setMoveOffset({ dx: 0, dy: 0 });
    setHiddenIds(EMPTY_HIDDEN);
    setTransformDraft(null);
    setGestureFrameId(null);
  }, []);

  // ─── Ластик ─────────────────────────────────────────────────────────────────

  const eraseAtLocal = useCallback(
    (frame: FrameView, lx: number, ly: number) => {
      if (frame.writable === false) return;
      let changed = false;
      for (let i = frame.elements.length - 1; i >= 0; i--) {
        const el = frame.elements[i];
        if (erasedRef.current.has(el.id)) continue;
        if (hitTest(el, lx, ly, ERASER_TOLERANCE_MM)) {
          erasedRef.current.add(el.id);
          changed = true;
        }
      }
      if (changed) scheduleFrame();
    },
    [scheduleFrame],
  );

  // ─── Завершение жеста ───────────────────────────────────────────────────────

  const finishDrag = useCallback(
    (event?: PointerEvent | React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (event) {
        const belongs =
          drag.kind === 'pinch'
            ? drag.panIds?.includes(event.pointerId) ?? false
            : event.pointerId === drag.pointerId;
        if (!belongs) return;
      }
      dragRef.current = null;
      rectRef.current = null;
      const frameId = drag.frameId;

      // Тап по призрачной ячейке: жест остался паном того же указателя и не
      // ушёл дальше tap-slop → создаём лист. Пан/pinch кандидата отменяют.
      const pendingGhost = pendingGhostRef.current;
      pendingGhostRef.current = null;
      if (
        pendingGhost &&
        drag.kind === 'pan-canvas' &&
        event &&
        'clientX' in event &&
        event.pointerId === pendingGhost.pointerId &&
        Math.hypot(event.clientX - pendingGhost.startX, event.clientY - pendingGhost.startY) <
          GHOST_TAP_SLOP_PX &&
        onGhostClick
      ) {
        onGhostClick(pendingGhost.ghost);
      }

      if (drag.kind === 'stroke' && frameId) {
        const points = livePointsRef.current;
        if (points && points.length >= 3) {
          onCommitElement(frameId, createStroke(points, color, size));
        }
      } else if (drag.kind === 'shape' && frameId) {
        const shape = liveShapeRef.current;
        if (shape && (Math.abs(shape.w) > 0.5 || Math.abs(shape.h) > 0.5)) {
          onCommitElement(
            frameId,
            createShape(shape.kind, shape.x, shape.y, shape.w, shape.h, color, size),
          );
        }
      } else if (drag.kind === 'marquee' && frameId) {
        const box = marqueeRef.current;
        const frame = frameById.get(frameId);
        if (box && frame) {
          const region = {
            minX: Math.min(box.x, box.x + box.w),
            minY: Math.min(box.y, box.y + box.h),
            maxX: Math.max(box.x, box.x + box.w),
            maxY: Math.max(box.y, box.y + box.h),
          };
          const ids = frame.elements
            .filter((el) => boundsIntersect(elementBoundsCached(el), region))
            .map((el) => el.id);
          onSelectionChange(ids.length > 0 ? { frameId, ids } : null);
        }
      } else if (drag.kind === 'move' && frameId) {
        const { dx, dy } = moveOffsetRef.current;
        if (dx !== 0 || dy !== 0) onMoveSelection(frameId, roundMm(dx), roundMm(dy));
      } else if (drag.kind === 'erase' && frameId) {
        if (erasedRef.current.size > 0) onEraseElements(frameId, Array.from(erasedRef.current));
      } else if (drag.kind === 'resize' || drag.kind === 'rotate') {
        const draft = transformDraftRef.current;
        if (draft) {
          onTransformElement(draft.frameId, draft.id, {
            x: draft.x,
            y: draft.y,
            w: draft.w,
            h: draft.h,
            rotation: draft.rotation,
          });
        }
      }

      resetLiveState();
    },
    [color, size, frameById, onCommitElement, onEraseElements, onSelectionChange, onMoveSelection, onTransformElement, onGhostClick, resetLiveState],
  );

  // ─── Трансформация картинок (ручки) ────────────────────────────────────────

  const startTransform = useCallback(
    (
      event: React.PointerEvent,
      frameId: string,
      target: ImageElement,
      kind: 'resize' | 'rotate',
      corner?: ResizeCorner,
    ) => {
      if (readOnly || dragRef.current) return;
      event.stopPropagation();
      event.preventDefault();
      rectRef.current = svgRef.current?.getBoundingClientRect() ?? null;
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      dragRef.current = {
        kind,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        frameId,
        startX: 0,
        startY: 0,
        targetId: target.id,
        corner,
      };
      transformDraftRef.current = {
        id: target.id,
        frameId,
        x: target.x,
        y: target.y,
        w: target.w,
        h: target.h,
        rotation: target.rotation,
      };
      scheduleFrame();
    },
    [readOnly, scheduleFrame],
  );

  // ─── Pinch (два пальца): pan + zoom ────────────────────────────────────────

  const convertToPinch = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'erase' && drag.frameId && erasedRef.current.size > 0) {
        onEraseElements(drag.frameId, Array.from(erasedRef.current));
      }
      const first = touchPosRef.current.get(drag.pointerId);
      const second = { x: event.clientX, y: event.clientY };
      const a = first ?? second;
      dragRef.current = {
        kind: 'pinch',
        pointerId: -1,
        pointerType: 'touch',
        startX: 0,
        startY: 0,
        panIds: [drag.pointerId, event.pointerId],
      };
      panLastRef.current = {
        x: (a.x + second.x) / 2,
        y: (a.y + second.y) / 2,
        dist: Math.hypot(second.x - a.x, second.y - a.y),
      };
      livePointsRef.current = null;
      liveShapeRef.current = null;
      marqueeRef.current = null;
      moveOffsetRef.current = { dx: 0, dy: 0 };
      erasedRef.current = new Set();
      scheduleFrame();
    },
    [onEraseElements, scheduleFrame],
  );

  // ─── Pointer down ───────────────────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0 && event.button !== 1) return;

      if (event.pointerType === 'touch') {
        touchPosRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      const drag = dragRef.current;
      if (drag) {
        if (
          event.pointerType === 'touch' &&
          drag.pointerType === 'touch' &&
          drag.kind !== 'pinch'
        ) {
          convertToPinch(event);
        }
        return;
      }

      // preventDefault: default-действие mousedown крадёт фокус у textarea
      // текста (раунд 3 — «текст не вставлялся»). Blur редактируемых — явно.
      event.preventDefault();
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
      ) {
        active.blur();
      }

      rectRef.current = event.currentTarget.getBoundingClientRect();
      const world = toWorld(event.clientX, event.clientY);
      event.currentTarget.setPointerCapture(event.pointerId);
      const pointerId = event.pointerId;
      const pointerType = event.pointerType;

      // «Призрачная» ячейка: создание — НА POINTERUP с tap-slop (ревью P1:
      // немедленный create на pointerdown превращал попытку начать пан с
      // пустой ячейки планшета в сетевой запрос). Здесь только запоминаем
      // кандидата и запускаем обычный пан; finishDrag решит, был ли это тап.
      if (onGhostClick && ghostCells && event.button === 0 && !readOnly) {
        for (let i = 0; i < ghostCells.length; i++) {
          const g = ghostCells[i];
          if (
            world.x >= g.placement.x && world.x <= g.placement.x + g.size.width &&
            world.y >= g.placement.y && world.y <= g.placement.y + g.size.height
          ) {
            pendingGhostRef.current = { ghost: g, startX: event.clientX, startY: event.clientY, pointerId };
            dragRef.current = {
              kind: 'pan-canvas',
              pointerId,
              pointerType,
              startX: event.clientX,
              startY: event.clientY,
            };
            panLastRef.current = { x: event.clientX, y: event.clientY, dist: 0 };
            return;
          }
        }
      }

      const frame = findFrameAt(world.x, world.y);

      // Пустой холст ИЛИ средняя кнопка — панорамирование одним указателем.
      if (!frame || event.button === 1) {
        dragRef.current = {
          kind: 'pan-canvas',
          pointerId,
          pointerType,
          startX: event.clientX,
          startY: event.clientY,
        };
        panLastRef.current = { x: event.clientX, y: event.clientY, dist: 0 };
        return;
      }

      if (readOnly || frame.writable === false) {
        // Чужая/read-only рамка: жест превращается в пан (можно осматривать).
        dragRef.current = {
          kind: 'pan-canvas',
          pointerId,
          pointerType,
          startX: event.clientX,
          startY: event.clientY,
        };
        panLastRef.current = { x: event.clientX, y: event.clientY, dist: 0 };
        return;
      }

      const lx = roundMm(world.x - frame.placement.x);
      const ly = roundMm(world.y - frame.placement.y);

      if (tool === 'text') {
        rectRef.current = null;
        onRequestText(frame.id, lx, ly);
        return;
      }

      if (tool === 'pen') {
        const pressure = pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
        dragRef.current = { kind: 'stroke', pointerId, pointerType, frameId: frame.id, startX: lx, startY: ly };
        livePointsRef.current = [lx, ly, pressure];
        scheduleFrame();
        return;
      }

      if (tool === 'eraser') {
        erasedRef.current = new Set();
        dragRef.current = { kind: 'erase', pointerId, pointerType, frameId: frame.id, startX: lx, startY: ly };
        eraseAtLocal(frame, lx, ly);
        return;
      }

      if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
        dragRef.current = { kind: 'shape', pointerId, pointerType, frameId: frame.id, startX: lx, startY: ly };
        liveShapeRef.current = { kind: tool as ShapeKind, x: lx, y: ly, w: 0, h: 0 };
        scheduleFrame();
        return;
      }

      // select
      let hitId: string | null = null;
      for (let i = frame.elements.length - 1; i >= 0; i--) {
        if (hitTest(frame.elements[i], lx, ly, 1)) {
          hitId = frame.elements[i].id;
          break;
        }
      }
      if (hitId) {
        if (!(selection && selection.frameId === frame.id && selectedSet.has(hitId))) {
          onSelectionChange({ frameId: frame.id, ids: [hitId] });
        }
        dragRef.current = { kind: 'move', pointerId, pointerType, frameId: frame.id, startX: lx, startY: ly };
        moveOffsetRef.current = { dx: 0, dy: 0 };
      } else {
        onSelectionChange(null);
        dragRef.current = { kind: 'marquee', pointerId, pointerType, frameId: frame.id, startX: lx, startY: ly };
        marqueeRef.current = { x: lx, y: ly, w: 0, h: 0 };
        scheduleFrame();
      }
    },
    [toWorld, findFrameAt, readOnly, tool, selection, selectedSet, onSelectionChange, onRequestText, eraseAtLocal, convertToPinch, scheduleFrame, ghostCells, onGhostClick],
  );

  // ─── Pointer move ───────────────────────────────────────────────────────────

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (event.pointerType === 'touch' && touchPosRef.current.has(event.pointerId)) {
        touchPosRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (drag.kind === 'pinch') {
        if (!drag.panIds?.includes(event.pointerId)) return;
        const [a, b] = drag.panIds;
        const pa = touchPosRef.current.get(a);
        const pb = touchPosRef.current.get(b);
        if (!pa || !pb || !panLastRef.current) return;
        const centroid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        const dist = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        const last = panLastRef.current;
        const cam = cameraRef.current;
        let next: CameraState = {
          ...cam,
          cx: cam.cx - (centroid.x - last.x) / cam.zoom,
          cy: cam.cy - (centroid.y - last.y) / cam.zoom,
        };
        if (last.dist > 20 && dist > 20) {
          next = zoomCameraAt(next, dist / last.dist, toWorld(centroid.x, centroid.y));
        }
        panLastRef.current = { ...centroid, dist };
        onCameraChange(next);
        return;
      }

      if (drag.kind === 'pan-canvas') {
        if (event.pointerId !== drag.pointerId) return;
        const last = panLastRef.current;
        if (!last) return;
        const cam = cameraRef.current;
        onCameraChange({
          ...cam,
          cx: cam.cx - (event.clientX - last.x) / cam.zoom,
          cy: cam.cy - (event.clientY - last.y) / cam.zoom,
        });
        panLastRef.current = { x: event.clientX, y: event.clientY, dist: 0 };
        return;
      }

      if (event.pointerId !== drag.pointerId) return;
      const world = toWorld(event.clientX, event.clientY);
      const frame = drag.frameId ? frameById.get(drag.frameId) : null;

      if (drag.kind === 'resize' || drag.kind === 'rotate') {
        const draft = transformDraftRef.current;
        const original = frame?.elements.find((e) => e.id === drag.targetId);
        if (draft && frame && original && original.type === 'image') {
          const lx = world.x - frame.placement.x;
          const ly = world.y - frame.placement.y;
          if (drag.kind === 'rotate') {
            const cx = draft.x + draft.w / 2;
            const cy = draft.y + draft.h / 2;
            draft.rotation = rotationFromPointer(cx, cy, lx, ly);
          } else if (drag.corner) {
            const next = resizeRectFromCorner(
              { x: original.x, y: original.y, w: original.w, h: original.h },
              original.rotation,
              drag.corner,
              lx,
              ly,
              true,
            );
            draft.x = next.x;
            draft.y = next.y;
            draft.w = next.w;
            draft.h = next.h;
            draft.rotation = original.rotation;
          }
        }
        scheduleFrame();
        return;
      }

      if (!frame) return;
      const lx = roundMm(world.x - frame.placement.x);
      const ly = roundMm(world.y - frame.placement.y);

      if (drag.kind === 'stroke') {
        const pressure = event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
        livePointsRef.current?.push(lx, ly, pressure);
      } else if (drag.kind === 'erase') {
        eraseAtLocal(frame, lx, ly);
        return;
      } else if (drag.kind === 'shape') {
        const shape = liveShapeRef.current;
        if (shape) {
          shape.w = roundMm(lx - drag.startX);
          shape.h = roundMm(ly - drag.startY);
        }
      } else if (drag.kind === 'marquee') {
        marqueeRef.current = { x: drag.startX, y: drag.startY, w: lx - drag.startX, h: ly - drag.startY };
      } else if (drag.kind === 'move') {
        moveOffsetRef.current = { dx: lx - drag.startX, dy: ly - drag.startY };
      }

      scheduleFrame();
    },
    [toWorld, frameById, eraseAtLocal, scheduleFrame, onCameraChange],
  );

  useEffect(() => {
    const handleUp = (event: PointerEvent) => {
      touchPosRef.current.delete(event.pointerId);
      finishDrag(event);
    };
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [finishDrag]);

  // ─── Колесо: зум к курсору (B19 — мягкий шаг), Shift — горизонтальный пан ──

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Нативный listener с passive:false: React onWheel пассивен и не даёт
    // preventDefault → страница зумилась бы вместе с холстом.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const cam = cameraRef.current;
      if (event.shiftKey && !event.ctrlKey) {
        onCameraChange({ ...cam, cx: cam.cx + event.deltaY / cam.zoom });
        return;
      }
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
      const clamped = Math.min(1.25, Math.max(0.8, factor));
      onCameraChange(zoomCameraAt(cam, clamped, toWorld(event.clientX, event.clientY)));
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [toWorld, onCameraChange]);

  // ─── Live-слои и выделение (мировые координаты через рамку жеста) ──────────

  const gestureFramePlacement = useMemo(() => {
    const id = gestureFrameId ?? selection?.frameId;
    if (!id) return null;
    return frameById.get(id)?.placement ?? null;
  }, [frameById, gestureFrameId, selection]);

  const liveStroke: BoardElement | null = useMemo(
    () =>
      livePoints && livePoints.length >= 3
        ? {
            id: '__live__',
            version: 1,
            versionNonce: 0,
            seq: Number.MAX_SAFE_INTEGER,
            type: 'stroke',
            points: livePoints,
            color,
            size,
          }
        : null,
    [livePoints, color, size],
  );

  const liveShapeElement: BoardElement | null = useMemo(
    () =>
      liveShape
        ? {
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
            size,
          }
        : null,
    [liveShape, color, size],
  );

  const hiddenForRender = useMemo(() => {
    const extra = new Set<string>();
    if (transformDraft) extra.add(transformDraft.id);
    if (selection && (moveOffset.dx !== 0 || moveOffset.dy !== 0)) {
      for (const id of selection.ids) extra.add(id);
    }
    if (extra.size === 0) return hiddenIds;
    const combined = new Set(hiddenIds);
    extra.forEach((id) => combined.add(id));
    return combined;
  }, [hiddenIds, transformDraft, selection, moveOffset]);

  // Рамка, которой адресован hidden-набор: жест всегда один и внутри одной
  // рамки, остальным отдаётся стабильный EMPTY_HIDDEN → их memo живёт.
  const hiddenScopeFrameId =
    transformDraft?.frameId ??
    (selection && (moveOffset.dx !== 0 || moveOffset.dy !== 0) ? selection.frameId : null) ??
    (hiddenIds.size > 0 ? gestureFrameId : null);

  // LOD-порог — БАКЕТ, не сырой zoom: сырой менялся каждый кадр pinch-зума и
  // ререндерил все FrameLayer. LOD переключается только на границе 0.5 px/мм.
  const lodZoomBucket = camera.zoom < 0.5 ? 0.25 : 1;

  const selectionBox = useMemo(() => {
    if (!selection || !selectionFrame || selection.ids.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < selectionFrame.elements.length; i++) {
      const el = selectionFrame.elements[i];
      if (!selectedSet.has(el.id)) continue;
      const b = elementBoundsCached(el);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (minX === Infinity) return null;
    return { x: minX - 1, y: minY - 1, w: maxX - minX + 2, h: maxY - minY + 2 };
  }, [selection, selectionFrame, selectedSet]);

  const selectedElements = useMemo(() => {
    if (!selection || !selectionFrame) return [];
    return selectionFrame.elements.filter((el) => selectedSet.has(el.id));
  }, [selection, selectionFrame, selectedSet]);

  const transformDraftElement: BoardElement | null = useMemo(() => {
    if (!transformDraft) return null;
    const frame = frameById.get(transformDraft.frameId);
    const original = frame?.elements.find((e) => e.id === transformDraft.id);
    if (!original || original.type !== 'image') return null;
    return {
      ...original,
      x: transformDraft.x,
      y: transformDraft.y,
      w: transformDraft.w,
      h: transformDraft.h,
      rotation: transformDraft.rotation,
    };
  }, [transformDraft, frameById]);

  const singleSelectedImage: ImageElement | null = useMemo(() => {
    if (tool !== 'select' || !selection || selection.ids.length !== 1 || !selectionFrame) return null;
    const el = selectionFrame.elements.find((e) => e.id === selection.ids[0]);
    return el && el.type === 'image' ? el : null;
  }, [tool, selection, selectionFrame]);

  const isMoving = moveOffset.dx !== 0 || moveOffset.dy !== 0;

  const windowW = worldWindow.maxX - worldWindow.minX;
  const windowH = worldWindow.maxY - worldWindow.minY;

  return (
    <svg
      ref={svgRef}
      viewBox={`${worldWindow.minX} ${worldWindow.minY} ${windowW} ${windowH}`}
      className="h-full w-full"
      role="img"
      aria-label="Холст доски. Рисование внутри листов; пустое место и два пальца — перемещение по холсту; колесо — масштаб."
      style={{
        touchAction: 'none',
        background: '#EEF2F7',
        cursor:
          tool === 'select' ? 'default' : readOnly ? 'grab' : 'crosshair',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
    >
      {visibleFrames.map((frame) => (
        <FrameLayer
          key={frame.id}
          frame={frame}
          // Hidden-набор — ТОЛЬКО рамке активного жеста (ревью P1): новый Set
          // на каждый шаг ластика инвалидировал memo ВСЕХ видимых листов.
          hiddenIds={frame.id === hiddenScopeFrameId ? hiddenForRender : EMPTY_HIDDEN}
          options={strokeOptions}
          imageUrls={imageUrls}
          localCullWindow={localCullWindows.get(frame.id) ?? null}
          zoomHint={lodZoomBucket}
        />
      ))}

      {/* Подписи листов: screen-space (ревью P2 — на обзорном зуме 4 мм ≈ 0.8 px,
          «чья зона?» было не прочесть). Инверсный масштаб с клампом ~12 px. */}
      {visibleFrames.map((frame) => {
        const labelMm = Math.max(4, 12 / camera.zoom);
        return (
          <text
            key={`label-${frame.id}`}
            x={frame.placement.x}
            y={frame.placement.y - labelMm * 0.6}
            fill={frame.isZone ? '#1B6B4A' : '#64748B'}
            fontSize={labelMm}
            fontFamily="'Golos Text', system-ui, sans-serif"
          >
            {frame.title}
          </text>
        );
      })}

      {/* Ячейки-плюсы: пунктирный контур с плюсом, клик = новый лист. */}
      {!readOnly &&
        (ghostCells ?? [])
          .filter((g) =>
            boundsIntersect(
              { minX: g.placement.x, minY: g.placement.y, maxX: g.placement.x + g.size.width, maxY: g.placement.y + g.size.height },
              cullWindow,
            ),
          )
          .map((g) => (
            <g key={g.key} style={{ cursor: 'pointer' }}>
              <rect
                x={g.placement.x}
                y={g.placement.y}
                width={g.size.width}
                height={g.size.height}
                fill="#FFFFFF"
                fillOpacity={0.35}
                stroke="#94A3B8"
                strokeWidth={0.5}
                strokeDasharray="4 3"
                rx={2}
              />
              <line
                x1={g.placement.x + g.size.width / 2 - 8}
                y1={g.placement.y + g.size.height / 2}
                x2={g.placement.x + g.size.width / 2 + 8}
                y2={g.placement.y + g.size.height / 2}
                stroke="#64748B"
                strokeWidth={1.4}
              />
              <line
                x1={g.placement.x + g.size.width / 2}
                y1={g.placement.y + g.size.height / 2 - 8}
                x2={g.placement.x + g.size.width / 2}
                y2={g.placement.y + g.size.height / 2 + 8}
                stroke="#64748B"
                strokeWidth={1.4}
              />
              <text
                x={g.placement.x + g.size.width / 2}
                y={g.placement.y + g.size.height / 2 + 18}
                textAnchor="middle"
                fill="#64748B"
                fontSize={5}
                fontFamily="'Golos Text', system-ui, sans-serif"
              >
                {g.label}
              </text>
            </g>
          ))}

      {/* Выделенные элементы поверх, с move-transform (в координатах их рамки). */}
      {selectionFrame && selectedElements.length > 0 && (
        <g
          transform={`translate(${selectionFrame.placement.x + moveOffset.dx} ${selectionFrame.placement.y + moveOffset.dy})`}
        >
          {selectedElements.map((el) => (
            <g key={el.id}>
              <ElementNode element={el} options={strokeOptions} imageUrls={imageUrls} />
            </g>
          ))}
        </g>
      )}

      {/* Живые слои — в системе рамки жеста. */}
      {gestureFramePlacement && (liveStroke || liveShapeElement || transformDraftElement) && (
        <g transform={`translate(${gestureFramePlacement.x} ${gestureFramePlacement.y})`}>
          {liveStroke && <ElementNode element={liveStroke} options={strokeOptions} />}
          {liveShapeElement && <ElementNode element={liveShapeElement} options={strokeOptions} />}
          {transformDraftElement && (
            <g opacity={0.85}>
              <ElementNode element={transformDraftElement} options={strokeOptions} imageUrls={imageUrls} />
            </g>
          )}
        </g>
      )}

      {marquee && gestureFramePlacement && (
        <rect
          x={gestureFramePlacement.x + Math.min(marquee.x, marquee.x + marquee.w)}
          y={gestureFramePlacement.y + Math.min(marquee.y, marquee.y + marquee.h)}
          width={Math.abs(marquee.w)}
          height={Math.abs(marquee.h)}
          fill="#1B6B4A"
          fillOpacity={0.08}
          stroke="#1B6B4A"
          strokeWidth={0.2}
          strokeDasharray="1 1"
        />
      )}

      {/* Выделение — КОНТУР, не затемнение: opacity 0.7 читалась как «штрих
          стал полупрозрачным» (B14, репорт Елены). */}
      {selectionBox && selectionFrame && (
        <rect
          x={selectionFrame.placement.x + selectionBox.x + moveOffset.dx}
          y={selectionFrame.placement.y + selectionBox.y + moveOffset.dy}
          width={selectionBox.w}
          height={selectionBox.h}
          fill="none"
          stroke="#1B6B4A"
          strokeWidth={0.35}
          strokeDasharray="1.5 1"
          pointerEvents="none"
        />
      )}

      {singleSelectedImage && selectionFrame && !isMoving && (() => {
        const g =
          transformDraft && transformDraft.id === singleSelectedImage.id
            ? transformDraft
            : singleSelectedImage;
        const fx = selectionFrame.placement.x;
        const fy = selectionFrame.placement.y;
        const cx = g.x + g.w / 2;
        const cy = g.y + g.h / 2;
        const corners: { corner: ResizeCorner; p: { x: number; y: number } }[] = [
          { corner: 'nw', p: rotatePoint(g.x, g.y, cx, cy, g.rotation) },
          { corner: 'ne', p: rotatePoint(g.x + g.w, g.y, cx, cy, g.rotation) },
          { corner: 'se', p: rotatePoint(g.x + g.w, g.y + g.h, cx, cy, g.rotation) },
          { corner: 'sw', p: rotatePoint(g.x, g.y + g.h, cx, cy, g.rotation) },
        ];
        const rotateHandle = rotatePoint(cx, g.y - 7, cx, cy, g.rotation);
        const topEdge = rotatePoint(cx, g.y, cx, cy, g.rotation);
        return (
          <g transform={`translate(${fx} ${fy})`}>
            <line
              x1={topEdge.x}
              y1={topEdge.y}
              x2={rotateHandle.x}
              y2={rotateHandle.y}
              stroke="#1B6B4A"
              strokeWidth={0.2}
              pointerEvents="none"
            />
            {corners.map(({ corner, p }) => (
              <g key={corner}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={4}
                  fill="transparent"
                  style={{ cursor: 'nwse-resize' }}
                  onPointerDown={(e) =>
                    startTransform(e, selectionFrame.id, singleSelectedImage, 'resize', corner)
                  }
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={1.6}
                  fill="#FFFFFF"
                  stroke="#1B6B4A"
                  strokeWidth={0.35}
                  pointerEvents="none"
                />
              </g>
            ))}
            <circle
              cx={rotateHandle.x}
              cy={rotateHandle.y}
              r={4}
              fill="transparent"
              style={{ cursor: 'grab' }}
              onPointerDown={(e) =>
                startTransform(e, selectionFrame.id, singleSelectedImage, 'rotate')
              }
            />
            <circle
              cx={rotateHandle.x}
              cy={rotateHandle.y}
              r={1.8}
              fill="#1B6B4A"
              pointerEvents="none"
            />
          </g>
        );
      })()}
    </svg>
  );
}
