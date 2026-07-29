import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BoardElement,
  type BoardBackground,
  type BoardGridMm,
  type PageSizeMm,
  type ShapeKind,
  boundsIntersect,
  clampToPage,
  createShape,
  createStroke,
  elementBoundsCached,
  hitTest,
  roundMm,
} from '@/lib/whiteboard/model';
import {
  type StrokeRenderOptions,
  DEFAULT_STROKE_OPTIONS,
  backgroundToSvg,
  elementToSvg,
} from '@/lib/whiteboard/svg';

// Холст доски (задачи W1.0.2–W1.0.4; hot-path пересобран по ревью 5.6, р.2–4).
//
// Перф-инварианты (не ломать):
// 1. Живой ввод накапливается в ref и попадает в React-state МАКСИМУМ раз за
//    кадр (rAF).
// 2. Перетаскивание выделения — SVG transform поверх статичных слоёв; коммит
//    ОДИН, на pointerup.
// 3. Статичная сцена — отдельный memo-слой (SceneLayer): при рисовании и
//    перетаскивании reconcile сотен <g> не происходит вовсе (ревью р.4, P1).
// 4. Ластик копит попадания в ref, скрывает их per-frame и коммитит ОДНИМ
//    вызовом на pointerup — один шаг undo на жест и ноль перерендеров
//    родителя во время жеста (ревью р.4, P1).
// 5. Коммиты — вне setState-updater'ов (finishDrag читает ref'ы).
//
// Указатели: жест привязан к pointerId (ладонь не обрывает штрих). Второй
// ПАЛЕЦ во время рисования пальцем переключает жест в панорамирование
// (незавершённый штрих отбрасывается) — иначе увеличенный лист на планшете
// невозможно прокрутить (ревью р.4, P1).

export type BoardTool = 'pen' | 'eraser' | 'text' | 'select' | 'rect' | 'ellipse' | 'line';

interface BoardCanvasProps {
  elements: BoardElement[];
  background: BoardBackground;
  gridMm: BoardGridMm;
  /** Размер листа в мм — задаётся ориентацией страницы (model.pageSizeMm). */
  pageSize: PageSizeMm;
  tool: BoardTool;
  color: string;
  size: number;
  strokeOptions?: StrokeRenderOptions;
  selectedIds: string[];
  readOnly?: boolean;
  onCommitElement: (element: BoardElement) => void;
  /** Итог жеста ластика, ОДИН вызов на жест. */
  onEraseElements: (ids: string[]) => void;
  onSelectionChange: (ids: string[]) => void;
  /** Итог перетаскивания, ОДИН вызов на жест (для истории undo). */
  onMoveSelection: (dx: number, dy: number) => void;
  onRequestText: (x: number, y: number) => void;
  /** Прокрутить контейнер листа на (dx, dy) px — двухпальцевое панорамирование. */
  onPan?: (dx: number, dy: number) => void;
}

const ERASER_TOLERANCE_MM = 1.5;
const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>();

/** Один элемент. memo по id+version — версия меняется при любой правке (model.ts). */
const ElementNode = memo(
  ({ element, options }: { element: BoardElement; options: StrokeRenderOptions }) => {
    const nodes = elementToSvg(element, options);
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
          const Tag = node.tag as 'path' | 'rect' | 'ellipse' | 'line';
          return <Tag key={key} {...(node.attrs as Record<string, string | number>)} />;
        })}
      </>
    );
  },
  (prev, next) =>
    prev.element.id === next.element.id &&
    prev.element.version === next.element.version &&
    prev.options === next.options,
);
ElementNode.displayName = 'ElementNode';

/**
 * Статичный слой сцены. Пока рисуется штрих или тащится выделение, пропсы
 * слоя не меняются — reconcile сотен групп не происходит (ревью р.4, P1).
 */
const SceneLayer = memo(
  ({
    elements,
    hiddenIds,
    options,
  }: {
    elements: BoardElement[];
    hiddenIds: ReadonlySet<string>;
    options: StrokeRenderOptions;
  }) => (
    <>
      {elements.map((element) =>
        hiddenIds.has(element.id) ? null : (
          <g key={element.id}>
            <ElementNode element={element} options={options} />
          </g>
        ),
      )}
    </>
  ),
  (prev, next) =>
    prev.elements === next.elements &&
    prev.hiddenIds === next.hiddenIds &&
    prev.options === next.options,
);
SceneLayer.displayName = 'SceneLayer';

