import { useState } from 'react';
import { ChevronDown, Folder, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useFolderTree } from '@/hooks/useFolders';
import { useImageUpload } from '@/hooks/useImageUpload';
import { deleteKBTaskImage, uploadKBTaskImage } from '@/lib/kbApi';
import { ImageUploadField } from '@/components/kb/ui/ImageUploadField';
import {
  extractTasks,
  KbAiExtractApiError,
  type ExtractStats,
  type ExtractedTask,
} from '@/lib/kbAiExtractApi';
import { trackKbAiLoaderEvent } from '@/lib/kbAiLoaderTelemetry';
import { cn } from '@/lib/utils';
import type { KBFolderTreeNode } from '@/types/kb';

/** Max screenshots per session (mirror edge MAX_IMAGES). */
const MAX_LOADER_IMAGES = 10;

/** Flatten folder tree into { id, name, depth } for <select> options (mirror CreateTaskModal). */
function flattenTree(
  nodes: KBFolderTreeNode[],
  depth = 0,
): { id: string; name: string; depth: number }[] {
  const result: { id: string; name: string; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, depth });
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  }
  return result;
}

interface InputStageProps {
  initialFolderId: string;
  onExtracted: (drafts: ExtractedTask[], stats: ExtractStats, folderId: string) => void;
}

export function InputStage({ initialFolderId, onExtracted }: InputStageProps) {
  const { tree, loading: treeLoading } = useFolderTree();
  const [folderId, setFolderId] = useState(initialFolderId);
  const [text, setText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const imageUpload = useImageUpload({ maxImages: MAX_LOADER_IMAGES, disabled: isExtracting });

  const flatFolders = flattenTree(tree);
  const hasMaterial = text.trim().length > 0 || imageUpload.files.length > 0;
  const canExtract = folderId !== '' && hasMaterial && !isExtracting;

  const handleExtract = async () => {
    if (!canExtract) return;
    setIsExtracting(true);
    const uploadedRefs: string[] = [];
    try {
      for (const file of imageUpload.getNewFiles()) {
        const res = await uploadKBTaskImage(file);
        uploadedRefs.push(res.storageRef);
      }
      const materialType = uploadedRefs.length > 0 ? 'image' : 'text';
      const { drafts, stats } = await extractTasks({
        folder_id: folderId,
        material: {
          type: materialType,
          text: text.trim() || undefined,
          image_refs: uploadedRefs.length > 0 ? uploadedRefs : undefined,
        },
      });
      trackKbAiLoaderEvent('kb_ai_extract_run', {
        folderId,
        materialType,
        found: stats.found,
        lowConfAnswers: stats.low_confidence_answers,
      });
      if (drafts.length === 0) {
        toast.info('Не удалось распознать задачи в этом материале. Попробуйте другой текст или фото.');
        // Clean up uploaded blobs — nothing will reference them.
        for (const ref of uploadedRefs) void deleteKBTaskImage(ref);
        return;
      }
      onExtracted(drafts, stats, folderId);
    } catch (e) {
      // Uploaded refs won't be reused on retry — clean them up.
      for (const ref of uploadedRefs) void deleteKBTaskImage(ref);
      toast.error(e instanceof KbAiExtractApiError ? e.message : 'Не удалось распознать задачи. Попробуйте ещё раз.');
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Folder select */}
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-slate-500">
          Папка для сохранения <span className="text-red-500">*</span>
        </legend>
        <div className="relative">
          <Folder className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-socrat-folder" />
          <select
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            disabled={isExtracting}
            className="w-full appearance-none rounded-lg border border-socrat-border py-2 pl-8 pr-8 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]"
          >
            <option value="">Выберите папку…</option>
            {treeLoading ? (
              <option disabled>Загрузка…</option>
            ) : (
              flatFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {'　'.repeat(f.depth)}{f.depth > 0 ? '└ ' : ''}{f.name}
                </option>
              ))
            )}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
        {tree.length === 0 && !treeLoading && (
          <p className="mt-1 text-xs text-socrat-muted">Нет папок. Создайте папку в «Моя база».</p>
        )}
      </fieldset>

      {/* Material text — paste screenshots here (Ctrl+V) */}
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-slate-500">Текст задач</legend>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={imageUpload.handlePaste}
          disabled={isExtracting}
          rows={6}
          className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2 text-[16px] leading-relaxed transition-colors focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]"
          placeholder="Вставьте текст задач или вставьте скриншоты страницы сборника (Ctrl+V прямо в это поле)…"
        />
        <p className="mt-1 text-[11px] text-slate-400">PDF и Excel — скоро.</p>
      </fieldset>

      {/* Photo upload (drag / click / paste), up to 10 */}
      <ImageUploadField
        label="Скриншоты задач"
        imageUpload={imageUpload}
        disabled={isExtracting}
      />

      {/* Primary CTA */}
      <button
        type="button"
        disabled={!canExtract}
        onClick={handleExtract}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-xl bg-socrat-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-socrat-primary-dark [touch-action:manipulation]',
          !canExtract && 'cursor-not-allowed opacity-50',
        )}
      >
        {isExtracting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Распознаём задачи…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Распознать задачи
          </>
        )}
      </button>
      {!canExtract && !isExtracting ? (
        <p className="text-center text-xs text-slate-400">
          {folderId === ''
            ? 'Выберите папку для сохранения, чтобы продолжить'
            : 'Добавьте текст задач или хотя бы одно фото'}
        </p>
      ) : null}
    </div>
  );
}
