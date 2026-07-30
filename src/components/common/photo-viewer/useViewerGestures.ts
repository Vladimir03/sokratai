/**
 * Жесты просмотра фото: панорама, пинч, зум колесом, двойной тап, свайп.
 *
 * ⚠️ Главный инвариант UX: при увеличении ОДИН палец панорамирует, и свайп
 * между фото на это время отключается. Конфликт этих двух жестов — самая
 * частая поломка лайтбоксов: пользователь тянет увеличенную картинку, а она
 * листается на соседнюю.
 *
 * ⚠️ Главный инвариант перфоманса: положение живёт в ref, transform пишется
 * напрямую в DOM внутри rAF. React-состояние меняется только при пересечении
 * порога «увеличено / вписано» — это приём BoardCanvas (максимум один setState
 * за кадр), без него на iPad панорама заметно дёргается.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type PhotoDegrees } from '@/lib/photoOrientation';
import {
  type CameraView,
  type Point,
  type Size,
  DOUBLE_TAP_SCALE,
  IDENTITY_VIEW,
  MIN_SCALE,
  clampOffset,
  distanceBetween,
  isZoomedIn,
  midpointOf,
  panBy,
  viewToTransform,
  zoomAtPoint,
} from './viewerCamera';

/** Порог свайпа между фото и максимальное смещение, всё ещё считающееся тапом. */
const SWIPE_THRESHOLD_PX = 48;
const TAP_SLOP_PX = 10;
const DOUBLE_TAP_MS = 300;

export interface UseViewerGesturesOptions {
  natural: Size | null;
  degrees: PhotoDegrees;
  onSwipe?: (direction: 'prev' | 'next') => void;
  /** Отключает свайп, когда листать некуда (одно фото). */
  swipeEnabled?: boolean;
}

