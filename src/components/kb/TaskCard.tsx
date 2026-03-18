import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Download, EyeOff, Image, Pencil, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from '@/components/kb/ui/ContextMenu';
import { CopyTaskButton } from '@/components/kb/ui/CopyTaskButton';
import { MathText } from '@/components/kb/ui/MathText';
import { SourceBadge } from '@/components/kb/ui/SourceBadge';
import { getKBImageSignedUrl, parseAttachmentUrls } from '@/lib/kbApi';
import { cn } from '@/lib/utils';
import type { KBTask } from '@/types/kb';

interface TaskCardProps {
  task: KBTask;
  isExpanded: boolean;
  isOwn: boolean;
  inHW?: boolean;
  isModerator?: boolean;
  subtopicName?: string;
  onToggle: () => void;
  onAddToHW?: () => void;
  onCopyToFolder?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onAiSimilar?: () => void;
  onUnpublish?: () => void;
  onReassign?: () => void;
  className?: string;
}

const IMAGE_ONLY_MARKERS = ['[Задача на фото]', '[задача на фото]'];

export function TaskCard({
  task,
  isExpanded,
  isOwn,
  inHW = false,
  isModerator = false,
  subtopicName,
  onToggle,
  onAddToHW,
  onCopyToFolder,
  onEdit,
  onDelete,
  onAiSimilar,
  onUnpublish,
  onReassign,
  className,
}: TaskCardProps) {
  const isHiddenDuplicate = task.moderation_status === 'hidden_duplicate';
  const isUnpublished = task.moderation_status === 'unpublished';
  const isModeratable = isModerator && !isOwn && task.owner_id === null;

  const menuItems: ContextMenuItem[] = [];

  if (isOwn && onEdit) {
    menuItems.push({ key: 'edit', label: 'Редактировать', icon: Pencil, onSelect: onEdit });
  }
  if (isOwn && onAiSimilar) {
    menuItems.push({ key: 'ai_similar', label: 'Похожая AI', icon: Sparkles, onSelect: onAiSimilar });
  }
  if (isOwn && onDelete) {
    menuItems.push({ key: 'delete', label: 'Удалить', icon: Trash2, destructive: true, onSelect: onDelete });
  }
  // Moderator actions on catalog tasks
  if (isModeratable && onUnpublish) {
    menuItems.push({ key: 'unpublish', label: 'Снять публикацию', icon: EyeOff, destructive: true, onSelect: onUnpublish });
  }
  if (isModeratable && onReassign) {
    menuItems.push({ key: 'reassign', label: 'Перепривязать источник', icon: RefreshCw, onSelect: onReassign });
  }

  // Resolve attachment_url(s) to signed HTTP URLs
  const attachmentRefs = useMemo(
    () => parseAttachmentUrls(task.attachment_url),
    [task.attachment_url],
  );

  // Detect image-only tasks (Phase 2)
  // Only hide text when it's truly empty or an explicit marker — never for short text + photo
  const isImageOnly = !task.text?.trim()
    || IMAGE_ONLY_MARKERS.includes(task.text.trim());

  // Collapsed preview: load up to 3 images for horizontal strip
  const collapsedImageCount = Math.min(attachmentRefs.length, 3);
  const [collapsedUrls, setCollapsedUrls] = useState<string[]>([]);
  const [collapsedLoading, setCollapsedLoading] = useState(false);

  useEffect(() => {
    if (attachmentRefs.length === 0) {
      setCollapsedUrls([]);
      return;
    }

    let cancelled = false;
    setCollapsedLoading(true);

    const refsToLoad = attachmentRefs.slice(0, collapsedImageCount);
    void Promise.all(refsToLoad.map((ref) => getKBImageSignedUrl(ref))).then((urls) => {
      if (!cancelled) {
        setCollapsedUrls(urls.filter((u): u is string => u !== null));
        setCollapsedLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attachmentRefs, collapsedImageCount]);

  // Full image set: load remaining images when expanded
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageLoading, setImageLoading] = useState(false);

  useEffect(() => {
    if (!isExpanded || attachmentRefs.length === 0) {
      setImageUrls([]);
      return;
    }

    // Reuse collapsed URLs if all images already loaded
    if (attachmentRefs.length <= collapsedImageCount && collapsedUrls.length > 0) {
      setImageUrls(collapsedUrls);
      return;
    }

    let cancelled = false;
    setImageLoading(true);

    void Promise.all(attachmentRefs.map((ref) => getKBImageSignedUrl(ref))).then(
      (urls) => {
        if (!cancelled) {
          setImageUrls(urls.filter((u): u is string => u !== null));
          setImageLoading(false);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [isExpanded, attachmentRefs, collapsedImageCount, collapsedUrls]);

  // Resolve solution images
  const solutionRefs = useMemo(
    () => parseAttachmentUrls(task.solution_attachment_url),
    [task.solution_attachment_url],
  );
  const [solutionImageUrls, setSolutionImageUrls] = useState<string[]>([]);
  const [solutionImageLoading, setSolutionImageLoading] = useState(false);

  useEffect(() => {
    if (!isExpanded || solutionRefs.length === 0) {
      setSolutionImageUrls([]);
      return;
    }

    let cancelled = false;
    setSolutionImageLoading(true);

    void Promise.all(solutionRefs.map((ref) => getKBImageSignedUrl(ref))).then(
      (urls) => {
        if (!cancelled) {
          setSolutionImageUrls(urls.filter((u): u is string => u !== null));
          setSolutionImageLoading(false);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [isExpanded, solutionRefs]);

  // Phase 3: Click on content toggles only if no text selection
  const handleContentClick = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    onToggle();
  }, [onToggle]);

  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border bg-white transition-all duration-200',
        inHW
          ? 'border-socrat-primary/30 shadow-[0_18px_35px_-30px_rgba(27,107,74,0.55)]'
          : 'border-socrat-border shadow-[0_14px_32px_-30px_rgba(15,23,42,0.28)] hover:border-socrat-primary/25',
        className,
      )}
    >
      {/* Zone 1: Header — always toggles */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer items-center gap-2 px-4 pb-0 pt-4 md:px-5"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <SourceBadge source={isOwn ? 'my' : 'socrat'} />
          {subtopicName ? (
            <span className="text-[11px] font-medium text-slate-500">{subtopicName}</span>
          ) : null}
          {task.kim_number ? (
            <span className="text-[11px] font-medium text-slate-500">КИМ № {task.kim_number}</span>
          ) : null}
          {isHiddenDuplicate ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
              дубль скрыт
            </span>
          ) : null}
          {isUnpublished ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
              снято
            </span>
          ) : null}
          {attachmentRefs.length > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <Image className="h-3.5 w-3.5 text-slate-400" />
              {attachmentRefs.length > 1 && (
                <span className="text-[11px] text-slate-400">{attachmentRefs.length}</span>
              )}
            </span>
          ) : null}
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
            isExpanded && 'rotate-180',
          )}
        />
      </div>

      {/* Zone 2: Content — text selectable, click toggles only if no selection */}
      <div
        onClick={handleContentClick}
        className="cursor-pointer select-text px-4 pb-2 pt-2 md:px-5"
      >
        {/* Task text — render with MathText (Phase 1), hide for image-only tasks */}
        {!isImageOnly && task.text ? (
          <MathText
            text={task.text}
            className={cn(
              'text-[13px] leading-[1.58] text-slate-900 md:text-sm',
              !isExpanded && 'line-clamp-2',
            )}
          />
        ) : null}

        {/* Collapsed image preview (Phase 2: hero-image) */}
        {!isExpanded && attachmentRefs.length > 0 ? (
          <div className="mt-2">
            {collapsedLoading ? (
              <div className={cn(
                'animate-pulse rounded-xl bg-socrat-surface',
                isImageOnly ? 'h-48 md:h-64 w-full' : 'h-28 w-full max-w-[200px]',
              )} />
            ) : collapsedUrls.length > 0 ? (
              // Mode A: Image-only → hero image
              isImageOnly ? (
                <img
                  src={collapsedUrls[0]}
                  alt="Фото условия"
                  loading="lazy"
                  decoding="async"
                  className="max-h-48 w-full rounded-xl border border-socrat-border object-contain md:max-h-64"
                />
              ) : attachmentRefs.length === 1 ? (
                // Mode B: Text + 1 photo → larger thumbnail
                <img
                  src={collapsedUrls[0]}
                  alt="Фото условия"
                  loading="lazy"
                  decoding="async"
                  className="max-h-40 max-w-full rounded-xl border border-socrat-border object-contain"
                />
              ) : (
                // Mode C: Text + multiple photos → horizontal strip
                <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto">
                  {collapsedUrls.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt={`Фото ${i + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="h-28 flex-shrink-0 snap-start rounded-lg border border-socrat-border object-contain"
                    />
                  ))}
                  {attachmentRefs.length > collapsedImageCount ? (
                    <div className="flex h-28 w-20 flex-shrink-0 items-center justify-center rounded-lg bg-socrat-surface text-xs text-slate-400">
                      +{attachmentRefs.length - collapsedImageCount}
                    </div>
                  ) : null}
                </div>
              )
            ) : null}
          </div>
        ) : null}

        {/* Expanded: full image gallery */}
        {isExpanded && attachmentRefs.length > 0 ? (
          <div className="mt-3">
            {imageLoading ? (
              <div className="flex flex-wrap gap-2">
                {attachmentRefs.map((_, i) => (
                  <div
                    key={i}
                    className="h-32 w-32 animate-pulse rounded-xl bg-socrat-surface"
                  />
                ))}
              </div>
            ) : imageUrls.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {imageUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                    <img
                      src={url}
                      alt={`Фото ${i + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="max-h-48 rounded-xl border border-socrat-border object-contain transition-opacity hover:opacity-80"
                    />
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex h-20 items-center justify-center rounded-xl bg-socrat-surface text-xs text-slate-400">
                Не удалось загрузить фото
              </div>
            )}
          </div>
        ) : null}

        {isExpanded && task.answer ? (
          <div className="mt-3 rounded-xl bg-socrat-surface px-3.5 py-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
              Ответ
            </div>
            <div className="font-mono text-sm font-semibold text-socrat-primary">{task.answer}</div>
          </div>
        ) : null}

        {/* Solution text + images */}
        {isExpanded && (task.solution || solutionRefs.length > 0) ? (
          <div className="mt-3 rounded-xl bg-socrat-surface px-3.5 py-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
              Решение
            </div>
            {task.solution ? (
              <MathText
                text={task.solution}
                className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700"
              />
            ) : null}
            {solutionRefs.length > 0 ? (
              <div className={cn('mt-2', !task.solution && 'mt-0')}>
                {solutionImageLoading ? (
                  <div className="flex flex-wrap gap-2">
                    {solutionRefs.map((_, i) => (
                      <div
                        key={i}
                        className="h-32 w-32 animate-pulse rounded-xl bg-white/60"
                      />
                    ))}
                  </div>
                ) : solutionImageUrls.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {solutionImageUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                        <img
                          src={url}
                          alt={`Решение фото ${i + 1}`}
                          loading="lazy"
                          decoding="async"
                          className="max-h-48 rounded-xl border border-socrat-border object-contain transition-opacity hover:opacity-80"
                        />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-20 items-center justify-center rounded-xl bg-white/60 text-xs text-slate-400">
                    Не удалось загрузить фото решения
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Zone 3: Actions — stopPropagation */}
      <div className="flex items-center gap-2 px-4 pb-4 pt-1 md:px-5" onClick={(event) => event.stopPropagation()}>
        <CopyTaskButton task={task} />

        {!isOwn && onCopyToFolder ? (
          <button
            type="button"
            onClick={onCopyToFolder}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-200',
              'border-socrat-folder/20 bg-socrat-folder-bg text-socrat-folder hover:border-socrat-folder/40',
            )}
          >
            <Download className="h-3.5 w-3.5" />
            К себе
          </button>
        ) : null}

        {onAddToHW ? (
          <button
            type="button"
            onClick={onAddToHW}
            disabled={inHW}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200',
              inHW
                ? 'cursor-default border border-socrat-primary/20 bg-socrat-primary-light text-socrat-primary'
                : 'bg-socrat-primary text-white shadow-sm hover:bg-socrat-primary-dark',
            )}
          >
            {inHW ? <Check className="h-3.5 w-3.5" /> : null}
            В ДЗ
          </button>
        ) : null}

        {menuItems.length > 0 ? <ContextMenu items={menuItems} /> : null}
      </div>
    </article>
  );
}
