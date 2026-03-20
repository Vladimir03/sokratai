import { useEffect, useMemo, useState } from 'react';
import { FileText, ImageIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getThreadAttachmentKind,
  getThreadAttachmentLabel,
  parseThreadAttachmentRefs,
} from '@/lib/homeworkThreadAttachments';

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
          return (
            <a
              key={item.ref}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-block rounded-md border bg-background p-0.5 hover:opacity-90 transition-opacity"
            >
              <img
                src={item.url}
                alt={item.label}
                className={imageClassName}
                loading="lazy"
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
