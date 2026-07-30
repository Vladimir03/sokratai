/**
 * Миниатюра, открывающая просмотрщик, с наследованием поворота.
 *
 * ⚠️ Наследование обязательно: репетитор повернул фото в просмотре, закрыл —
 * и в ленте оно снова боком. Он бы решил, что поворот не сохранился, и крутил
 * бы каждый раз заново.
 *
 * Тач-сдвиг гасит клик (`TAP_SLOP_PX`): миниатюры живут в горизонтальных
 * лентах, и без этого попытка пролистать ленту открывала бы фото.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { type PhotoDegrees, isQuarterTurn } from '@/lib/photoOrientation';
import { SafeImage } from './SafeImage';

const TAP_SLOP_PX = 12;

export interface PhotoThumbButtonProps {
  src: string;
  alt: string;
  index: number;
  onOpen: (index: number) => void;
  /** Классы для `<img>` — каждая поверхность держит свои размеры. */
  className: string;
  degrees?: PhotoDegrees;
  /** Классы кнопки-обёртки. */
  wrapperClassName?: string;
}

export const PhotoThumbButton = memo(function PhotoThumbButton({
  src,
  alt,
  index,
  onOpen,
  className,
  degrees = 0,
  wrapperClassName,
}: PhotoThumbButtonProps) {
  const touchStartXRef = useRef<number | null>(null);
  const ignoreClickRef = useRef(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const [quarterScale, setQuarterScale] = useState(1);

  const quarter = isQuarterTurn(degrees);

  // Повёрнутая на четверть картинка вылезает за свою коробку — ужимаем ровно
  // настолько, чтобы вписаться обратно. Наблюдатель заводим ТОЛЬКО для
  // четвертей: миниатюр на экране бывает много, а обычный случай — 0/180.
  useEffect(() => {
    if (!quarter) {
      setQuarterScale(1);
      return undefined;
    }
    const node = boxRef.current;
    if (!node) return undefined;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = Math.min(rect.width / rect.height, rect.height / rect.width);
      setQuarterScale((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [quarter]);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLButtonElement>) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
    ignoreClickRef.current = false;
  }, []);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLButtonElement>) => {
    if (touchStartXRef.current == null) return;
    const currentX = event.touches[0]?.clientX ?? touchStartXRef.current;
    if (Math.abs(currentX - touchStartXRef.current) > TAP_SLOP_PX) {
      ignoreClickRef.current = true;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchStartXRef.current = null;
  }, []);

  const handleClick = useCallback(() => {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    onOpen(index);
  }, [index, onOpen]);

  return (
    <button
      type="button"
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      aria-label={`Открыть ${alt.toLowerCase()} во весь экран`}
      style={{ touchAction: 'manipulation' }}
      className={
        wrapperClassName ??
        'shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2'
      }
    >
      <span ref={boxRef} className="block overflow-hidden rounded-md">
        <SafeImage
          src={src}
          alt={alt}
          className={className}
          interactive={false}
          style={
            degrees === 0
              ? undefined
              : {
                  transform: `rotate(${degrees}deg) scale(${quarterScale})`,
                  transition: 'transform 150ms ease-out',
                }
          }
        />
      </span>
    </button>
  );
});

PhotoThumbButton.displayName = 'PhotoThumbButton';
