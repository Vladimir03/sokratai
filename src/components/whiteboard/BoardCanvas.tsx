import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BoardElement,
  type BoardBackground,
  type BoardGridMm,
  type ShapeKind,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  boundsIntersect,
  clampToPage,
  createShape,
  createStroke,
  elementBounds,
  hitTest,
  roundMm,
} from '@/lib/whiteboard/model';
import {
  type StrokeRenderOptions,
  DEFAULT_STROKE_OPTIONS,
  backgroundToSvg,
  elementToSvg,
} from '@/lib/whiteboard/svg';

// Холст доски (задачи W1.0.2–W1.0.4).
//
// Рендер — SVG с viewBox в МИЛЛИМЕТРАХ, поэтому геометрия одна и та же на экране
// и в PDF, а верстка тянется под любой размер без пересчёта координат.
//
// ⚠️ Живой штрих вынесен в ОТДЕЛЬНЫЙ слой и не попадает в общий массив элементов
// до отпускания пера. Иначе каждое движение указателя перерисовывало бы весь
// конспект — это и есть та «просадка на длинных страницах», из-за которой доски
// начинают «виснуть» (spec §8).

export type BoardTool = 'pen' | 'eraser' | 'text' | 'select' | 'rect' | 'ellipse' | 'line';

interface BoardCanvasProps {
  elements: BoardElement[];
  background: BoardBackground;
  gridMm: BoardGridMm;
  tool: BoardTool;
  color: string;
  size: number;
  strokeOptions?: StrokeRenderOptions;
  selectedIds: string[];
  readOnly?: boolean;
  onCommitElement: (element: BoardElement) => void;
  onEraseElements: (ids: string[]) => void;
  onSelectionChange: (ids: string[]) => void;
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
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

export function BoardCanvas({
  elements,
  background,
  gridMm,
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
  const [livePoints, setLivePoints] = useState<number[] | null>(null);
  const [liveShape, setLiveShape] = useState<BoardElement | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const backgroundNodes = useMemo(
    () => backgroundToSvg(background, gridMm),
    [background, gridMm],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  /** Координаты указателя → миллиметры страницы. */
  const toMm = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * PAGE_WIDTH_MM,
      y: ((clientY - rect.top) / rect.height) * PAGE_HEIGHT_MM,
    };
  }, []);

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

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (readOnly) return;
      // Только основная кнопка / касание: правый клик не должен рисовать.
      if (event.button !== 0) return;
      const raw = toMm(event.clientX, event.clientY);
      const { x, y } = clampToPage(raw.x, raw.y);
      event.currentTarget.setPointerCapture(event.pointerId);

      if (tool === 'text') {
        onRequestText(roundMm(x), roundMm(y));
        return;
      }

      if (tool === 'pen') {
        // Настоящее давление есть только у стилуса; мышь и палец всегда шлют 0.5,
        // и доверять их «нажиму» — значит получить случайные утолщения.
        const pressure = event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
        dragRef.current = { kind: 'stroke', startX: x, startY: y, lastX: x, lastY: y };
        setLivePoints([roundMm(x), roundMm(y), pressure]);
        return;
      }

      if (tool === 'eraser') {
        erasedRef.current = new Set();
        dragRef.current = { kind: 'erase', startX: x, startY: y, lastX: x, lastY: y };
        eraseAt(x, y);
        return;
      }

