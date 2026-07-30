/**
 * Контролируемый полноэкранный просмотр (конструктор ДЗ, загрузчики Банка).
 *
 * С 2026-07-31 — тонкая обёртка над каноническим `PhotoViewer`
 * (план 1-ancient-quokka). Своя реализация свайпа и стрелок удалена: она была
 * третьей копией одной карусели и, как и остальные, не умела ни зум, ни
 * поворот, ни восстановление HEIC.
 *
 * Контракт props сохранён — все существующие вызовы работают без правок.
 */

import { memo, useMemo } from 'react';
import {
  PhotoViewer,
  type PhotoViewerItem,
} from '@/components/common/photo-viewer';
import { type PhotoSurface } from '@/lib/photoViewerTelemetry';

export interface FullscreenImageCarouselProps {
  images: string[];
  openIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  ariaTitle?: string;
  ariaDescription?: string;
  /** `storage://…` в порядке `images` — включает сохранение поворота. */
  imageRefs?: string[];
  surface?: PhotoSurface;
  canRotate?: boolean;
}

export const FullscreenImageCarousel = memo(function FullscreenImageCarousel({
  images,
  openIndex,
  onClose,
  onNavigate,
  ariaTitle = 'Фото',
  ariaDescription = 'Просмотр изображений во весь экран',
  imageRefs,
  surface = 'homework_constructor',
  canRotate = false,
}: FullscreenImageCarouselProps) {
  const items = useMemo<PhotoViewerItem[]>(
    () =>
      images.map((url, index) => ({
        url,
        ref: imageRefs?.[index] ?? null,
        caption: images.length > 1 ? `${ariaTitle} · ${index + 1}` : ariaTitle,
        alt: `${ariaTitle} ${index + 1}`,
      })),
    [ariaTitle, imageRefs, images],
  );

  return (
    <PhotoViewer
      items={items}
      openIndex={openIndex}
      onClose={onClose}
      onNavigate={onNavigate}
      surface={surface}
      canRotate={canRotate}
      ariaTitle={ariaTitle}
      ariaDescription={ariaDescription}
    />
  );
});

FullscreenImageCarousel.displayName = 'FullscreenImageCarousel';
