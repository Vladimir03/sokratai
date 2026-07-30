/**
 * Коэффициент ужимания для картинки, повёрнутой на 90/270 внутри фиксированной
 * коробки: после четверти оборота стороны меняются местами и содержимое
 * вылезает за свои границы.
 *
 * Наблюдатель заводится ТОЛЬКО для четвертей — миниатюр на экране бывают
 * сотни, а обычный случай (0/180) коррекции не требует вовсе.
 */

import { useEffect, useRef, useState } from 'react';
import { type PhotoDegrees, isQuarterTurn } from '@/lib/photoOrientation';

export interface UseQuarterTurnFitResult<T extends HTMLElement> {
  boxRef: React.RefObject<T>;
  /** Готовый CSS-трансформ либо undefined, когда поворот не нужен. */
  transform: string | undefined;
}

export function useQuarterTurnFit<T extends HTMLElement>(
  degrees: PhotoDegrees,
): UseQuarterTurnFitResult<T> {
  const boxRef = useRef<T>(null);
  const [scale, setScale] = useState(1);
  const quarter = isQuarterTurn(degrees);

  useEffect(() => {
    if (!quarter) {
      setScale(1);
      return undefined;
    }
    const node = boxRef.current;
    if (!node) return undefined;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = Math.min(rect.width / rect.height, rect.height / rect.width);
      setScale((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [quarter]);

  return {
    boxRef,
    transform: degrees === 0 ? undefined : `rotate(${degrees}deg) scale(${scale})`,
  };
}
