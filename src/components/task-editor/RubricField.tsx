/**
 * unified-task-model F0 (2026-07-05): извлечено VERBATIM из
 * `homework-create/HWTaskCard.tsx` — секция «Критерии оценки» (свободный текст
 * + фото; при активных структурных критериях — «Доп. заметки для AI»).
 * Gallery-as-props: upload-пайплайн остаётся у поверхности.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { MAX_RUBRIC_IMAGES } from '@/lib/attachmentRefs';
import { PhotoGallery } from './PhotoGallery';

export interface RubricFieldProps {
  value: string;
  onChange: (v: string) => void;
  rubricRefs: string[];
  isUploading: boolean;
  previewUrls: Record<string, string>;
  resolvedUrls: Record<string, string>;
  onAddRubricFiles: (files: File[]) => void;
  onRemoveRubricPhoto: (index: number) => void;
  onOpenRubricZoom: (index: number) => void;
  /** When the structured criteria editor is active above, this free-text field
   *  becomes supplementary notes (relabel to avoid two «Критерии оценки»). */
  supplementary?: boolean;
}

export function RubricField({
  value,
  onChange,
  rubricRefs,
  isUploading,
  previewUrls,
  resolvedUrls,
  onAddRubricFiles,
  onRemoveRubricPhoto,
  onOpenRubricZoom,
  supplementary = false,
}: RubricFieldProps) {
  const [open, setOpen] = useState(Boolean(value) || rubricRefs.length > 0);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {supplementary ? 'Дополнительные заметки для AI (опционально)' : 'Критерии оценки (опционально)'}
      </button>
      {open && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {supplementary
              ? 'Свободный текст / фото в помощь AI (помимо структурных критериев выше).'
              : 'Как начислять баллы. Используется AI при проверке ответа.'}
          </p>
          <textarea
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-y"
            placeholder="Полное решение: 2 балла, только ответ: 1 балл, ошибка в знаке: минус 1 балл (можно вставить скриншот Ctrl+V)..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <PhotoGallery
            label={`Фото критериев (до ${MAX_RUBRIC_IMAGES})`}
            max={MAX_RUBRIC_IMAGES}
            refs={rubricRefs}
            isUploading={isUploading}
            previewUrls={previewUrls}
            resolvedUrls={resolvedUrls}
            onAddFiles={onAddRubricFiles}
            onRemove={onRemoveRubricPhoto}
            onOpenZoom={onOpenRubricZoom}
          />
        </div>
      )}
    </div>
  );
}
