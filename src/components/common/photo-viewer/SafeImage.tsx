/**
 * Картинка с восстановлением HEIC и честным фолбэком «скачать».
 *
 * Переехала сюда из `homework/shared/PhotoGallery.tsx` (2026-07-31) и стала
 * общей: до переезда HEIC-восстановление работало ровно на двух поверхностях
 * из полутора десятков, поэтому баг Ирины Бочаровой (Windows, сырой `.heic`
 * с iPhone ученика) воспроизводился в пробниках, Банке знаний и чате даже
 * после починки ДЗ.
 *
 * Два режима, чтобы не рождать вложенные интерактивные элементы:
 *
 *   interactive=true (по умолчанию) — фолбэк рисуется как `<a download>`.
 *   interactive=false — фолбэк это инертный `<span>`; обязателен, когда
 *     SafeImage живёт внутри `<button>` (миниатюра): вложенный `<a>` внутри
 *     `<button>` — невалидная разметка с неоднозначным кликом.
 */

import { memo, useCallback, useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { useHeicImage } from '@/hooks/useHeicImage';
import { isHeicLikeUrl } from '@/lib/heicDecode';

export interface SafeImageProps {
  src: string;
  alt: string;
  className: string;
  fallbackClassName?: string;
  /** false → фолбэк инертный `<span>` (для использования внутри `<button>`). */
  interactive?: boolean;
  /** Натуральные размеры после успешной загрузки — нужны просмотрщику для вписывания. */
  onNaturalSize?: (size: { width: number; height: number }) => void;
  /** Инлайновые стили — просмотрщик задаёт вычисленные ширину/высоту и поворот. */
  style?: React.CSSProperties;
  draggable?: boolean;
  /** Текущее фото просмотрщика грузим сразу, соседние — лениво. */
  loading?: 'lazy' | 'eager';
}

export const SafeImage = memo(function SafeImage({
  src,
  alt,
  className,
  fallbackClassName,
  interactive = true,
  onNaturalSize,
  style,
  draggable,
  loading = 'lazy',
}: SafeImageProps) {
  // onError для .heic сначала пробует ленивую wasm-конвертацию (useHeicImage);
  // янтарная карточка — последний рубеж (баг Ирины Бочаровой, 2026-07-30).
  const { effectiveSrc, state, onImgError } = useHeicImage(src);
  const isHeicLike = isHeicLikeUrl(src);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget;
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        onNaturalSize?.({ width: img.naturalWidth, height: img.naturalHeight });
      }
    },
    [onNaturalSize],
  );

  /**
   * ⚠️ Одного `onLoad` НЕДОСТАТОЧНО. Если картинка уже декодирована (лежит в
   * кэше браузера, открывали её же секунду назад, или её прогрел prefetch
   * соседей в просмотрщике), событие `load` успевает выстрелить ДО того, как
   * React повесит обработчик, — и размеры не приходят никогда. Просмотрщик
   * тогда сваливается в резервный режим вёрстки, и фото вылезает за экран.
   *
   * Поэтому после монтирования и на каждую смену src дочитываем размеры
   * напрямую у уже готового элемента (`complete`).
   */
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !onNaturalSize) return;
    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      onNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    }
  }, [effectiveSrc, onNaturalSize]);

  if (state === 'converting') {
    // span, а не div: SafeImage живёт и внутри <button>.
    return (
      <span
        className={`${className} inline-block animate-pulse rounded-md bg-muted`}
        style={style}
        aria-label="Конвертируем фото…"
      />
    );
  }

  if (state === 'failed') {
    const fallbackContent = (
      <>
        <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-xs">{isHeicLike ? 'HEIC — скачать' : 'Не открывается'}</span>
      </>
    );
    const defaultClass =
      'inline-flex h-24 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900';
    const title = isHeicLike
      ? 'iPhone-фото в HEIC-формате — не отображается в этом браузере. Скачайте оригинал.'
      : 'Браузер не смог открыть файл. Скачайте оригинал.';

    if (!interactive) {
      return (
        <span className={fallbackClassName || defaultClass} title={title} aria-label={title}>
          {fallbackContent}
        </span>
      );
    }

    return (
      // Без target="_blank": HTML5-атрибут download игнорируется для
      // cross-origin ссылки, когда задан target.
      <a
        href={src}
        download={alt}
        rel="noreferrer"
        className={`${fallbackClassName || defaultClass} hover:bg-amber-100`}
        title={title}
      >
        {fallbackContent}
      </a>
    );
  }

  return (
    <img
      ref={imgRef}
      src={effectiveSrc}
      alt={alt}
      loading={loading}
      className={className}
      style={style}
      draggable={draggable}
      onLoad={handleLoad}
      onError={onImgError}
    />
  );
});

SafeImage.displayName = 'SafeImage';