interface DragState {
  kind: 'stroke' | 'shape' | 'marquee' | 'move' | 'erase' | 'pan';
  /** Жест принадлежит одному указателю; чужие события игнорируются. */
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  /** Для pan — оба пальца. */
  panIds?: [number, number];
}

interface LiveShape {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function BoardCanvas({
  elements,
  background,
  gridMm,
  pageSize,
  tool,
  color,
  size,
  strokeOptions = DEFAULT_STROKE_OPTIONS,
  selectedIds,
  readOnly = false,
  onCommitElement,
  onEraseElements,
  onSelectionChange,
  onMoveSelection,
  onRequestText,
  onPan,
}: BoardCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const erasedRef = useRef<Set<string>>(new Set());
  const rectRef = useRef<DOMRect | null>(null);
  /** Живые позиции касаний (для панорамирования двумя пальцами). */
  const touchPosRef = useRef(new Map<number, { x: number; y: number }>());
  const panLastRef = useRef<{ x: number; y: number } | null>(null);

  // Источники правды живого ввода — ref'ы; состояние ниже только для рендера
  // и обновляется не чаще раза за кадр.
  const livePointsRef = useRef<number[] | null>(null);
  const liveShapeRef = useRef<LiveShape | null>(null);
  const marqueeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const moveOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const rafRef = useRef<number | null>(null);

  const [livePoints, setLivePoints] = useState<number[] | null>(null);
  const [liveShape, setLiveShape] = useState<LiveShape | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [moveOffset, setMoveOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(EMPTY_HIDDEN);

  const backgroundNodes = useMemo(
    () => backgroundToSvg(background, gridMm, pageSize),
    [background, gridMm, pageSize],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Раздельные слои: transform перетаскивания живёт на обёртке выделенного
  // слоя, статичный слой во время жеста не трогается вовсе.
  const { selectedElements, unselectedElements } = useMemo(() => {
    if (selectedSet.size === 0) {
      return { selectedElements: [] as BoardElement[], unselectedElements: elements };
    }
    const selected: BoardElement[] = [];
    const unselected: BoardElement[] = [];
    for (let i = 0; i < elements.length; i++) {
      (selectedSet.has(elements[i].id) ? selected : unselected).push(elements[i]);
    }
    return { selectedElements: selected, unselectedElements: unselected };
  }, [elements, selectedSet]);

  const scheduleFrame = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setLivePoints(livePointsRef.current ? livePointsRef.current.slice() : null);
      setLiveShape(liveShapeRef.current ? { ...liveShapeRef.current } : null);
      setMarquee(marqueeRef.current ? { ...marqueeRef.current } : null);
      setMoveOffset({ ...moveOffsetRef.current });
      setHiddenIds(erasedRef.current.size > 0 ? new Set(erasedRef.current) : EMPTY_HIDDEN);
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Скролл контейнера ВО ВРЕМЯ жеста делает кэшированный rect неверным — линия
  // уезжала бы от стилуса (ревью р.4, P1). Любой скролл инвалидирует кэш;
  // toMm перечитает и снова закэширует.
  useEffect(() => {
    const invalidate = () => {
      rectRef.current = null;
    };
    window.addEventListener('scroll', invalidate, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', invalidate, true);
  }, []);

  /** Координаты указателя → миллиметры страницы (rect кэшируется лениво). */
  const toMm = useCallback(
    (clientX: number, clientY: number) => {
      let rect = rectRef.current;
      if (!rect) {
        rect = svgRef.current?.getBoundingClientRect() ?? null;
        rectRef.current = rect;
      }
      if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
      return {
        x: ((clientX - rect.left) / rect.width) * pageSize.width,
        y: ((clientY - rect.top) / rect.height) * pageSize.height,
      };
    },
    [pageSize],
  );

  const eraseAt = useCallback(
    (x: number, y: number) => {
      // Только пометка в ref + кадр: НИКАКИХ коммитов наверх во время жеста —
      // иначе каждый задетый штрих перерендеривал родителя и миниатюру.
      let changed = false;
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (erasedRef.current.has(el.id)) continue;
        if (hitTest(el, x, y, ERASER_TOLERANCE_MM)) {
          erasedRef.current.add(el.id);
          changed = true;
        }
      }
      if (changed) scheduleFrame();
    },
    [elements, scheduleFrame],
  );

  const resetLiveState = useCallback(() => {
    livePointsRef.current = null;
    liveShapeRef.current = null;
    marqueeRef.current = null;
    moveOffsetRef.current = { dx: 0, dy: 0 };
    erasedRef.current = new Set();
    panLastRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setLivePoints(null);
    setLiveShape(null);
    setMarquee(null);
    setMoveOffset({ dx: 0, dy: 0 });
    setHiddenIds(EMPTY_HIDDEN);
  }, []);

  const finishDrag = useCallback(
    (event?: PointerEvent | React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Завершает жест только участвующий в нём указатель.
      if (event) {
        const belongs =
          drag.kind === 'pan'
            ? drag.panIds?.includes(event.pointerId) ?? false
            : event.pointerId === drag.pointerId;
        if (!belongs) return;
      }
      dragRef.current = null;
      rectRef.current = null;

      if (drag.kind === 'stroke') {
        const points = livePointsRef.current;
        if (points && points.length >= 3) {
          onCommitElement(createStroke(points, color, size));
        }
      } else if (drag.kind === 'shape') {
        const shape = liveShapeRef.current;
        // Отбрасываем «случайный клик»: фигура меньше половины миллиметра — промах.
        if (shape && (Math.abs(shape.w) > 0.5 || Math.abs(shape.h) > 0.5)) {
          onCommitElement(
            createShape(shape.kind, shape.x, shape.y, shape.w, shape.h, color, size),
          );
        }
      } else if (drag.kind === 'marquee') {
        const box = marqueeRef.current;
        if (box) {
          const region = {
            minX: Math.min(box.x, box.x + box.w),
            minY: Math.min(box.y, box.y + box.h),
            maxX: Math.max(box.x, box.x + box.w),
            maxY: Math.max(box.y, box.y + box.h),
          };
          const ids = elements
            .filter((el) => boundsIntersect(elementBoundsCached(el), region))
            .map((el) => el.id);
          if (ids.length > 0) onSelectionChange(ids);
        }
      } else if (drag.kind === 'move') {
        const { dx, dy } = moveOffsetRef.current;
        if (dx !== 0 || dy !== 0) onMoveSelection(roundMm(dx), roundMm(dy));
      } else if (drag.kind === 'erase') {
        // ОДИН коммит на весь жест: один шаг undo, одна пометка автосейва.
        if (erasedRef.current.size > 0) onEraseElements(Array.from(erasedRef.current));
      }

      resetLiveState();
    },
    [color, size, elements, onCommitElement, onEraseElements, onSelectionChange, onMoveSelection, resetLiveState],
  );

  /** Второй палец во время touch-жеста → панорамирование (штрих отбрасывается). */
  const convertToPan = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Накопленные ластиком удаления коммитим — они уже показаны пользователю.
      if (drag.kind === 'erase' && erasedRef.current.size > 0) {
        onEraseElements(Array.from(erasedRef.current));
      }
      const first = touchPosRef.current.get(drag.pointerId);
      const second = { x: event.clientX, y: event.clientY };
      dragRef.current = {
        kind: 'pan',
        pointerId: -1,
        pointerType: 'touch',
        startX: 0,
        startY: 0,
        panIds: [drag.pointerId, event.pointerId],
      };
      panLastRef.current = first
        ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        : second;
      // Незавершённый штрих/фигуру отбрасываем: намерение было «прокрутить».
      livePointsRef.current = null;
      liveShapeRef.current = null;
      marqueeRef.current = null;
      moveOffsetRef.current = { dx: 0, dy: 0 };
      erasedRef.current = new Set();
      scheduleFrame();
    },
    [onEraseElements, scheduleFrame],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (readOnly) return;
      // Только основная кнопка / касание: правый клик не должен рисовать.
      if (event.button !== 0) return;

      if (event.pointerType === 'touch') {
        touchPosRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      const drag = dragRef.current;
      if (drag) {
        // Второй ПАЛЕЦ поверх пальцевого жеста = панорамирование. Всё прочее
        // (ладонь при пере, третий палец) — игнорируется.
        if (
          onPan &&
          event.pointerType === 'touch' &&
          drag.pointerType === 'touch' &&
          drag.kind !== 'pan'
        ) {
          convertToPan(event);
        }
        return;
      }

      // ⚠️ КРИТИЧНО для инструмента «Текст»: default-действие mousedown уводит
      // фокус на body, и только что открытый textarea мгновенно ловил blur и
      // закрывался ПУСТЫМ — поле «не вставлялось» (репорт владельца, дважды).
      // Отменённый pointerdown подавляет compat-событие mousedown → фокус
      // никто не крадёт. Заодно убирает случайное выделение текста при рисовании.
      event.preventDefault();
      // Фокус из редактируемых полей забираем сами, детерминированно: их blur
      // (коммит названия/текста) обязан отработать ДО начала нового жеста.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
      ) {
        active.blur();
      }

      rectRef.current = event.currentTarget.getBoundingClientRect();
      const raw = toMm(event.clientX, event.clientY);
      const { x, y } = clampToPage(raw.x, raw.y, pageSize);
      event.currentTarget.setPointerCapture(event.pointerId);
      const pointerId = event.pointerId;
      const pointerType = event.pointerType;

      if (tool === 'text') {
        rectRef.current = null;
        onRequestText(roundMm(x), roundMm(y));
        return;
      }

      if (tool === 'pen') {
        // Настоящее давление есть только у стилуса; мышь и палец всегда шлют 0.5,
        // и доверять их «нажиму» — значит получить случайные утолщения.
        const pressure = pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
        dragRef.current = { kind: 'stroke', pointerId, pointerType, startX: x, startY: y };
        livePointsRef.current = [roundMm(x), roundMm(y), pressure];
        scheduleFrame();
        return;
      }

      if (tool === 'eraser') {
        erasedRef.current = new Set();
        dragRef.current = { kind: 'erase', pointerId, pointerType, startX: x, startY: y };
        eraseAt(x, y);
        return;
      }

      if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
        dragRef.current = { kind: 'shape', pointerId, pointerType, startX: x, startY: y };
        liveShapeRef.current = { kind: tool as ShapeKind, x: roundMm(x), y: roundMm(y), w: 0, h: 0 };
        scheduleFrame();
        return;
      }

      // select: клик по элементу — выделяем и готовимся тащить; по пустому — рамка.
      let hitId: string | null = null;
      for (let i = elements.length - 1; i >= 0; i--) {
        if (hitTest(elements[i], x, y, 1)) {
          hitId = elements[i].id;
          break;
        }
      }
      if (hitId) {
        if (!selectedSet.has(hitId)) onSelectionChange([hitId]);
        dragRef.current = { kind: 'move', pointerId, pointerType, startX: x, startY: y };
        moveOffsetRef.current = { dx: 0, dy: 0 };
      } else {
        onSelectionChange([]);
        dragRef.current = { kind: 'marquee', pointerId, pointerType, startX: x, startY: y };
        marqueeRef.current = { x, y, w: 0, h: 0 };
        scheduleFrame();
      }
    },
    [readOnly, toMm, tool, pageSize, onPan, convertToPan, onRequestText, eraseAt, elements, selectedSet, onSelectionChange, scheduleFrame],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || readOnly) return;

      if (event.pointerType === 'touch' && touchPosRef.current.has(event.pointerId)) {
        touchPosRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (drag.kind === 'pan') {
        if (!drag.panIds?.includes(event.pointerId)) return;
        const [a, b] = drag.panIds;
        const pa = touchPosRef.current.get(a);
        const pb = touchPosRef.current.get(b);
        if (!pa || !pb || !panLastRef.current) return;
        const centroid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        const dx = centroid.x - panLastRef.current.x;
        const dy = centroid.y - panLastRef.current.y;
        panLastRef.current = centroid;
        // Контент следует за пальцами: скролл в противоход.
        onPan?.(-dx, -dy);
        return;
      }

      if (event.pointerId !== drag.pointerId) return;
      const raw = toMm(event.clientX, event.clientY);
      const { x, y } = clampToPage(raw.x, raw.y, pageSize);

      if (drag.kind === 'stroke') {
        const pressure = event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
        livePointsRef.current?.push(roundMm(x), roundMm(y), pressure);
      } else if (drag.kind === 'erase') {
        eraseAt(x, y);
        return;
      } else if (drag.kind === 'shape') {
        const shape = liveShapeRef.current;
        if (shape) {
          shape.w = roundMm(x - drag.startX);
          shape.h = roundMm(y - drag.startY);
        }
      } else if (drag.kind === 'marquee') {
        marqueeRef.current = { x: drag.startX, y: drag.startY, w: x - drag.startX, h: y - drag.startY };
      } else if (drag.kind === 'move') {
        moveOffsetRef.current = { dx: x - drag.startX, dy: y - drag.startY };
      }

      scheduleFrame();
    },
    [readOnly, toMm, pageSize, eraseAt, scheduleFrame, onPan],
  );

  // Указатель может уйти с элемента или быть отменён системой (жест, звонок) —
  // без завершения drag остался бы «прилипший» штрих.
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

  // Живой штрих — ephemeral-объект БЕЗ модельных фабрик: createStroke двигает
  // глобальные id/seq-счётчики, а useMemo может исполняться повторно.
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

  const selectionBox = useMemo(() => {
    if (selectedElements.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < selectedElements.length; i++) {
      const b = elementBoundsCached(selectedElements[i]);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (minX === Infinity) return null;
    return { x: minX - 1, y: minY - 1, w: maxX - minX + 2, h: maxY - minY + 2 };
  }, [selectedElements]);

  const isMoving = moveOffset.dx !== 0 || moveOffset.dy !== 0;
  const moveTransform = isMoving ? `translate(${moveOffset.dx} ${moveOffset.dy})` : undefined;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
      className="h-full w-full bg-white"
      role="img"
      aria-label="Холст доски. Рисование мышью, пальцем или стилусом; двумя пальцами — прокрутка."
      // touch-none: без него iOS перехватывает жест и вместо линии скроллит
      // страницу (rule 80). Прокрутка увеличенного листа — двумя пальцами (onPan).
      style={{
        touchAction: 'none',
        cursor: readOnly ? 'default' : tool === 'select' ? 'default' : 'crosshair',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
    >
      {backgroundNodes.map((node, i) => (
        <path key={`bg-${i}`} {...(node.attrs as Record<string, string | number>)} />
      ))}

      <SceneLayer elements={unselectedElements} hiddenIds={hiddenIds} options={strokeOptions} />

      {selectedElements.length > 0 && (
        <g opacity={0.7} transform={moveTransform}>
          <SceneLayer elements={selectedElements} hiddenIds={hiddenIds} options={strokeOptions} />
        </g>
      )}

      {liveStroke && <ElementNode element={liveStroke} options={strokeOptions} />}
      {liveShapeElement && <ElementNode element={liveShapeElement} options={strokeOptions} />}

      {marquee && (
        <rect
          x={Math.min(marquee.x, marquee.x + marquee.w)}
          y={Math.min(marquee.y, marquee.y + marquee.h)}
          width={Math.abs(marquee.w)}
          height={Math.abs(marquee.h)}
          fill="#1B6B4A"
          fillOpacity={0.08}
          stroke="#1B6B4A"
          strokeWidth={0.2}
          strokeDasharray="1 1"
        />
      )}

      {selectionBox && (
        <rect
          x={selectionBox.x + moveOffset.dx}
          y={selectionBox.y + moveOffset.dy}
          width={selectionBox.w}
          height={selectionBox.h}
          fill="none"
          stroke="#1B6B4A"
          strokeWidth={0.3}
          strokeDasharray="1.5 1"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
