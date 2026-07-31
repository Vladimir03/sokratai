import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, ImageIcon, Pencil } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PhotoThumbButton,
  PhotoViewer,
  type PhotoViewerItem,
  usePhotoViewer,
} from '@/components/common/photo-viewer';
import { usePhotoOrientations } from '@/hooks/usePhotoOrientation';
import {
  getThreadAttachmentKind,
  getThreadAttachmentLabel,
  parseThreadAttachmentRefs,
} from '@/lib/homeworkThreadAttachments';

/**
 * Вложения сообщения треда ДЗ: фото решения ученика, PDF, прочие файлы.
 *
 * ⚠️ Это главный экран проверки: именно здесь репетитор смотрит рукописное
 * решение. До 2026-07-31 фото открывалось СЫРОЙ ВКЛАДКОЙ БРАУЗЕРА — ни зума,
 * ни поворота, ни возврата назад. Отсюда джоб Ульяны U22 «его нельзя
 * развернуть, приходится копировать» и её ручной путь «вырезать → развернуть →
 * вынести на доску → отправить».
 *
 * Теперь клик открывает канонический `PhotoViewer`. Поворот сохраняется по
 * storage-ref, поэтому ученик и AI-проверка видят фото так же, как репетитор.
 */
interface ThreadAttachmentsProps {
  attachmentValue: string;
  resolveSignedUrl: (ref: string) => Promise<string | null>;
  compact?: boolean;
  /** Кнопки поворота — только на репетиторской стороне треда. */
  canRotate?: boolean;
  /**
   * «Показать ошибку»: репетитор размечает фото ученика прямо из просмотра.
   * Отправку делает вызывающий — своего write-path у разметки нет (rule 40).
   */
  onAnnotate?: (photo: { url: string; ref: string | null; degrees: number }) => void;
}

interface ResolvedAttachment {
  ref: string;
  kind: 'image' | 'pdf' | 'file';
  label: string;
  url: string | null;
}

export function ThreadAttachments({
  attachmentValue,
  resolveSignedUrl,
  compact = false,
  canRotate = false,
  onAnnotate,
}: ThreadAttachmentsProps) {
  const refs = useMemo(
    () => parseThreadAttachmentRefs(attachmentValue),
    [attachmentValue],
  );
  const [items, setItems] = useState<ResolvedAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const { openIndex, open, close, navigate } = usePhotoViewer();

  useEffect(() => {
    if (refs.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void Promise.all(
      refs.map(async (ref, index) => ({
        ref,
        kind: getThreadAttachmentKind(ref),
        label: getThreadAttachmentLabel(ref, index + 1),
        url: await resolveSignedUrl(ref),
      })),
    ).then((resolved) => {
      if (!cancelled) {
        setItems(resolved);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refs, resolveSignedUrl]);

  // Только картинки попадают в просмотрщик; PDF и прочие файлы остаются
  // ссылками. Индексы просмотрщика считаем по ЭТОМУ списку, а не по items —
  // иначе клик по второму фото открывал бы первое, если между ними лежит PDF.
  const photos = useMemo(
    () => items.filter((item) => item.kind === 'image' && item.url),
    [items],
  );

  const photoRefs = useMemo(() => photos.map((photo) => photo.ref), [photos]);
  const { orientations } = usePhotoOrientations(photoRefs);

  const viewerItems = useMemo<PhotoViewerItem[]>(
    () =>
      photos.map((photo) => ({
        url: photo.url as string,
        ref: photo.ref,
        caption: photo.label,
        alt: photo.label,
      })),
    [photos],
  );

  const indexOfPhoto = useCallback(
    (ref: string) => photos.findIndex((photo) => photo.ref === ref),
    [photos],
  );

  if (refs.length === 0) return null;

  if (loading) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {refs.map((ref) => (
          <Skeleton
            key={ref}
            className={compact ? 'h-20 w-20 rounded-md' : 'h-24 w-24 rounded-md'}
          />
        ))}
      </div>
    );
  }

  const imageClassName = compact
    ? 'h-20 w-auto max-w-[140px] rounded-sm object-cover'
    : 'h-24 w-auto max-w-[200px] rounded-sm object-cover';

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => {
          if (item.kind === 'image' && item.url) {
            const photoIndex = indexOfPhoto(item.ref);
            return (
              <PhotoThumbButton
                key={item.ref}
                src={item.url}
                alt={item.label}
                index={photoIndex < 0 ? 0 : photoIndex}
                onOpen={open}
                className={imageClassName}
                degrees={orientations[item.ref] ?? 0}
                wrapperClassName="inline-block rounded-md border bg-background p-0.5 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
              />
            );
          }

          if (item.url) {
            return (
              <a
                key={item.ref}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex min-h-20 items-center gap-3 rounded-md border bg-background px-3 py-2 hover:bg-muted/40 ${
                  compact ? 'max-w-[220px]' : 'max-w-[260px]'
                }`}
              >
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.kind === 'pdf' ? 'PDF' : 'Файл'}
                  </p>
                </div>
              </a>
            );
          }

          return (
            <div
              key={item.ref}
              className={`inline-flex min-h-20 items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 ${
                compact ? 'max-w-[220px]' : 'max-w-[260px]'
              }`}
            >
              <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{item.label}</p>
                <p className="text-[11px] text-muted-foreground">Вложение недоступно</p>
              </div>
            </div>
          );
        })}
      </div>

      <PhotoViewer
        items={viewerItems}
        openIndex={openIndex}
        onClose={close}
        onNavigate={navigate}
        surface="homework_thread"
        canRotate={canRotate}
        ariaTitle="Фото из переписки по задаче"
        ariaDescription="Фото можно повернуть, увеличить и рассмотреть целиком"
        // ⚠️ В подвале ОДНА первичная кнопка. Вторая CTA «Разобрать на доске»
        // конкурировала с ней за внимание и не переносилась на узком экране;
        // путь на доску сохранён, но переехал в сам лист разметки («Нужно
        // больше места») — туда, где потребность и возникает.
        footerActions={
          onAnnotate && openIndex !== null && viewerItems[openIndex] ? (
            <button
              type="button"
              onClick={() => {
                const item = viewerItems[openIndex];
                close();
                onAnnotate({
                  url: item.url,
                  ref: item.ref ?? null,
                  degrees: orientations[item.ref ?? ''] ?? 0,
                });
              }}
              style={{ touchAction: 'manipulation' }}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Показать ошибку
            </button>
          ) : null
        }
      />
    </>
  );
}
