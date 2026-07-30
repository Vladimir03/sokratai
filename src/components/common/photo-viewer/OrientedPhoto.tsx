/**
 * Картинка, показанная под сохранённым углом, без права его менять.
 *
 * ⚠️ Ученик УЧАСТВУЕТ в повороте: угол читают все (решение владельца —
 * «повернул репетитор, ученик видит так же»), а пишет только репетитор, и это
 * гейтится `is_tutor` внутри RPC. Без этого компонента репетитор разворачивал
 * боковое условие, а школьник на телефоне продолжал смотреть его боком — и
 * смысл сохранения угла пропадал.
 *
 * Ref восстанавливается ИЗ подписанной ссылки: позиционному сопоставлению с
 * массивом ref'ов доверять нельзя (разбор — в `resolveRefsForUrls`).
 *
 * Запросы углов от всех таких картинок склеиваются в один RPC —
 * см. пакетирование в `fetchPhotoOrientations`.
 */

import { memo, useMemo } from 'react';
import { storageRefFromUrl } from '@/lib/photoOrientation';
import { usePhotoOrientations } from '@/hooks/usePhotoOrientation';
import { SafeImage } from './SafeImage';
import { useQuarterTurnFit } from './useQuarterTurnFit';

export interface OrientedPhotoProps {
  src: string;
  alt: string;
  className: string;
  /** Классы обёртки, которая измеряется для коррекции четвертного поворота. */
  wrapperClassName?: string;
  /** false → фолбэк не рисует `<a>` (когда компонент внутри `<button>`). */
  interactive?: boolean;
}

export const OrientedPhoto = memo(function OrientedPhoto({
  src,
  alt,
  className,
  wrapperClassName = 'block',
  interactive = true,
}: OrientedPhotoProps) {
  const refs = useMemo(() => [storageRefFromUrl(src)], [src]);
  const { orientations } = usePhotoOrientations(refs);
  const degrees = refs[0] ? orientations[refs[0]] ?? 0 : 0;
  const { boxRef, transform } = useQuarterTurnFit<HTMLSpanElement>(degrees);

  return (
    <span ref={boxRef} className={wrapperClassName}>
      <SafeImage
        src={src}
        alt={alt}
        className={className}
        interactive={interactive}
        style={transform ? { transform, transition: 'transform 150ms ease-out' } : undefined}
      />
    </span>
  );
});

OrientedPhoto.displayName = 'OrientedPhoto';
