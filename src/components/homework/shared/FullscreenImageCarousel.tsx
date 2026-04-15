import { memo, useCallback, useEffect, useRef, type TouchEvent as ReactTouchEvent } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const TAP_THRESHOLD_MS = 250;
export const SWIPE_THRESHOLD_PX = 40;

export interface FullscreenImageCarouselProps {
  images: string[];
  openIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  ariaTitle?: string;
  ariaDescription?: string;
}

export const FullscreenImageCarousel = memo(function FullscreenImageCarousel({
  images,
  openIndex,
  onClose,
  onNavigate,
  ariaTitle = 'Фото',
  ariaDescription = 'Просмотр изображений во весь экран',
}: FullscreenImageCarouselProps) {
  const touchStartXRef = useRef<number | null>(null);
  const touchStartAtRef = useRef<number | null>(null);
  const canGoPrev = openIndex !== null && openIndex > 0;
  const canGoNext = openIndex !== null && openIndex < images.length - 1;

  const goPrev = useCallback(() => {
    if (!canGoPrev || openIndex === null) return;
    onNavigate(openIndex - 1);
  }, [canGoPrev, onNavigate, openIndex]);

  const goNext = useCallback(() => {
    if (!canGoNext || openIndex === null) return;
    onNavigate(openIndex + 1);
  }, [canGoNext, onNavigate, openIndex]);

  useEffect(() => {
    if (openIndex === null) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, openIndex]);

  useEffect(() => {
    if (openIndex === null) return;
    if (images.length === 0 || openIndex >= images.length) {
      onClose();
    }
  }, [images.length, onClose, openIndex]);

  const handleViewerTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
    touchStartAtRef.current = Date.now();
  }, []);

  const handleViewerTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    if (touchStartXRef.current == null) return;

    const touchEndX = event.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const deltaX = touchEndX - touchStartXRef.current;
    const durationMs = touchStartAtRef.current == null ? Infinity : Date.now() - touchStartAtRef.current;

    touchStartXRef.current = null;
    touchStartAtRef.current = null;

    const isTap = durationMs < TAP_THRESHOLD_MS && Math.abs(deltaX) < SWIPE_THRESHOLD_PX;
    if (isTap || Math.abs(deltaX) < SWIPE_THRESHOLD_PX) {
      return;
    }

    if (deltaX < 0) {
      goNext();
    } else {
      goPrev();
    }
  }, [goNext, goPrev]);

  return (
    <Dialog open={openIndex !== null} onOpenChange={(isOpen) => (!isOpen ? onClose() : null)}>
      <DialogContent className="z-[60] max-w-5xl rounded-xl border-slate-200 p-0 [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{ariaTitle}</DialogTitle>
          <DialogDescription>{ariaDescription}</DialogDescription>
        </DialogHeader>
        <div
          className="relative overflow-hidden rounded-xl bg-white px-4 py-12 sm:px-6"
          style={{ touchAction: 'pan-x' }}
          onTouchStart={handleViewerTouchStart}
          onTouchEnd={handleViewerTouchEnd}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Закрыть просмотр фото"
            style={{ touchAction: 'manipulation' }}
            className="absolute right-3 top-3 z-10 h-11 w-11 rounded-full text-slate-500 hover:text-slate-700"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>

          {images.length > 1 && openIndex !== null && (
            <>
              <div className="absolute right-16 top-5 z-10 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-slate-700 shadow-sm">
                {openIndex + 1}/{images.length}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={goPrev}
                disabled={!canGoPrev}
                aria-label="Предыдущее фото"
                style={{ touchAction: 'manipulation' }}
                className="absolute left-3 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full text-slate-600 hover:text-slate-900"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={goNext}
                disabled={!canGoNext}
                aria-label="Следующее фото"
                style={{ touchAction: 'manipulation' }}
                className="absolute right-3 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full text-slate-600 hover:text-slate-900"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </Button>
            </>
          )}

          {openIndex !== null && images[openIndex] && (
            <img
              src={images[openIndex]}
              alt={`${ariaTitle} ${openIndex + 1}`}
              loading="lazy"
              className="mx-auto max-h-[75dvh] w-full object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});

FullscreenImageCarousel.displayName = 'FullscreenImageCarousel';
