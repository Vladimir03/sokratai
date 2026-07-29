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

// Холст доски (задачи W1.0.2–W1.0.4; hot-path пересобран по ревью 5.6).
//
// Рендер — SVG с viewBox в МИЛЛИМЕТРАХ: геометрия одна и та же на экране и в PDF.
//
// Три перф-инварианта (ревью 5.6, не ломать):
// 1. Живой ввод накапливается в ref и попадает в React-state МАКСИМУМ раз за
//    кадр (rAF). Прямой setState на каждый pointermove давал квадратичную
//    работу по длине штриха.
// 2. Перетаскивание выделения — CSS/SVG transform поверх статичных элементов;
//    новые объекты создаются ОДИН раз, на pointerup. Map по всем элементам на
//    каждое движение — то, из-за чего курсор отставал от стилуса.
// 3. Коммиты элементов происходят вне setState-updater'ов (finishDrag читает
//    ref'ы) — updater обязан быть чистым, в StrictMode он исполняется дважды.
//
// Multi-pointer: drag привязан к pointerId. Ладонь или второй палец во время
// письма пером не обрывают и не перехватывают штрих.

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
  onEraseElements: (ids: string[]) => void;
  onSelectionChange: (ids: string[]) => void;
  /** Итог перетаскивания, ОДИН вызов на жест (для истории undo). */
  onMoveSelection: (dx: number, dy: number) => void;
  onRequestText: (x: number, y: number) => void;
}

const ERASER_TOLERANCE_MM = 1.5;

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

interface DragState {
  kind: 'stroke' | 'shape' | 'marquee' | 'move' | 'erase';
  /** Жест принадлежит одному указателю; чужие события игнорируются. */
  pointerId: number;
  startX: number;
  startY: number;
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
}: BoardCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const erasedRef = useRef<Set<string>>(new Set());
  // Rect кэшируется на pointerdown: getBoundingClientRect на каждом pointermove —
  // принудительный layout в самом горячем месте (ревью 5.6).
  const rectRef = useRef<DOMRect | null>(null);

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

  const backgroundNodes = useMemo(
    () => backgroundToSvg(background, gridMm, pageSize),
    [background, gridMm, pageSize],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const scheduleFrame = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setLivePoints(livePointsRef.current ? livePointsRef.current.slice() : null);
      setLiveShape(liveShapeRef.current ? { ...liveShapeRef.current } : null);
      setMarquee(marqueeRef.current ? { ...marqueeRef.current } : null);
      setMoveOffset({ ...moveOffsetRef.current });
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /** Координаты указателя → миллиметры страницы (по кэшированному rect). */
  const toMm = useCallback(
    (clientX: number, clientY: number) => {
      const rect = rectRef.current ?? svgRef.current?.getBoundingClientRect() ?? null;
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
      const hits: string[] = [];
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (erasedRef.current.has(el.id)) continue;
        if (hitTest(el, x, y, ERASER_TOLERANCE_MM)) {
          erasedRef.current.add(el.id);
          hits.push(el.id);
        }
      }
      if (hits.length > 0) onEraseElements(hits);
    },
    [elements, onEraseElements],
  );

  const resetLiveState = useCallback(() => {
    livePointsRef.current = null;
    liveShapeRef.current = null;
    marqueeRef.current = null;
    moveOffsetRef.current = { dx: 0, dy: 0 };
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setLivePoints(null);
    setLiveShape(null);
    setMarquee(null);
    setMoveOffset({ dx: 0, dy: 0 });
  }, []);

  const finishDrag = useCallback(
    (event?: PointerEvent | React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Завершает жест только ТОТ указатель, что его начал: отпущенная ладонь
      // не должна обрывать штрих пера (ревью 5.6, P1).
      if (event && event.pointerId !== drag.pointerId) return;
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
        erasedRef.current = new Set();
      }

      resetLiveState();
    },
    [color, size, elements, onCommitElement, onSelectionChange, onMoveSelection, resetLiveState],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (readOnly) return;
      // Только основная кнопка / касание: правый клик не должен рисовать.
      if (event.button !== 0) return;
      // Жест уже идёт → второй указатель (ладонь, второй палец) игнорируется.
      if (dragRef.current) return;
      // Не-primary касание (мультитач) не начинает новый жест.
      if (event.pointerType === 'touch' && !event.isPrimary) return;

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

      if (tool === 'text') {
        rectRef.current = null;
        onRequestText(roundMm(x), roundMm(y));
        return;
      }

      if (tool === 'pen') {
        // Настоящее давление есть только у стилуса; мышь и палец всегда шлют 0.5,
        // и доверять их «нажиму» — значит получить случайные утолщения.
        const pressure = event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
        dragRef.current = { kind: 'stroke', pointerId, startX: x, startY: y };
        livePointsRef.current = [roundMm(x), roundMm(y), pressure];
        scheduleFrame();
        return;
      }

      if (tool === 'eraser') {
        erasedRef.current = new Set();
        dragRef.current = { kind: 'erase', pointerId, startX: x, startY: y };
        eraseAt(x, y);
        return;
      }

      if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
        dragRef.current = { kind: 'shape', pointerId, startX: x, startY: y };
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
        dragRef.current = { kind: 'move', pointerId, startX: x, startY: y };
        moveOffsetRef.current = { dx: 0, dy: 0 };
      } else {
        onSelectionChange([]);
        dragRef.current = { kind: 'marquee', pointerId, startX: x, startY: y };
        marqueeRef.current = { x, y, w: 0, h: 0 };
        scheduleFrame();
      }
    },
    [readOnly, toMm, tool, pageSize, onRequestText, eraseAt, elements, selectedSet, onSelectionChange, scheduleFrame],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || readOnly) return;
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
    [readOnly, toMm, pageSize, eraseAt, scheduleFrame],
  );

  // Указатель может уйти с элемента или быть отменён системой (жест, звонок) —
  // без завершения drag остался бы «прилипший» штрих.
  useEffect(() => {
    const handleUp = (event: PointerEvent) => finishDrag(event);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [finishDrag]);

  // Живой штрих — ephemeral-объект БЕЗ модельных фабрик: createStroke двигает
  // глобальные id/seq-счётчики, а useMemo может исполняться повторно (ревью 5.6, P2).
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
    if (selectedIds.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < elements.length; i++) {
      if (!selectedSet.has(elements[i].id)) continue;
      const b = elementBoundsCached(elements[i]);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (minX === Infinity) return null;
    return { x: minX - 1, y: minY - 1, w: maxX - minX + 2, h: maxY - minY + 2 };
  }, [selectedIds, elements, selectedSet]);

  const isMoving = moveOffset.dx !== 0 || moveOffset.dy !== 0;
  const moveTransform = isMoving ? `translate(${moveOffset.dx} ${moveOffset.dy})` : undefined;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
      className="h-full w-full bg-white"
      role="img"
      aria-label="Холст доски. Рисование мышью, пальцем или стилусом."
      // touch-none: без него iOS перехватывает жест и вместо линии скроллит
      // страницу (rule 80). Курсор — подсказка активного инструмента.
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

      {/* Перетаскивание — transform на группе выделенных: элементы не пересоздаются
          до pointerup, статичная часть страницы вообще не перерисовывается. */}
      {elements.map((element) => {
        const isSelected = selectedSet.has(element.id);
        return (
          <g
            key={element.id}
            opacity={isSelected ? 0.7 : 1}
            transform={isSelected ? moveTransform : undefined}
          >
            <ElementNode element={element} options={strokeOptions} />
          </g>
        );
      })}

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
