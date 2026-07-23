import { memo, useCallback, useMemo } from 'react';
import { Check, ChevronDown, Download, FolderDown, FolderInput, Image, Pencil, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from '@/components/kb/ui/ContextMenu';
import { CopyTaskButton } from '@/components/kb/ui/CopyTaskButton';
import { MathText } from '@/components/kb/ui/MathText';
import { SourceBadge } from '@/components/kb/ui/SourceBadge';
import { useKBImagesSignedUrls } from '@/hooks/useKBImagesSignedUrls';
import { parseAttachmentUrls } from '@/lib/kbApi';
import { cn } from '@/lib/utils';
import type { KBTask } from '@/types/kb';

interface TaskCardProps {
  task: KBTask;
  isExpanded: boolean;
  isOwn: boolean;
  inHW?: boolean;
  isModerator?: boolean;
  subtopicName?: string;
  /**
   * If provided, the «КИМ № N» badge becomes a clickable button — clicking
   * it requests the parent page to filter the task list by that KIM number.
   * Click stops propagation so it doesn't toggle the card.
   */
  onKimClick?: (kimNumber: number) => void;
  onToggle: () => void;
  onAddToHW?: () => void;
  onCopyToFolder?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onAiSimilar?: () => void;
  onMoveToFolder?: () => void;
  onMoveToMyBase?: () => void;
  onReassign?: () => void;
  /** Hard-delete из каталога (модератор, запрос Милады 2026-07-22). */
  onDeleteFromCatalog?: () => void;
  className?: string;
}

const IMAGE_ONLY_MARKERS = ['[Задача на фото]', '[задача на фото]'];

export const TaskCard = memo(function TaskCard({
  task,
  isExpanded,
  isOwn,
  inHW = false,
  isModerator = false,
  subtopicName,
  onKimClick,
  onToggle,
  onAddToHW,
  onCopyToFolder,
  onEdit,
  onDelete,
  onAiSimilar,
  onMoveToFolder,
  onMoveToMyBase,
  onReassign,
  onDeleteFromCatalog,
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
  if ((isOwn || isModerator) && onMoveToFolder) {
    menuItems.push({ key: 'move', label: 'Переместить', icon: FolderInput, onSelect: onMoveToFolder });
  }
  if (isOwn && onDelete) {
    menuItems.push({ key: 'delete', label: 'Удалить', icon: Trash2, destructive: true, onSelect: onDelete });
  }
  // Moderator actions on catalog tasks (ВОЛНА 6: «Снять публикацию» → «Перенести в
  // Мою базу» — исходник уезжает в личную папку, каталожная копия удаляется).
  if (isModeratable && onMoveToMyBase) {
    menuItems.push({ key: 'move_to_base', label: 'Перенести в Мою базу', icon: FolderDown, onSelect: onMoveToMyBase });
  }
  if (isModeratable && onReassign) {
    menuItems.push({ key: 'reassign', label: 'Перепривязать источник', icon: RefreshCw, onSelect: onReassign });
  }
  // Hard-delete из каталога (запрос Милады 2026-07-22): «не скрыть, а вообще
  // удалить». Свой исходник удаляется вместе с копией; ветка/гарды — на сервере.
  if (isModeratable && onDeleteFromCatalog) {
    // «Удалить безвозвратно…» (ревью 5.6 U1): own-source ветка удаляет и личный
    // исходник — «из каталога» звучало бы уже, чем действие. Многоточие =
    // откроется confirm-диалог с деталями по ветке.
    menuItems.push({
      key: 'delete_catalog',
      label: 'Удалить безвозвратно…',
      icon: Trash2,
      destructive: true,
      onSelect: onDeleteFromCatalog,
    });
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

  // Источник задачи («ФИПИ», «Демидова 2025», …) — запрос Егора #3.
  // 'my'/'socrat' — служебные sentinel владения (rule 50), не показываем.
  const sourceLabel =
    task.source_label && task.source_label !== 'my' && task.source_label !== 'socrat'
      ? task.source_label
      : null;

  // Collapsed preview: only the FIRST image (hero) — запрос Егора #2:
  // в списке показываем одну картинку, остальные видны при раскрытии.
  // Signed URLs — через кэшированный batch-хук (55 мин staleTime, дедуп
  // между карточками и повторными заходами) вместо прямых createSignedUrl.
  const heroRef = attachmentRefs[0] ?? null;
  const heroRefs = useMemo(() => (heroRef ? [heroRef] : []), [heroRef]);
  const { urls: heroUrlMap, isLoading: collapsedLoading } = useKBImagesSignedUrls(heroRefs);
  const heroUrl = heroRef ? heroUrlMap[heroRef] ?? null : null;

  // Full image set: load remaining images when expanded (hero query reused from cache)
  const { urls: allUrlMap, isLoading: imageLoading } = useKBImagesSignedUrls(attachmentRefs, {
    enabled: isExpanded && attachmentRefs.length > 1,
  });
  const imageUrls = useMemo(
    () => attachmentRefs.map((ref) => allUrlMap[ref]).filter((u): u is string => Boolean(u)),
    [attachmentRefs, allUrlMap],
  );

  // Resolve solution images
  const solutionRefs = useMemo(
    () => parseAttachmentUrls(task.solution_attachment_url),
    [task.solution_attachment_url],
  );
  const { urls: solutionUrlMap, isLoading: solutionImageLoading } = useKBImagesSignedUrls(
    solutionRefs,
    { enabled: isExpanded && solutionRefs.length > 0 },
  );
  const solutionImageUrls = useMemo(
    () => solutionRefs.map((ref) => solutionUrlMap[ref]).filter((u): u is string => Boolean(u)),
    [solutionRefs, solutionUrlMap],
  );

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
          {sourceLabel ? (
            <span
              className="max-w-[180px] truncate text-[11px] text-slate-400"
              title={`Источник: ${sourceLabel}`}
            >
              {sourceLabel}
            </span>
          ) : null}
          {subtopicName ? (
            <span className="text-[11px] font-medium text-slate-500">{subtopicName}</span>
          ) : null}
          {task.kim_number ? (
            onKimClick ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onKimClick(task.kim_number!);
                }}
                className="-mx-1 rounded px-1 py-0.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-socrat-surface hover:text-socrat-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-primary/40"
                title={`Показать только КИМ № ${task.kim_number}`}
              >
                КИМ № {task.kim_number}
              </button>
            ) : (
              <span className="text-[11px] font-medium text-slate-500">КИМ № {task.kim_number}</span>
            )
          ) : null}
          {task.difficulty != null ? (
            <span className="inline-flex items-center rounded-md bg-socrat-folder-bg px-1.5 py-0.5 text-[10px] font-semibold text-socrat-folder">
              Сложность {task.difficulty}
            </span>
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

      {/* Zone 2: Content — text selectable, click toggles only if no selection.
          Hero-image layout (Vladimir's call: «как в красивых задачниках»):
          картинка ВСЕГДА сверху и full-width, текст — под картинкой. Текст
          в collapsed-режиме clamp'ится 4 строками (раньше было 2 — слишком
          мало для понимания сути). Image-only задачи скрывают текстовый
          блок (поле text пустое). */}
      <div
        onClick={handleContentClick}
        className="cursor-pointer select-text px-4 pb-2 pt-2 md:px-5"
      >
        {/* Hero image — at the top of content zone. Строго ОДНА картинка
            в свёрнутом виде (запрос Егора #2); остальные — чипом «+N фото»,
            раскрываются вместе с карточкой. Single image: hero shown in BOTH
            states; multi-image expanded → только полная галерея ниже
            (без дубля hero). */}
        {attachmentRefs.length > 0 && (attachmentRefs.length === 1 || !isExpanded) ? (
          <div className={cn(!isExpanded && 'mb-3')}>
            {collapsedLoading ? (
              <div className="h-48 w-full animate-pulse rounded-xl bg-socrat-surface md:h-64" />
            ) : heroUrl ? (
              <div className="flex flex-col gap-2">
                <a
                  href={heroUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="block"
                >
                  <img
                    src={heroUrl}
                    alt="Фото условия"
                    loading="lazy"
                    decoding="async"
                    className="max-h-48 w-full rounded-xl border border-socrat-border object-contain transition-opacity hover:opacity-90 md:max-h-64"
                  />
                </a>
                {!isExpanded && attachmentRefs.length > 1 ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded-md bg-socrat-surface px-2 py-1 text-[11px] font-medium text-slate-500">
                    <Image className="h-3.5 w-3.5 text-slate-400" />
                    Ещё {attachmentRefs.length - 1} фото — раскрыть
                  </span>
                ) : null}
              </div>
            ) : (
              // Refs exist but signed URL failed — storage object likely missing.
              // Without this fallback image-only задачи рендерились как пустая карточка
              // между шапкой и кнопками — тутор не понимал почему. Diagnostic в console:
              // см. getKBImageSignedUrl в src/lib/kbApi.ts.
              <div className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 text-center text-xs text-amber-700">
                <Image className="h-5 w-5 text-amber-500" />
                <span className="font-medium">
                  {attachmentRefs.length === 1
                    ? 'Фото недоступно'
                    : `Фото недоступны (${attachmentRefs.length} шт.)`}
                </span>
                <span className="text-[11px] text-amber-600">
                  Файл удалён из хранилища — попроси автора перезалить
                </span>
              </div>
            )}
          </div>
        ) : null}

        {/* Task text — render with MathText (Phase 1), hide for image-only tasks */}
        {!isImageOnly && task.text ? (
          <MathText
            text={task.text}
            className={cn(
              'text-[13px] leading-[1.58] text-slate-900 md:text-sm',
              !isExpanded && 'line-clamp-4',
            )}
          />
        ) : null}

        {/* Expanded: full image gallery — only for multi-image tasks (single
            image is already shown once as the clickable hero above). */}
        {isExpanded && attachmentRefs.length > 1 ? (
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
              <div className="flex h-20 flex-col items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-700">
                <Image className="h-4 w-4 text-amber-500" />
                <span>Фото недоступно — файл удалён из хранилища</span>
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
                  <div className="flex h-20 flex-col items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-700">
                    <Image className="h-4 w-4 text-amber-500" />
                    <span>Фото решения недоступно — файл удалён из хранилища</span>
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
});
