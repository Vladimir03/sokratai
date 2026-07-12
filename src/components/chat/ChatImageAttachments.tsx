import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';
import { resolveChatAttachmentUrl } from '@/lib/tutorStudentChatApi';

/**
 * Фото сообщения: storage:// refs → signed URL (клиентский supabase → RU-safe
 * api.sokratai.ru), миниатюры + fullscreen-лайтбокс. Битый ref → placeholder,
 * никогда raw <img> с storage:// (rule 40 image-fallback).
 */
export function ChatImageAttachments({ attachmentUrl }: { attachmentUrl: string | null }) {
  const refs = parseAttachmentUrls(attachmentUrl);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

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
            return (
              <div key={ref} className="h-24 w-40 animate-pulse rounded-lg bg-slate-100" />
            );
          }
          return (
            <button
              key={ref}
              type="button"
              onClick={() => setZoomUrl(url)}
              className="block overflow-hidden rounded-lg focus-visible:ring-2 focus-visible:ring-accent"
              style={{ touchAction: 'manipulation' }}
              aria-label="Открыть фото"
            >
              <img
                src={url}
                alt="Фото из чата"
                loading="lazy"
                className="max-h-64 w-full max-w-[280px] object-cover"
              />
            </button>
          );
        })}
      </div>
      <Dialog open={zoomUrl !== null} onOpenChange={(open) => !open && setZoomUrl(null)}>
        <DialogContent className="max-w-4xl border-none bg-transparent p-0 shadow-none">
          {zoomUrl ? (
            <img
              src={zoomUrl}
              alt="Фото из чата"
              className="max-h-[85vh] w-full rounded-lg object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ChatImageAttachments;
