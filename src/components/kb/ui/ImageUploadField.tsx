import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { MAX_TASK_IMAGES } from '@/lib/attachmentRefs';
import { cn } from '@/lib/utils';
// Единый зум-UX с ДЗ-конструктором (HWTaskCard использует этот же carousel):
// стрелки + счётчик + свайп + клавиатура; принимает blob/signed URL напрямую.
import { FullscreenImageCarousel } from '@/components/homework/shared/FullscreenImageCarousel';
import type { UseImageUploadReturn } from '@/hooks/useImageUpload';

interface ImageUploadFieldProps {
  /** Legend label, e.g. "Фото задачи" or "Фото решения" */
  label: string;
  /** Hook return value from useImageUpload */
  imageUpload: UseImageUploadReturn;
  /** Disable all interactive controls (during save). */
  disabled?: boolean;
  /**
   * 'photo' (default) — квадратные превью с object-cover (фото/скриншоты).
   * 'document' — портретные A4-превью с object-contain + подпись «стр. N»:
   * страницы PDF нельзя кропать квадратом — репетитор не поймёт, какая где
   * (UX review P1, 2026-07-06). Подпись берётся из имени файла (…-p{N}.jpg).
   */
  previewVariant?: 'photo' | 'document';
}

/** «стр. N» из имени страницы PDF ({base}-p{N}.jpg); иначе порядковый номер. */
function documentCaption(fileName: string | undefined, fallbackIndex: number): string {
  const m = fileName?.match(/-p(\d+)\.[a-z]+$/i);
  return m ? `стр. ${m[1]}` : `${fallbackIndex + 1}`;
}

export function ImageUploadField({
  label,
  imageUpload,
  disabled,
  previewVariant = 'photo',
}: ImageUploadFieldProps) {
  const {
    files,
    previewUrls,
    existingRefs,
    existingSignedUrls,
    isDragging,
    totalImages,
    canAddMore,
    handleFileInput,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleRemoveNew,
    handleRemoveExisting,
    fileInputRef,
  } = imageUpload;

  const maxImages = imageUpload.maxImages ?? MAX_TASK_IMAGES;
  const isDocument = previewVariant === 'document';

  // Клик по превью → полноэкранный просмотр (единый UX с загрузкой фото в ДЗ).
  // Единый массив в ПОРЯДКЕ отображения: existing (signed) первыми, затем new (blob).
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const zoomImages = [
    ...existingRefs.map((ref) => existingSignedUrls[ref] ?? ''),
    ...previewUrls,
  ];
  // A4-портрет (~0.71) вместо квадрата; contain на белом — страница читается целиком.
  const thumbClass = isDocument
    ? 'h-28 w-20 rounded-lg border border-socrat-border bg-white object-contain'
    : 'h-24 w-24 rounded-lg border border-socrat-border object-cover';

  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold text-slate-500">
        {label}
        {totalImages > 0 ? ` (${totalImages}/${maxImages})` : ` — до ${maxImages}`}
      </legend>

      {/* Hidden file input */}
      <input
        ref={fileInputRef as React.RefObject<HTMLInputElement>}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInput}
        className="hidden"
      />

      {/* Drop zone */}
      <div
        className="relative"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-socrat-primary bg-socrat-primary/5">
            <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-md">
              <ImagePlus className="h-5 w-5 text-socrat-primary" />
              <span className="text-sm font-medium text-socrat-primary">
                Отпустите для добавления
              </span>
            </div>
          </div>
        )}

        {totalImages > 0 ? (
          <div className={cn('space-y-2', disabled && 'pointer-events-none opacity-50')}>
            <div className="flex flex-wrap gap-2">
              {/* Existing images (from DB) */}
              {existingRefs.map((ref, idx) => {
                const signedUrl = existingSignedUrls[ref];
                return (
                  <div key={ref} className="relative">
                    {signedUrl ? (
                      <button
                        type="button"
                        onClick={() => setZoomIndex(idx)}
                        aria-label={`Открыть фото ${idx + 1} во весь экран`}
                        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-primary/50 [touch-action:manipulation]"
                      >
                        <img loading="lazy"
                          src={signedUrl}
                          alt={`Фото ${idx + 1}`}
                          className={thumbClass}
                        />
                      </button>
                    ) : (
                      <div className={cn(
                        'flex items-center justify-center rounded-lg border border-socrat-border bg-socrat-surface',
                        isDocument ? 'h-28 w-20' : 'h-24 w-24',
                      )}>
                        <ImagePlus className="h-5 w-5 animate-pulse text-slate-300" />
                      </div>
                    )}
                    <button
                      type="button"
                      aria-label={`Удалить фото ${idx + 1}`}
                      onClick={() => handleRemoveExisting(ref)}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white shadow-md transition-colors hover:bg-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}

              {/* New images (blob URLs) */}
              {previewUrls.map((url, index) => (
                <div key={`new-${index}`} className="relative">
                  <button
                    type="button"
                    onClick={() => setZoomIndex(existingRefs.length + index)}
                    aria-label={`Открыть фото ${existingRefs.length + index + 1} во весь экран`}
                    className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-primary/50 [touch-action:manipulation]"
                  >
                    <img loading="lazy"
                      src={url}
                      alt={`Фото ${existingRefs.length + index + 1}`}
                      className={thumbClass}
                    />
                  </button>
                  {isDocument ? (
                    <p className="mt-0.5 text-center text-[10px] font-medium text-slate-500">
                      {documentCaption(files[index]?.name, existingRefs.length + index)}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Удалить фото ${existingRefs.length + index + 1}`}
                    onClick={() => handleRemoveNew(index)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white shadow-md transition-colors hover:bg-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>

            {canAddMore && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-socrat-primary transition-colors hover:text-socrat-primary-dark"
              >
                Добавить ещё
              </button>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-socrat-border bg-socrat-surface px-4 py-4 text-sm text-slate-500 transition-colors duration-200 hover:border-socrat-primary/40 hover:text-socrat-primary',
                disabled && 'pointer-events-none opacity-50',
              )}
            >
              <ImagePlus className="h-4.5 w-4.5" />
              Прикрепить фото
            </button>
            <p className="mt-1.5 text-xs text-slate-500">
              Перетащи фото или вставь:{' '}
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">
                Ctrl
              </kbd>
              +
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">
                V
              </kbd>
              {' '}в поле условия задачи
            </p>
          </>
        )}
      </div>

      {/* Полноэкранный просмотр — тот же carousel, что в ДЗ-конструкторе
          (стрелки/счётчик/свайп/клавиатура). Blob и signed URL — напрямую. */}
      <FullscreenImageCarousel
        images={zoomImages}
        openIndex={zoomIndex}
        onClose={() => setZoomIndex(null)}
        onNavigate={setZoomIndex}
        ariaTitle={label}
        ariaDescription="Просмотр изображений во весь экран"
      />
    </fieldset>
  );
}
