import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useStudentTaskImagesSignedUrls } from '@/hooks/useStudentHomework';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';

interface TaskImagesGalleryProps {
  /** Assignment UUID — for batched signed-URL endpoint cache key. */
  assignmentId: string;
  /** Task UUID — for batched signed-URL endpoint cache key. */
  taskId: string;
  /**
   * Dual-format `task_image_url`:
   *   - `null` → render nothing
   *   - single `storage://...` ref → 1 thumbnail
   *   - JSON-array `["storage://...", ...]` → up to N thumbnails
   * Resolved through `parseAttachmentUrls` (canonical helper).
   */
  taskImageUrl: string | null;
}

/**
 * Task condition photo gallery for the Phase 1 student problem screen
 * `ProblemContext` expanded view. Mirrors the legacy
 * `TaskConditionGallery` from `GuidedHomeworkWorkspace` (UX parity) but as
 * a standalone exported component — the legacy one is inline-only.
 *
 * **Multi-photo support** (Q10 from preview QA #1, 2026-05-10): up to 5
 * photos per task per `MAX_TASK_IMAGES` invariant in
 * `.claude/rules/40-homework-system.md` § «Multi-photo на задачу и
 * рубрику». Renders all refs as a horizontal scroll-strip of thumbnails;
 * tap a thumbnail → fullscreen Dialog with arrow nav + swipe + counter.
 *
 * Signed URLs are resolved through the existing batched endpoint
 * (`useStudentTaskImagesSignedUrls` → `getStudentTaskImagesSignedUrlsViaBackend`),
 * which already handles dual-format refs server-side. We do NOT call
 * `getStudentTaskImageSignedUrl` per-ref because that would N+1 the
 * Storage signing for multi-photo tasks.
 *
 * Q9 (preview QA #1): the previous `ProblemContext` body rendering
 * skipped images entirely — students saw text-only conditions even when
 * the task had photos. This component fixes that gap.
 */
export function TaskImagesGallery({
  assignmentId,
  taskId,
  taskImageUrl,
}: TaskImagesGalleryProps) {
  const refs = useMemo(() => parseAttachmentUrls(taskImageUrl), [taskImageUrl]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const { data: signedUrls = [], isLoading } = useStudentTaskImagesSignedUrls(
    assignmentId,
    taskId,
    { enabled: refs.length > 0 },
  );

  // Fallback: if signed URLs haven't resolved yet but some refs are
  // already absolute https/data URLs (e.g. cached / preview), use those.
  const resolvedUrls = useMemo(() => {
    if (signedUrls.length > 0) return signedUrls;
    return refs.filter((ref) => /^(https?:\/\/|data:)/i.test(ref));
  }, [refs, signedUrls]);

  // Keyboard nav inside the fullscreen viewer.
  useEffect(() => {
    if (openIndex === null) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setOpenIndex((current) =>
          current !== null && current > 0 ? current - 1 : current,
        );
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setOpenIndex((current) => {
          if (current === null) return current;
          return current < resolvedUrls.length - 1 ? current + 1 : current;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openIndex, resolvedUrls.length]);

  if (refs.length === 0) return null;

  if (isLoading && resolvedUrls.length === 0) {
    return (
      <p className="text-xs text-socrat-muted">Загрузка фото условия...</p>
    );
  }

  if (resolvedUrls.length === 0) {
    return (
      <p className="text-xs text-socrat-muted">Фото условия недоступны</p>
    );
  }

  const canGoPrev = openIndex !== null && openIndex > 0;
  const canGoNext = openIndex !== null && openIndex < resolvedUrls.length - 1;

  return (
    <>
      <div
        className="flex gap-2 overflow-x-auto touch-pan-x pb-1 -mx-1 px-1 [&::-webkit-scrollbar]:hidden"
        role="list"
        aria-label="Фото условия задачи"
      >
        {resolvedUrls.map((url, index) => (
          <button
            key={`${taskId}-thumb-${index}`}
            type="button"
            role="listitem"
            onClick={() => setOpenIndex(index)}
            aria-label={`Открыть фото ${index + 1} из ${resolvedUrls.length}`}
            className="relative shrink-0 w-24 h-24 rounded-lg overflow-hidden border border-socrat-border-light bg-socrat-surface hover:border-socrat-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-primary/30 touch-manipulation transition-colors group"
          >
            <img
              src={url}
              alt={`Фото условия ${index + 1}`}
              loading="lazy"
              className="w-full h-full object-cover"
            />
            <span
              aria-hidden="true"
              className="absolute inset-0 grid place-items-center bg-slate-900/0 group-hover:bg-slate-900/10 transition-colors"
            >
              <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 drop-shadow transition-opacity" />
            </span>
          </button>
        ))}
      </div>

      <DialogPrimitive.Root
        open={openIndex !== null}
        onOpenChange={(isOpen) => setOpenIndex(isOpen ? openIndex : null)}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out duration-150" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 inset-y-0 z-50 grid place-items-center p-3 sm:p-6 outline-none focus-visible:outline-none"
          >
            <DialogPrimitive.Title className="sr-only">
              Фото условия задачи
            </DialogPrimitive.Title>
            <div className="relative w-full max-w-5xl rounded-xl bg-white px-4 py-12 sm:px-6 max-h-[90dvh] overflow-hidden">
              <DialogPrimitive.Close
                type="button"
                aria-label="Закрыть просмотр фото"
                className="absolute right-3 top-3 z-10 grid place-items-center h-11 w-11 rounded-full text-slate-500 hover:text-slate-700 hover:bg-socrat-surface touch-manipulation"
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>

              {resolvedUrls.length > 1 && openIndex !== null ? (
                <>
                  <div className="absolute right-16 top-5 z-10 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-slate-700 shadow-sm">
                    {openIndex + 1}/{resolvedUrls.length}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenIndex((current) =>
                        current !== null && current > 0 ? current - 1 : current,
                      )
                    }
                    disabled={!canGoPrev}
                    aria-label="Предыдущее фото"
                    className="absolute left-3 top-1/2 z-10 grid place-items-center h-11 w-11 -translate-y-1/2 rounded-full text-slate-600 hover:text-slate-900 hover:bg-socrat-surface disabled:opacity-30 disabled:cursor-not-allowed touch-manipulation"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenIndex((current) => {
                        if (current === null) return current;
                        return current < resolvedUrls.length - 1
                          ? current + 1
                          : current;
                      })
                    }
                    disabled={!canGoNext}
                    aria-label="Следующее фото"
                    className="absolute right-3 top-1/2 z-10 grid place-items-center h-11 w-11 -translate-y-1/2 rounded-full text-slate-600 hover:text-slate-900 hover:bg-socrat-surface disabled:opacity-30 disabled:cursor-not-allowed touch-manipulation"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : null}

              {openIndex !== null && resolvedUrls[openIndex] ? (
                <img
                  src={resolvedUrls[openIndex]}
                  alt={`Фото условия ${openIndex + 1}`}
                  className="block mx-auto max-h-[80dvh] max-w-full w-auto h-auto object-contain"
                />
              ) : null}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
