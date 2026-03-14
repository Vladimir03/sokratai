import { ImagePlus, X } from 'lucide-react';
import { MAX_TASK_IMAGES } from '@/lib/kbApi';
import { cn } from '@/lib/utils';
import type { UseImageUploadReturn } from '@/hooks/useImageUpload';

interface ImageUploadFieldProps {
  /** Legend label, e.g. "Фото задачи" or "Фото решения" */
  label: string;
  /** Hook return value from useImageUpload */
  imageUpload: UseImageUploadReturn;
  /** Disable all interactive controls (during save). */
  disabled?: boolean;
}

export function ImageUploadField({ label, imageUpload, disabled }: ImageUploadFieldProps) {
  const {
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

  const maxImages = MAX_TASK_IMAGES;

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
                      <img
                        src={signedUrl}
                        alt={`Фото ${idx + 1}`}
                        className="h-24 w-24 rounded-lg border border-socrat-border object-cover"
                      />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-socrat-border bg-socrat-surface">
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
                  <img
                    src={url}
                    alt={`Фото ${existingRefs.length + index + 1}`}
                    className="h-24 w-24 rounded-lg border border-socrat-border object-cover"
                  />
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
        )}
      </div>
    </fieldset>
  );
}
