/**
 * unified-task-model F0 (2026-07-05): извлечено VERBATIM из
 * `homework-create/HWTaskCard.tsx` — секция «Эталонное решение (увидит AI)».
 * Gallery-as-props: upload-пайплайн остаётся у поверхности.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { MAX_SOLUTION_IMAGES } from '@/lib/attachmentRefs';
import { PhotoGallery } from './PhotoGallery';

export interface SolutionFieldProps {
  value: string;
  onChange: (v: string) => void;
  solutionRefs: string[];
  fromKB: boolean;
  isUploading: boolean;
  previewUrls: Record<string, string>;
  resolvedUrls: Record<string, string>;
  onAddSolutionFiles: (files: File[]) => void;
  onRemoveSolutionPhoto: (index: number) => void;
  onOpenSolutionZoom: (index: number) => void;
}

export function SolutionField({
  value,
  onChange,
  solutionRefs,
  fromKB,
  isUploading,
  previewUrls,
  resolvedUrls,
  onAddSolutionFiles,
  onRemoveSolutionPhoto,
  onOpenSolutionZoom,
}: SolutionFieldProps) {
  // Open by default when there's content (including KB-imported) — репетитор должен видеть, что AI получит эталон.
  const [open, setOpen] = useState(Boolean(value) || solutionRefs.length > 0);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Эталонное решение (увидит AI)
        {fromKB && (
          <span className="ml-1 rounded-full bg-socrat-folder-bg px-1.5 py-0.5 text-[10px] font-normal text-socrat-folder">
            из БЗ
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            AI будет опираться на решение при подсказках и проверке, но не покажет его ученику. Можно редактировать свободно.
          </p>
          <textarea
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[80px] resize-y"
            placeholder="Пошаговое решение, ключевые формулы, ответ с размерностями (можно вставить скриншот Ctrl+V)..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <PhotoGallery
            label={`Фото решения (до ${MAX_SOLUTION_IMAGES})`}
            max={MAX_SOLUTION_IMAGES}
            refs={solutionRefs}
            isUploading={isUploading}
            previewUrls={previewUrls}
            resolvedUrls={resolvedUrls}
            onAddFiles={onAddSolutionFiles}
            onRemove={onRemoveSolutionPhoto}
            onOpenZoom={onOpenSolutionZoom}
          />
        </div>
      )}
    </div>
  );
}
