import { memo, useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, X, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const SWIPE_THRESHOLD_PX = 50;
const TAP_THRESHOLD_MS = 50;

/**
 * Phase 7 round 2 (2026-05-20, ChatGPT-5.5 review P1 #3 + #4): inline image
 * с HEIC-aware onError fallback.
 *
 * Two modes для избежания nested interactive elements:
 *
 *   interactive=true (default, для standalone use в Dialog fullscreen):
 *     - success → `<img>` (renders inside parent context)
 *     - failed → `<a href download>` с placeholder (без `target="_blank"` —
 *       HTML5 download attribute ignored для cross-origin когда есть target).
 *
 *   interactive=false (для use внутри `<button>` — GalleryThumbnail):
 *     - success → `<img>`
 *     - failed → `<span>` non-interactive placeholder (НЕ `<a>` — иначе
 *       nested `<a>` inside `<button>` = invalid markup, click ambiguous).
 *       User кликает enclosing button — open dialog с full-size attempt,
 *       fullscreen Dialog рендерит SafeImage interactive=true где `<a>`
 *       уже допустим (Dialog не button).
 *
 * См. plan ~/.claude/plans/1-functional-meteor.md Phase 7 section + review.
 */
function SafeImage({
  src,
  alt,
  className,
  fallbackClassName,
  interactive = true,
}: {
  src: string;
  alt: string;
  className: string;
  fallbackClassName?: string;
  /**
   * When false, fallback render uses inert `<span>` instead of `<a>`.
   * Required when SafeImage is mounted inside another interactive element
   * (e.g. `<button>` thumbnail wrapper) to avoid nested anchor markup.
   */
  interactive?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const isHeicLike = /\.(heic|heif)(\?|$)/i.test(src);

  if (failed) {
    const fallbackContent = (
      <>
        <Download className="h-4 w-4 shrink-0" />
        <span className="text-xs">
          {isHeicLike ? 'HEIC — скачать' : 'Не открывается'}
        </span>
      </>
    );
    const defaultClass =
      'inline-flex h-24 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900';
    const title = isHeicLike
      ? 'iPhone-фото в HEIC-формате — не отображается в этом браузере. Скачайте оригинал.'
      : 'Браузер не смог открыть файл. Скачайте оригинал.';

    if (!interactive) {
      // Inert placeholder для use внутри <button> — нельзя <a> nested.
      return (
        <span
          className={fallbackClassName || defaultClass}
          title={title}
          aria-label={title}
        >
          {fallbackContent}
        </span>
      );
    }

    return (
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
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

const GalleryThumbnail = memo(function GalleryThumbnail({
  src,
  alt,
  index,
  onOpen,
  className,
}: {
  src: string;
  alt: string;
  index: number;
  onOpen: (index: number) => void;
  className: string;
}) {
  const touchStartXRef = useRef<number | null>(null);
  const shouldIgnoreClickRef = useRef(false);

  const handleTouchStart = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
    shouldIgnoreClickRef.current = false;
  }, []);

  const handleTouchMove = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    if (touchStartXRef.current == null) return;
    const currentX = event.touches[0]?.clientX ?? touchStartXRef.current;
    if (Math.abs(currentX - touchStartXRef.current) > 12) {
      shouldIgnoreClickRef.current = true;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchStartXRef.current = null;
  }, []);

  const handleClick = useCallback(() => {
    if (shouldIgnoreClickRef.current) {
      shouldIgnoreClickRef.current = false;
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
      className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2"
    >
      <SafeImage
        src={src}
        alt={alt}
        className={className}
        interactive={false}
      />
    </button>
  );
});

GalleryThumbnail.displayName = 'GalleryThumbnail';

export const PhotoGallery = memo(function PhotoGallery({
  images,
  dialogTitle,
  dialogDescription,
  imageAltPrefix,
  singleThumbnailClassName = 'h-24 w-auto max-w-[220px] rounded-sm object-cover',
  multiThumbnailClassName = 'h-32 w-[120px] rounded-md border border-slate-200 bg-white object-contain',
}: {
  images: string[];
  dialogTitle: string;
  dialogDescription: string;
  imageAltPrefix: string;
  singleThumbnailClassName?: string;
  multiThumbnailClassName?: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartAtRef = useRef<number | null>(null);

  const canGoPrev = openIndex !== null && openIndex > 0;
  const canGoNext = openIndex !== null && openIndex < images.length - 1;

  const goPrev = useCallback(() => {
    setOpenIndex((current) => {
      if (current == null || current <= 0) return current;
      return current - 1;
    });
  }, []);

  const goNext = useCallback(() => {
    setOpenIndex((current) => {
      if (current == null || current >= images.length - 1) return current;
      return current + 1;
    });
  }, [images.length]);

  useEffect(() => {
    if (openIndex === null || images.length <= 1) return undefined;

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
  }, [goNext, goPrev, images.length, openIndex]);

  useEffect(() => {
    if (openIndex == null) return;
    if (images.length === 0) {
      setOpenIndex(null);
      return;
    }
    if (openIndex >= images.length) {
      setOpenIndex(images.length - 1);
    }
  }, [images.length, openIndex]);

  const handleViewerTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
    touchStartAtRef.current = Date.now();
  }, []);

  const handleViewerTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    if (touchStartXRef.current == null || images.length <= 1) return;
    const touchEndX = event.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const deltaX = touchEndX - touchStartXRef.current;
    const durationMs = touchStartAtRef.current == null ? Infinity : Date.now() - touchStartAtRef.current;

    touchStartXRef.current = null;
    touchStartAtRef.current = null;

    if (durationMs < TAP_THRESHOLD_MS || Math.abs(deltaX) < SWIPE_THRESHOLD_PX) {
      return;
    }

    if (deltaX < 0) {
      goNext();
    } else {
      goPrev();
    }
  }, [goNext, goPrev, images.length]);

  if (images.length === 0) return null;

  if (images.length === 1) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpenIndex(0)}
          className="group relative mt-2 inline-block rounded-md border bg-background p-1 hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          title={`Открыть ${dialogTitle.toLowerCase()}`}
          aria-label={`Открыть ${dialogTitle.toLowerCase()} во весь экран`}
        >
          <SafeImage
            src={images[0]}
            alt={`${imageAltPrefix} 1`}
            className={singleThumbnailClassName}
            interactive={false}
          />
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
          >
            <ZoomIn className="h-3 w-3" />
            Увеличить
          </span>
        </button>
        <Dialog open={openIndex !== null} onOpenChange={(isOpen) => setOpenIndex(isOpen ? 0 : null)}>
          <DialogContent className="max-w-4xl p-4">
            <DialogHeader>
              <DialogTitle>{dialogTitle}</DialogTitle>
              <DialogDescription>{dialogDescription}</DialogDescription>
            </DialogHeader>
            <SafeImage
              src={images[0]}
              alt={`${imageAltPrefix} 1`}
              className="max-h-[75vh] w-full rounded-md object-contain"
              fallbackClassName="inline-flex h-[60vh] items-center justify-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <div className="mt-2 flex gap-2 overflow-x-auto touch-pan-x pb-1">
        {images.map((url, index) => (
          <GalleryThumbnail
            key={`${url}-${index}`}
            src={url}
            alt={`${imageAltPrefix} ${index + 1}`}
            index={index}
            onOpen={setOpenIndex}
            className={multiThumbnailClassName}
          />
        ))}
      </div>
      <Dialog open={openIndex !== null} onOpenChange={(isOpen) => setOpenIndex(isOpen ? openIndex : null)}>
        <DialogContent className="max-w-5xl rounded-xl border-slate-200 p-0 [&>button]:hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>
          <div
            className="relative overflow-hidden rounded-xl bg-white px-4 py-12 sm:px-6"
            onTouchStart={handleViewerTouchStart}
            onTouchEnd={handleViewerTouchEnd}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOpenIndex(null)}
              aria-label="Закрыть просмотр фото"
              className="absolute right-3 top-3 z-10 h-11 w-11 rounded-full text-slate-500 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </Button>

            {openIndex !== null && (
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
                  className="absolute left-3 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full text-slate-600 hover:text-slate-900"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={goNext}
                  disabled={!canGoNext}
                  aria-label="Следующее фото"
                  className="absolute right-3 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full text-slate-600 hover:text-slate-900"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
                <SafeImage
                  src={images[openIndex]}
                  alt={`${imageAltPrefix} ${openIndex + 1}`}
                  className="mx-auto max-h-[75vh] w-full object-contain"
                  fallbackClassName="mx-auto inline-flex h-[60vh] items-center justify-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
                />
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});

PhotoGallery.displayName = 'PhotoGallery';
