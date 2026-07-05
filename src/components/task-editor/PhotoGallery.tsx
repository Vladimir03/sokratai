/**
 * unified-task-model F0 (2026-07-05): извлечено VERBATIM из
 * `homework-create/HWTaskCard.tsx` (нулевой по поведению рефактор) — общая
 * фото-галерея секций редактора задачи (условие / решение / критерии).
 *
 * Upload-пайплайн НЕ здесь: галерея получает готовые url-мапы + колбэки
 * (gallery-as-props) — каждая поверхность (конструктор ДЗ / КБ-модалки)
 * подключает свой аплоад. НЕ сливать пайплайны (v1-решение).
 */

import { memo, useCallback, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Image as ImageIcon, Loader2, Plus, X } from 'lucide-react';

// ─── Shared kbd hint for empty galleries ─────────────────────────────────────

const PasteHint = memo(function PasteHint() {
  // Phase 9 (2026-05-25): hint обновлён — теперь работает и drag-drop, и Ctrl+V.
  // Drag-drop активен на wrapper-уровне всей секции (task / solution / rubric);
  // визуальный feedback — dashed border + overlay «Отпустите для добавления».
  return (
    <p className="text-xs text-muted-foreground">
      Перетащи фото или вставь скриншот:{' '}
      <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">
        Ctrl
      </kbd>
      +
      <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">
        V
      </kbd>
    </p>
  );
});

// ─── Photo thumbnail (memoized) ──────────────────────────────────────────────

interface PhotoThumbnailProps {
  /** storage ref (used as stable key) */
  storageRef: string;
  /** Optional blob preview URL (set only for photos uploaded in current session) */
  previewUrl: string | null;
  /** Optional signed URL for persisted KB/edit-mode photos. */
  resolvedUrl?: string | null;
  index: number;
  onRemove: (index: number) => void;
  onOpenZoom: (index: number) => void;
}

const PhotoThumbnail = memo(function PhotoThumbnail({
  storageRef: _storageRef,
  previewUrl,
  resolvedUrl,
  index,
  onRemove,
  onOpenZoom,
}: PhotoThumbnailProps) {
  const imageUrl = previewUrl ?? resolvedUrl ?? null;

  return (
    <div className="relative group">
      {imageUrl ? (
        <button
          type="button"
          onClick={() => onOpenZoom(index)}
          aria-label={`Увеличить фото ${index + 1}`}
          title={`Увеличить фото ${index + 1}`}
          style={{ touchAction: 'manipulation' }}
          className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <img
            src={imageUrl}
            alt={`Фото ${index + 1}`}
            loading="lazy"
            className="w-20 h-20 object-cover rounded-md border border-slate-200 bg-slate-50"
          />
        </button>
      ) : (
        <div className="w-20 h-20 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center">
          <ImageIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
        </div>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove(index);
        }}
        aria-label={`Удалить фото ${index + 1}`}
        title={`Удалить фото ${index + 1}`}
        style={{ touchAction: 'manipulation' }}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/80 text-white flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-slate-900 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
});

// ─── Add photo button (memoized) ─────────────────────────────────────────────

interface AddPhotoButtonProps {
  disabled: boolean;
  isUploading: boolean;
  max: number;
  onClick: () => void;
}

const AddPhotoButton = memo(function AddPhotoButton({
  disabled,
  isUploading,
  max,
  onClick,
}: AddPhotoButtonProps) {
  const title = disabled
    ? `Максимум ${max} фото`
    : isUploading
      ? 'Загрузка...'
      : 'Добавить фото';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isUploading}
      aria-disabled={disabled || isUploading}
      title={title}
      style={{ touchAction: 'manipulation' }}
      className="w-20 h-20 rounded-md border-2 border-dashed border-slate-300 text-slate-500 flex flex-col items-center justify-center gap-1 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-300 disabled:hover:text-slate-500"
    >
      {isUploading ? (
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
      ) : (
        <Plus className="w-5 h-5" aria-hidden="true" />
      )}
      <span className="text-xs leading-tight">
        {isUploading ? 'Загрузка' : 'Добавить'}
      </span>
    </button>
  );
});

// ─── Photo gallery (task condition OR rubric) ─────────────────────────────────

export interface PhotoGalleryProps {
  label: string;
  max: number;
  refs: string[];
  isUploading: boolean;
  /** Local blob preview URLs, keyed by storage ref. */
  previewUrls: Record<string, string>;
  /** Signed URLs for persisted storage refs, keyed by storage ref. */
  resolvedUrls: Record<string, string>;
  onAddFiles: (files: File[]) => void;
  onRemove: (index: number) => void;
  onOpenZoom: (index: number) => void;
  /** Show "Or paste Ctrl+V" kbd hint under gallery when empty. Default true. */
  showPasteHint?: boolean;
}

export function PhotoGallery({
  label,
  max,
  refs,
  isUploading,
  previewUrls,
  resolvedUrls,
  onAddFiles,
  onRemove,
  onOpenZoom,
  showPasteHint = true,
}: PhotoGalleryProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const atLimit = refs.length >= max;

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length) onAddFiles(files);
      if (inputRef.current) inputRef.current.value = '';
    },
    [onAddFiles],
  );

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div
        className="flex gap-2 flex-wrap"
        style={{ touchAction: 'pan-x' }}
      >
        {refs.map((ref, index) => (
          <PhotoThumbnail
            key={ref}
            storageRef={ref}
            previewUrl={previewUrls[ref] ?? null}
            resolvedUrl={resolvedUrls[ref] ?? null}
            index={index}
            onRemove={onRemove}
            onOpenZoom={onOpenZoom}
          />
        ))}
        <AddPhotoButton
          disabled={atLimit}
          isUploading={isUploading}
          max={max}
          onClick={() => inputRef.current?.click()}
        />
      </div>
      {showPasteHint && refs.length === 0 && <PasteHint />}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={handleInputChange}
        disabled={atLimit || isUploading}
      />
    </div>
  );
}
