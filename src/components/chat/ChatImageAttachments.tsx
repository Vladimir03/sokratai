import { useEffect, useMemo, useState } from 'react';
import { ImageOff } from 'lucide-react';
import {
  PhotoThumbButton,
  PhotoViewer,
  type PhotoViewerItem,
  usePhotoViewer,
} from '@/components/common/photo-viewer';
import { usePhotoOrientations } from '@/hooks/usePhotoOrientation';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';
import { resolveChatAttachmentUrl } from '@/lib/tutorStudentChatApi';

/**
 * Фото сообщения: storage:// refs → signed URL (клиентский supabase → RU-safe
 * api.sokratai.ru), миниатюры + полноэкранный просмотр. Битый ref →
 * placeholder, никогда raw <img> с storage:// (rule 40 image-fallback).
 *
 * С 2026-07-31 просмотр — канонический `PhotoViewer` (план 1-ancient-quokka).
 * Свой лайтбокс показывал ровно одну картинку без стрелок, счётчика и зума:
 * из чата, куда ученик присылает фото тетради, его было не рассмотреть.
 */
export function ChatImageAttachments({
  attachmentUrl,
  canRotate = false,
}: {
  attachmentUrl: string | null;
  /** Кнопки поворота — только в репетиторском чате. */
  canRotate?: boolean;
}) {
  const refs = parseAttachmentUrls(attachmentUrl);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const { openIndex, open, close, navigate } = usePhotoViewer();

  useEffect(() => {
    let cancelled = false;
    for (const ref of refs) {
      if (ref.startsWith('blob:') || ref.startsWith('https://')) {
        // Оптимистичный локальный preview / уже подписанный URL.
        setUrls((prev) => (prev[ref] !== undefined ? prev : { ...prev, [ref]: ref }));
        continue;
      }
      if (urls[ref] !== undefined) continue;
      resolveChatAttachmentUrl(ref).then((signed) => {
        if (!cancelled) setUrls((prev) => ({ ...prev, [ref]: signed }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentUrl]);

  // Индексы просмотрщика считаем по РАЗРЕШЁННЫМ фото: нерезолвнутый ref
  // рисуется плейсхолдером и в просмотр не попадает, иначе клик по второму
  // фото открывал бы первое.
  const readyRefs = useMemo(
    () => refs.filter((ref) => Boolean(urls[ref])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attachmentUrl, urls],
  );

  const { orientations } = usePhotoOrientations(readyRefs);

  const items = useMemo<PhotoViewerItem[]>(
    () =>
      readyRefs.map((ref, index) => ({
        url: urls[ref] as string,
        ref: ref.startsWith('storage://') ? ref : null,
        caption: readyRefs.length > 1 ? `Фото из чата · ${index + 1}` : 'Фото из чата',
        alt: 'Фото из чата',
      })),
    [readyRefs, urls],
  );

  if (refs.length === 0) return null;

  return (
    <>
      <div className={refs.length > 1 ? 'grid grid-cols-2 gap-1' : ''}>
        {refs.map((ref) => {
          const url = urls[ref];
          if (url === null) {
            return (
              <div
                key={ref}
                className="flex h-24 w-40 items-center justify-center rounded-lg bg-slate-100 text-slate-400"
              >
                <ImageOff className="h-5 w-5" aria-label="Фото недоступно" />
              </div>
            );
          }
          if (!url) {
            return <div key={ref} className="h-24 w-40 animate-pulse rounded-lg bg-slate-100" />;
          }
          return (
            <PhotoThumbButton
              key={ref}
              src={url}
              alt="Фото из чата"
              index={readyRefs.indexOf(ref)}
              onOpen={open}
              degrees={orientations[ref] ?? 0}
              className="max-h-64 w-full max-w-[280px] object-cover"
              wrapperClassName="block overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          );
        })}
      </div>

      <PhotoViewer
        items={items}
        openIndex={openIndex}
        onClose={close}
        onNavigate={navigate}
        surface="tutor_student_chat"
        canRotate={canRotate}
        ariaTitle="Фото из чата"
        ariaDescription="Фото можно повернуть, увеличить и рассмотреть целиком"
      />
    </>
  );
}

export default ChatImageAttachments;