      if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
        dragRef.current = { kind: 'shape', startX: x, startY: y, lastX: x, lastY: y };
        setLiveShape(createShape(tool as ShapeKind, roundMm(x), roundMm(y), 0, 0, color, size));
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
        dragRef.current = { kind: 'move', startX: x, startY: y, lastX: x, lastY: y };
      } else {
        onSelectionChange([]);
        dragRef.current = { kind: 'marquee', startX: x, startY: y, lastX: x, lastY: y };
        setMarquee({ x, y, w: 0, h: 0 });
      }
    },
    [readOnly, toMm, tool, onRequestText, color, size, eraseAt, elements, selectedSet, onSelectionChange],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || readOnly) return;
      const raw = toMm(event.clientX, event.clientY);
      const { x, y } = clampToPage(raw.x, raw.y);

      if (drag.kind === 'stroke') {
        // Настоящее давление есть только у стилуса; мышь и палец всегда шлют 0.5,
        // и доверять их «нажиму» — значит получить случайные утолщения.
        const pressure = event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
        setLivePoints((prev) => (prev ? [...prev, roundMm(x), roundMm(y), pressure] : prev));
      } else if (drag.kind === 'erase') {
        eraseAt(x, y);
      } else if (drag.kind === 'shape') {
        setLiveShape((prev) =>
          prev && prev.type === 'shape'
            ? { ...prev, w: roundMm(x - drag.startX), h: roundMm(y - drag.startY) }
            : prev,
        );
      } else if (drag.kind === 'marquee') {
        setMarquee({ x: drag.startX, y: drag.startY, w: x - drag.startX, h: y - drag.startY });
      } else if (drag.kind === 'move') {
        onMoveSelection(roundMm(x - drag.lastX), roundMm(y - drag.lastY));
      }

      drag.lastX = x;
      drag.lastY = y;
    },
    [readOnly, toMm, eraseAt, onMoveSelection],
  );

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    if (drag.kind === 'stroke') {
      setLivePoints((points) => {
        if (points && points.length >= 3) {
          onCommitElement(createStroke(points, color, size));
        }
        return null;
      });
    } else if (drag.kind === 'shape') {
      setLiveShape((shape) => {
        // Отбрасываем «случайный клик»: фигура меньше половины миллиметра — промах.
        if (shape && shape.type === 'shape' && (Math.abs(shape.w) > 0.5 || Math.abs(shape.h) > 0.5)) {
          onCommitElement(shape);
        }
        return null;
      });
    } else if (drag.kind === 'marquee') {
      setMarquee((box) => {
        if (box) {
          const region = {
            minX: Math.min(box.x, box.x + box.w),
            minY: Math.min(box.y, box.y + box.h),
            maxX: Math.max(box.x, box.x + box.w),
            maxY: Math.max(box.y, box.y + box.h),
          };
          const ids = elements
            .filter((el) => boundsIntersect(elementBounds(el), region))
            .map((el) => el.id);
          if (ids.length > 0) onSelectionChange(ids);
        }
        return null;
      });
    } else if (drag.kind === 'erase') {
      erasedRef.current = new Set();
    }
  }, [color, size, elements, onCommitElement, onSelectionChange]);

  // Указатель может уйти с элемента или быть отменён системой (жест, звонок) —
  // без завершения drag остался бы «прилипший» штрих.
  useEffect(() => {
    const handleUp = () => finishDrag();
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [finishDrag]);

  const liveStroke = useMemo(
    () => (livePoints && livePoints.length >= 3 ? createStroke(livePoints, color, size) : null),
    [livePoints, color, size],
  );

  const selectionBox = useMemo(() => {
    if (selectedIds.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < elements.length; i++) {
      if (!selectedSet.has(elements[i].id)) continue;
      const b = elementBounds(elements[i]);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (minX === Infinity) return null;
    return { x: minX - 1, y: minY - 1, w: maxX - minX + 2, h: maxY - minY + 2 };
  }, [selectedIds, elements, selectedSet]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${PAGE_WIDTH_MM} ${PAGE_HEIGHT_MM}`}
      className="h-full w-full bg-white"
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

      {elements.map((element) => (
        <g key={element.id} opacity={selectedSet.has(element.id) ? 0.7 : 1}>
          <ElementNode element={element} options={strokeOptions} />
        </g>
      ))}

      {liveStroke && <ElementNode element={liveStroke} options={strokeOptions} />}
      {liveShape && <ElementNode element={liveShape} options={strokeOptions} />}

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
          x={selectionBox.x}
          y={selectionBox.y}
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
