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

import { memo, useCallback, useRef } from 'react';
import { type PhotoDegrees } from '@/lib/photoOrientation';
import { SafeImage } from './SafeImage';
import { useQuarterTurnFit } from './useQuarterTurnFit';

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
  const { boxRef, transform } = useQuarterTurnFit<HTMLSpanElement>(degrees);

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
          style={transform ? { transform, transition: 'transform 150ms ease-out' } : undefined}
        />
      </span>
    </button>
  );
});

PhotoThumbButton.displayName = 'PhotoThumbButton';
