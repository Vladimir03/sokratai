import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, ImageIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getThreadAttachmentKind,
  getThreadAttachmentLabel,
  parseThreadAttachmentRefs,
} from '@/lib/homeworkThreadAttachments';

/**
 * Phase 7 (2026-05-16): graceful fallback для image load failures.
 * Chrome/Firefox/Edge на desktop НЕ имеют HEIC decoder в <img> tag —
 * только Safari macOS/iOS умеет. Без onError handler репетитор видит
 * broken image placeholder без объяснения. После Phase 7 client-side
 * compression (compressForUpload в studentHomeworkApi.ts) новые HEIC
 * upload'ы не появятся в Storage, но legacy HEIC файлы остаются.
 *
 * Fallback показывает icon + filename + кнопку «Скачать оригинал».
 */
function ImageWithFallback({
  src,
  alt,
  className,
  label,
}: {
  src: string;
  alt: string;
  className: string;
  label: string;
}) {
  const [failed, setFailed] = useState(false);

  const isHeicLike = /\.(heic|heif)(\?|$)/i.test(src);

  if (failed) {
    return (
      <a
        href={src}
        download={label}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-20 items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 hover:bg-amber-100 max-w-[260px]"
        title={isHeicLike ? 'iPhone-фото в HEIC-формате — не отображается в этом браузере. Скачайте оригинал.' : 'Браузер не смог открыть файл. Скачайте оригинал.'}
      >
        <Download className="h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{label}</p>
          <p className="text-[11px] opacity-80">
            {isHeicLike ? 'HEIC — скачать' : 'Не открывается — скачать'}
          </p>
        </div>
      </a>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

interface ResolvedAttachment {
  ref: string;
  kind: 'image' | 'pdf' | 'file';
  label: string;
  url: string | null;
}

interface ThreadAttachmentsProps {
  attachmentValue: string;
  resolveSignedUrl: (ref: string) => Promise<string | null>;
  compact?: boolean;
}

export function ThreadAttachments({
  attachmentValue,
  resolveSignedUrl,
  compact = false,
}: ThreadAttachmentsProps) {
  const refs = useMemo(
    () => parseThreadAttachmentRefs(attachmentValue),
    [attachmentValue],
  );
  const [items, setItems] = useState<ResolvedAttachment[]>([]);
  const [loading, setLoading] = useState(false);

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
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((item) => {
        if (item.kind === 'image' && item.url) {
          // Phase 7 (2026-05-16): использовать ImageWithFallback вместо
          // bare <img> — onError handler рендерит download placeholder
          // для HEIC файлов которые не decode'ятся в Chrome/Firefox/Edge.
          return (
            <a
              key={item.ref}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-block rounded-md border bg-background p-0.5 hover:opacity-90 transition-opacity"
            >
              <ImageWithFallback
                src={item.url}
                alt={item.label}
                label={item.label}
                className={imageClassName}
              />
            </a>
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
  );
}