export interface UseViewerGesturesResult {
  containerRef: React.RefObject<HTMLDivElement>;
  stageRef: React.RefObject<HTMLDivElement>;
  /** Для показа кнопки «Сбросить» и переключения touch-action. */
  isZoomed: boolean;
  containerSize: Size;
  zoomBy: (factor: number) => void;
  reset: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function useViewerGestures({
  natural,
  degrees,
  onSwipe,
  swipeEnabled = true,
}: UseViewerGesturesOptions): UseViewerGesturesResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const viewRef = useRef<CameraView>(IDENTITY_VIEW);
  const frameRef = useRef<number | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);

  const [isZoomed, setIsZoomed] = useState(false);
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });

  const naturalRef = useRef<Size | null>(natural);
  naturalRef.current = natural;
  const degreesRef = useRef<PhotoDegrees>(degrees);
  degreesRef.current = degrees;
  const sizeRef = useRef<Size>(containerSize);
  sizeRef.current = containerSize;

  // ─── Отрисовка ─────────────────────────────────────────────────────────────

  const scheduleApply = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const stage = stageRef.current;
      if (stage) stage.style.transform = viewToTransform(viewRef.current);
    });
  }, []);

  const commitView = useCallback(
    (next: CameraView) => {
      viewRef.current = next;
      scheduleApply();
      const zoomedNow = isZoomedIn(next);
      // Единственный setState в горячем пути — и только на пересечении порога.
      setIsZoomed((prev) => (prev === zoomedNow ? prev : zoomedNow));
    },
    [scheduleApply],
  );

  const reset = useCallback(() => {
    commitView(IDENTITY_VIEW);
  }, [commitView]);

  // Смена фото или угла обнуляет камеру: вписывание пересчитано, старое
  // смещение к новому кадру отношения не имеет.
  useEffect(() => {
    reset();
  }, [natural, degrees, reset]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  // ─── Размер контейнера ─────────────────────────────────────────────────────

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const read = () => {
      const rect = node.getBoundingClientRect();
      setContainerSize((prev) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        // Сравнение по значению: ResizeObserver стреляет и когда ничего не
        // изменилось, а лишний setState здесь ронял бы memo сцены.
        return prev.width === width && prev.height === height ? prev : { width, height };
      });
    };

    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const toLocalPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const applyZoom = useCallback(
    (nextScale: number, anchor: Point) => {
      const size = naturalRef.current;
      if (!size) return;
      commitView(
        zoomAtPoint(viewRef.current, anchor, nextScale, size, sizeRef.current, degreesRef.current),
      );
    },
    [commitView],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const container = sizeRef.current;
      applyZoom(viewRef.current.scale * factor, {
        x: container.width / 2,
        y: container.height / 2,
      });
    },
    [applyZoom],
  );

  // ─── Колесо (non-passive: React вешает onWheel пассивно) ───────────────────

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (!naturalRef.current) return;
      event.preventDefault();
      // Тот же мягкий шаг, что на доске: экспонента вместо линейного прироста,
      // иначе масштаб «прыгает» на тачпаде.
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-event.deltaY * 0.0015)));
      applyZoom(viewRef.current.scale * factor, toLocalPoint(event.clientX, event.clientY));
    };

    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [applyZoom, toLocalPoint]);

  // ─── Указатели ─────────────────────────────────────────────────────────────

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!naturalRef.current) return;
      const point = toLocalPoint(event.clientX, event.clientY);
      pointersRef.current.set(event.pointerId, point);

      if (pointersRef.current.size === 2) {
        // Переход в пинч: одиночный жест отменяем, чтобы палец, начавший
        // панораму, не тянул картинку во время сведения пальцев.
        const [a, b] = Array.from(pointersRef.current.values());
        pinchRef.current = { distance: distanceBetween(a, b), scale: viewRef.current.scale };
        dragRef.current = null;
        return;
      }

      if (pointersRef.current.size > 2) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        moved: false,
      };
    },
    [toLocalPoint],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const size = naturalRef.current;
      if (!size) return;
      if (!pointersRef.current.has(event.pointerId)) return;

      const point = toLocalPoint(event.clientX, event.clientY);
      pointersRef.current.set(event.pointerId, point);

      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size === 2) {
        const [a, b] = Array.from(pointersRef.current.values());
        const distance = distanceBetween(a, b);
        if (pinch.distance > 0) {
          applyZoom(pinch.scale * (distance / pinch.distance), midpointOf(a, b));
        }
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;

      const dx = point.x - drag.lastX;
      const dy = point.y - drag.lastY;
      drag.lastX = point.x;
      drag.lastY = point.y;
      if (
        Math.abs(point.x - drag.startX) > TAP_SLOP_PX ||
        Math.abs(point.y - drag.startY) > TAP_SLOP_PX
      ) {
        drag.moved = true;
      }

      // Панорама только когда увеличено. Во вписанном виде горизонтальное
      // движение — это заявка на свайп, и она разрешается на pointerup.
      if (isZoomedIn(viewRef.current)) {
        commitView(panBy(viewRef.current, { x: dx, y: dy }, size, sizeRef.current, degreesRef.current));
      }
    },
    [applyZoom, commitView, toLocalPoint],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      pointersRef.current.delete(event.pointerId);

      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (pointersRef.current.size > 0) {
        // Один палец ещё на экране после пинча — не считаем это тапом.
        dragRef.current = null;
        return;
      }

      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!drag) return;

      const size = naturalRef.current;
      if (!size) return;

      const zoomed = isZoomedIn(viewRef.current);
      const dx = drag.lastX - drag.startX;

      if (!drag.moved) {
        // Двойной тап/клик: вписано → приблизить в точку, увеличено → сбросить.
        const now = Date.now();
        const previous = lastTapRef.current;
        const isDouble =
          previous !== null &&
          now - previous.at < DOUBLE_TAP_MS &&
          Math.abs(previous.x - drag.lastX) < TAP_SLOP_PX * 2 &&
          Math.abs(previous.y - drag.lastY) < TAP_SLOP_PX * 2;

        if (isDouble) {
          lastTapRef.current = null;
          if (zoomed) reset();
          else applyZoom(DOUBLE_TAP_SCALE, { x: drag.lastX, y: drag.lastY });
        } else {
          lastTapRef.current = { at: now, x: drag.lastX, y: drag.lastY };
        }
        return;
      }

      if (!zoomed && swipeEnabled && Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
        onSwipe?.(dx < 0 ? 'next' : 'prev');
        return;
      }

      // Пинч мог оставить смещение за границами — подтягиваем обратно.
      commitView(clampOffset(viewRef.current, size, sizeRef.current, degreesRef.current));
    },
    [applyZoom, commitView, onSwipe, reset, swipeEnabled],
  );

  // Первый рендер и смена кадра: transform должен совпасть с viewRef сразу,
  // иначе увеличенная предыдущая картинка на миг «прилипает» к новой.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage) stage.style.transform = viewToTransform(viewRef.current);
  }, [containerSize, natural, degrees]);

  return {
    containerRef,
    stageRef,
    isZoomed,
    containerSize,
    zoomBy,
    reset,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}

export { MIN_SCALE };
