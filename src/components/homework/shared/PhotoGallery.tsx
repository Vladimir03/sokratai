/**
 * Лента миниатюр + просмотр во весь экран.
 *
 * С 2026-07-31 это тонкая обёртка над каноническим `PhotoViewer`
 * (план 1-ancient-quokka): собственный диалог, свайп и HEIC-фолбэк переехали
 * туда, а вместе с ними галерея получила зум, панораму и поворот. До переезда
 * «увеличить» означало «вписать в диалог» — джоб Ульяны U22 «его нельзя
 * развернуть» не закрывался.
 *
 * `SafeImage` тоже переехал — импортируйте его из `common/photo-viewer`,
 * здесь он больше не живёт.
 */

import { memo, useMemo } from 'react';
import { ZoomIn } from 'lucide-react';
import {
  PhotoThumbButton,
  PhotoViewer,
  type PhotoViewerItem,
  usePhotoViewer,
} from '@/components/common/photo-viewer';
import { type PhotoSurface } from '@/lib/photoViewerTelemetry';
import { resolveRefsForUrls } from '@/lib/photoOrientation';
import { usePhotoOrientations } from '@/hooks/usePhotoOrientation';

export interface PhotoGalleryProps {
  /** Готовые ссылки (signed URL или внешние). */
  images: string[];
  /**
   * `storage://…` в том же порядке, что `images`. Без них поворот не
   * сохраняется — только в пределах открытого окна.
   */
  imageRefs?: string[];
  dialogTitle: string;
  dialogDescription: string;
  imageAltPrefix: string;
  singleThumbnailClassName?: string;
  multiThumbnailClassName?: string;
  /** Поверхность для телеметрии. */
  surface?: PhotoSurface;
  /** Показывать кнопки поворота (репетиторские экраны). */
  canRotate?: boolean;
}

export const PhotoGallery = memo(function PhotoGallery({
  images,
  imageRefs,
  dialogTitle,
  dialogDescription,
  imageAltPrefix,
  singleThumbnailClassName = 'h-24 w-auto max-w-[220px] rounded-sm object-cover',
  multiThumbnailClassName = 'h-32 w-[120px] rounded-md border border-slate-200 bg-white object-contain',
  surface = 'homework_task',
  canRotate = false,
}: PhotoGalleryProps) {
  const { openIndex, open, close, navigate } = usePhotoViewer();

  // Позиционное сопоставление ref↔url безопасно только при совпадении длин —
  // разбор и причина в `resolveRefsForUrls`.
  const resolvedRefs = useMemo(() => resolveRefsForUrls(images, imageRefs), [imageRefs, images]);

  const items = useMemo<PhotoViewerItem[]>(
    () =>
      images.map((url, index) => ({
        url,
        ref: resolvedRefs[index],
        caption: images.length > 1 ? `${dialogTitle} · ${index + 1}` : dialogTitle,
        alt: `${imageAltPrefix} ${index + 1}`,
      })),
    [dialogTitle, imageAltPrefix, images, resolvedRefs],
  );

  // Миниатюры наследуют поворот: иначе репетитор решит, что он не сохранился.
  const refsForThumbs = resolvedRefs;
  const { orientations } = usePhotoOrientations(refsForThumbs);

  if (images.length === 0) return null;

  const viewer = (
    <PhotoViewer
      items={items}
      openIndex={openIndex}
      onClose={close}
      onNavigate={navigate}
      surface={surface}
      canRotate={canRotate}
      ariaTitle={dialogTitle}
      ariaDescription={dialogDescription}
    />
  );

  if (images.length === 1) {
    // Тот же ключ, по которому запрошены углы (`refsForThumbs`), а НЕ сырой
    // `imageRefs`: иначе там, где ref восстановлен из ссылки, миниатюра
    // осталась бы неповёрнутой — и в печатное превью уехало бы боком.
    const ref = refsForThumbs[0];
    return (
      <>
        <div className="group relative mt-2 inline-block rounded-md border bg-background p-1 transition-opacity hover:opacity-90">
          <PhotoThumbButton
            src={images[0]}
            alt={`${imageAltPrefix} 1`}
            index={0}
            onOpen={open}
            className={singleThumbnailClassName}
            degrees={ref ? orientations[ref] ?? 0 : 0}
            wrapperClassName="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-1 top-1 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
          >
            <ZoomIn className="h-3 w-3" />
            Увеличить
          </span>
        </div>
        {viewer}
      </>
    );
  }

  return (
    <>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1 touch-pan-x">
        {images.map((url, index) => {
          const ref = refsForThumbs[index];
          return (
            <PhotoThumbButton
              key={`${url}-${index}`}
              src={url}
              alt={`${imageAltPrefix} ${index + 1}`}
              index={index}
              onOpen={open}
              className={multiThumbnailClassName}
              degrees={ref ? orientations[ref] ?? 0 : 0}
            />
          );
        })}
      </div>
      {viewer}
    </>
  );
});

PhotoGallery.displayName = 'PhotoGallery';
