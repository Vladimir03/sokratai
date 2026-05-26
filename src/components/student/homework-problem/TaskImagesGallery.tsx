import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, RefreshCw, X, ZoomIn } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
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
 * Task condition photo gallery for the student problem screen
 * `ProblemContext` expanded view. Mirrors the legacy
 * `TaskConditionGallery` from `GuidedHomeworkWorkspace` (UX parity) but as
 * a standalone exported component.
 *
 * **Multi-photo support** (Q10 from preview QA #1, 2026-05-10): up to 5
 * photos per task per `MAX_TASK_IMAGES` invariant in
 * `.claude/rules/40-homework-system.md` § «Multi-photo на задачу и
 * рубрику».
 *
 * **Responsive layout** (Phase 3.1 follow-up 2026-05-13):
 *   - Mobile (≤768): horizontal scroll-strip thumbnails 96×96 with
 *     `object-cover` (cropped). Limited vertical space на mobile +
 *     ProblemContext peek/expanded UX делает миниатюру + click → fullscreen
 *     разумным balance.
 *   - Tablet/desktop (`md:`): vertical stack, full-width photos with
 *     `object-contain` capped at `max-h-[60vh]`. Sidebar = 420-460px, дать
 *     фото это пространство значит ученик читает условие in place вместо
 *     dependence на fullscreen click. Portrait textbook screenshots не
 *     доминируют sidebar — warn banner остаётся видимым ниже.
 *   - Both: click any photo → fullscreen Dialog с arrow nav + counter для
 *     true zoom (мелкие формулы / детали схем).
 *
 * **Image-load resilience** (Phase 3.1 Bug #3 image-tail 2026-05-13): each
 * `<img loading="lazy">` имеет `onError` handler. На failure thumbnail/photo replaced с
 * dashed-rose retry button → tap → React Query cache invalidate → fresh
 * signed URLs. Logs failed URL + taskId to `console.warn` для diagnosis.
 *
 * Signed URLs resolved through batched endpoint
 * (`useStudentTaskImagesSignedUrls` → `getStudentTaskImagesSignedUrlsViaBackend`,
 * which mirrors Phase 3.1 401 refresh+retry pattern).
 */
export function TaskImagesGallery({
  assignmentId,
  taskId,
  taskImageUrl,
}: TaskImagesGalleryProps) {
  const queryClient = useQueryClient();
  const refs = useMemo(() => parseAttachmentUrls(taskImageUrl), [taskImageUrl]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Tracks which thumbnails the browser failed to fetch (404 / 403 / CORS /
  // expired signed URL). Phase 3.1 Bug #3 image-tail hotfix 2026-05-13:
  // Полина Николаевна's Mac Chrome showed broken icons with no recovery
  // path. Now failed thumbnails render as an explicit retry button instead
  // of relying on the browser's broken-image glyph.
  const [erroredUrls, setErroredUrls] = useState<Set<string>>(new Set());

  const { data: signedUrls = [], isLoading, isFetching } = useStudentTaskImagesSignedUrls(
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

  const handleImageError = useCallback(
    (url: string) => {
      // Single retry: log + remember the failed URL. UI swaps the thumbnail
      // for a retry button. User taps → React Query refetches → fresh
      // signed URLs (with new tokens) → re-render. Storage signed URL
      // tokens have a 1h TTL; the React Query cache holds them for 50min
      // so an idle tab right at the boundary could surface expired URLs.
      console.warn('[TaskImagesGallery] image failed to load', { url, taskId });
      setErroredUrls((prev) => {
        if (prev.has(url)) return prev;
        const next = new Set(prev);
        next.add(url);
        return next;
      });
    },
    [taskId],
  );

  const handleRetry = useCallback(() => {
    setErroredUrls(new Set());
    void queryClient.invalidateQueries({
      queryKey: ['student', 'homework', 'guided-task-images', assignmentId, taskId],
    });
  }, [queryClient, assignmentId, taskId]);

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
      {/* Responsive layout (Phase 3.1 follow-up 2026-05-13):
          - Mobile (≤768): horizontal thumb strip 96×96 (object-cover, cropped).
            Limited vertical space + peek/expanded UX — миниатюра + click для
            fullscreen reasonable.
          - Tablet/desktop (md+): vertical stack, full-width images
            (`object-contain`, natural aspect) capped at `max-h-[60vh]` so
            portrait textbook screenshots не доминируют sidebar и warn banner
            остаётся видимым. Click → fullscreen для true zoom.
          Mobile-first base classes + `md:` overrides — single render tree. */}
      <div
        className="flex gap-2 overflow-x-auto touch-pan-x pb-1 -mx-1 px-1 [&::-webkit-scrollbar]:hidden md:flex-col md:gap-3 md:overflow-x-visible md:px-0 md:mx-0 md:pb-0 md:touch-auto"
        role="list"
        aria-label="Фото условия задачи"
      >
        {resolvedUrls.map((url, index) => {
          const isErrored = erroredUrls.has(url);
          if (isErrored) {
            return (
              <button
                key={`${taskId}-thumb-${index}-error`}
                type="button"
                role="listitem"
                onClick={handleRetry}
                disabled={isFetching}
                aria-label={`Не удалось загрузить фото ${index + 1}. Нажми чтобы попробовать снова.`}
                className="relative shrink-0 w-24 h-24 md:w-full md:h-auto md:aspect-[4/3] md:shrink rounded-lg border border-dashed border-rose-300 bg-rose-50 text-rose-700 grid place-items-center gap-1 px-2 hover:border-rose-400 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40 touch-manipulation transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                {isFetching ? (
                  <RefreshCw className="h-5 w-5 md:h-7 md:w-7 animate-spin" aria-hidden="true" />
                ) : (
                  <ImageOff className="h-5 w-5 md:h-7 md:w-7" aria-hidden="true" />
                )}
                <span className="text-[10px] md:text-xs font-semibold leading-tight text-center">
                  {isFetching ? 'Загружаем…' : 'Не загрузилось'}
                </span>
              </button>
            );
          }
          return (
            <button
              key={`${taskId}-thumb-${index}`}
              type="button"
              role="listitem"
              onClick={() => setOpenIndex(index)}
              aria-label={`Открыть фото ${index + 1} из ${resolvedUrls.length}`}
              className="relative shrink-0 w-24 h-24 md:w-full md:h-auto md:shrink rounded-lg overflow-hidden border border-socrat-border-light bg-socrat-surface md:bg-white hover:border-socrat-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-primary/30 touch-manipulation transition-colors group"
            >
              <img
                src={url}
                alt={`Фото условия ${index + 1}`}
                loading="lazy"
                onError={() => handleImageError(url)}
                className="w-full h-full object-cover md:object-contain md:h-auto md:w-full md:max-h-[60vh]"
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 grid place-items-center bg-slate-900/0 group-hover:bg-slate-900/10 transition-colors"
              >
                <ZoomIn className="h-5 w-5 md:h-7 md:w-7 text-white opacity-0 group-hover:opacity-100 drop-shadow transition-opacity" />
              </span>
            </button>
          );
        })}
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
                erroredUrls.has(resolvedUrls[openIndex]) ? (
                  <div className="grid place-items-center min-h-[40dvh] gap-3 text-rose-700 text-center px-4">
                    <ImageOff className="h-12 w-12" aria-hidden="true" />
                    <p className="text-sm font-semibold m-0">
                      Не удалось загрузить фото
                    </p>
                    <p className="text-xs text-slate-600 m-0 max-w-sm">
                      Возможно, истёк временный токен ссылки. Нажми «Обновить»,
                      чтобы запросить свежий URL.
                    </p>
                    <button
                      type="button"
                      onClick={handleRetry}
                      disabled={isFetching}
                      className="inline-flex items-center gap-1.5 h-11 px-4 rounded-[12px] bg-socrat-primary hover:bg-socrat-primary-dark text-white text-sm font-bold touch-manipulation transition-colors disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      Обновить
                    </button>
                  </div>
                ) : (
                  <img loading="lazy"
                    src={resolvedUrls[openIndex]}
                    alt={`Фото условия ${openIndex + 1}`}
                    onError={() => handleImageError(resolvedUrls[openIndex])}
                    className="block mx-auto max-h-[80dvh] max-w-full w-auto h-auto object-contain"
                  />
                )
              ) : null}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
