import { useRef, useState } from 'react';
import { ChevronDown, FileText, Folder, Loader2, Sparkles } from 'lucide-react';
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
import { loadLastClassification, saveLastSubject } from '@/lib/kbLastClassification';
import { resolveTutorDefaultSubject } from '@/lib/tutorSubjects';
import { useTutorProfile } from '@/hooks/useTutorProfile';
import { cn } from '@/lib/utils';
import { SUBJECTS } from '@/types/homework';
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
  onExtracted: (
    drafts: ExtractedTask[],
    stats: ExtractStats,
    folderId: string,
    subject: string,
  ) => void;
}

export function InputStage({ initialFolderId, onExtracted }: InputStageProps) {
  const { tree, loading: treeLoading } = useFolderTree();
  // Профиль для дефолта предмета (кэш card-ключа тёплый — SideNav держит).
  const { data: tutorProfile } = useTutorProfile();
  const [folderId, setFolderId] = useState(initialFolderId);
  // Дефолт: last-used (серия KB) → профиль репетитора → physics.
  const [subject, setSubject] = useState<string>(() =>
    resolveTutorDefaultSubject(tutorProfile?.subjects, loadLastClassification().subject ?? null),
  );
  const [text, setText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  /** «Страница N из M» при рендере PDF (UX review P1 — не немой спиннер). */
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);
  /** «Загружаем N/M» при аплоаде в storage (UX review P2 — фаза видна отдельно от OCR). */
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  // isRenderingPdf НЕ входит в disabled хука: addFiles сам гейтится на disabled,
  // а страницы добавляются как раз во время рендера PDF (гейт — на контролах).
  const imageUpload = useImageUpload({ maxImages: MAX_LOADER_IMAGES, disabled: isExtracting });

  const flatFolders = flattenTree(tree);
  const hasMaterial = text.trim().length > 0 || imageUpload.files.length > 0;
  const canExtract = folderId !== '' && hasMaterial && !isExtracting && !isRenderingPdf;

  // PDF → картинки страниц (client-side, pdfjs lazy) → существующий image-пайплайн.
  const handlePdfSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isExtracting || isRenderingPdf) return;

    const remainingSlots = imageUpload.maxImages - imageUpload.totalImages;
    if (remainingSlots <= 0) {
      toast.error(`Максимум ${imageUpload.maxImages} изображений за раз — удалите лишние или распознайте текущие.`);
      return;
    }

    setIsRenderingPdf(true);
    try {
      // Lazy: pdfjs (~тяжёлый) грузится только при реальном выборе PDF.
      const { renderPdfPagesToFiles, PdfRenderError } = await import('@/lib/pdfToImages');
      try {
        const { files, pageCount, renderedPages } = await renderPdfPagesToFiles(file, {
          maxPages: remainingSlots,
          onProgress: (done, total) => setPdfProgress({ done, total }),
        });
        imageUpload.addFiles(files);
        trackKbAiLoaderEvent('kb_ai_pdf_rendered', { pageCount, renderedPages });
        if (pageCount > renderedPages) {
          // No silent caps (rule 40): честно говорим, что взяли не всё.
          toast.info(`В PDF ${pageCount} стр. — обработаны первые ${renderedPages}. Остальные загрузите вторым прогоном.`);
        } else {
          toast.success(renderedPages === 1 ? 'Страница PDF добавлена' : `Добавлено страниц: ${renderedPages}`);
        }
      } catch (err) {
        toast.error(err instanceof PdfRenderError ? err.message : 'Не удалось обработать PDF. Попробуйте другой файл.');
      }
    } catch {
      // Сбой загрузки самого чанка pdfjs (сеть/DPI) — отдельно от ошибок файла.
      toast.error('Не удалось загрузить модуль PDF. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      setIsRenderingPdf(false);
      setPdfProgress(null);
    }
  };

  const handleExtract = async () => {
    if (!canExtract) return;
    setIsExtracting(true);
    const uploadedRefs: string[] = [];
    try {
      const newFiles = imageUpload.getNewFiles();
      for (const file of newFiles) {
        setUploadProgress({ done: uploadedRefs.length, total: newFiles.length });
        const res = await uploadKBTaskImage(file);
        uploadedRefs.push(res.storageRef);
      }
      setUploadProgress(null); // дальше — фаза распознавания
      const materialType = uploadedRefs.length > 0 ? 'image' : 'text';
      const { drafts, stats } = await extractTasks({
        folder_id: folderId,
        subject,
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
      // Персист предмета в last-used (review P2): следующий заход загрузчика/
      // форм/корзины стартует с него — не переключать «Химия» каждый раз.
      saveLastSubject(subject);
      onExtracted(drafts, stats, folderId, subject);
    } catch (e) {
      // Uploaded refs won't be reused on retry — clean them up.
      for (const ref of uploadedRefs) void deleteKBTaskImage(ref);
      toast.error(e instanceof KbAiExtractApiError ? e.message : 'Не удалось распознать задачи. Попробуйте ещё раз.');
    } finally {
      setIsExtracting(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Предмет — выбирает системный промпт распознавания (физика / обществознание /
          generic для остальных школьных). Полный словарь SUBJECTS. */}
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-slate-500">Предмет</legend>
        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={isExtracting}
          className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]"
        >
          {SUBJECTS.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </fieldset>

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
        <p className="mt-1 text-[11px] text-slate-400">Excel — скоро.</p>
      </fieldset>

      {/* Photo upload (drag / click / paste), up to 10.
          previewVariant="document": среди превью бывают страницы PDF — портретный
          contain + «стр. N», чтобы было видно, какую страницу удаляешь (UX P1). */}
      <ImageUploadField
        label="Скриншоты задач"
        imageUpload={imageUpload}
        disabled={isExtracting}
        previewVariant="document"
      />

      {/* PDF → страницы-картинки (P1 TASK-10; листы до 10 страниц) */}
      <div>
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handlePdfSelect}
          className="hidden"
        />
        <button
          type="button"
          disabled={isExtracting || isRenderingPdf}
          onClick={() => pdfInputRef.current?.click()}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-socrat-border bg-white px-4 py-3 text-sm font-medium text-slate-600 transition-colors duration-200 hover:border-socrat-primary/40 hover:text-socrat-primary [touch-action:manipulation]',
            (isExtracting || isRenderingPdf) && 'cursor-not-allowed opacity-50',
          )}
        >
          {isRenderingPdf ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {pdfProgress && pdfProgress.total > 0
                ? `Страница ${Math.min(pdfProgress.done + 1, pdfProgress.total)} из ${pdfProgress.total}…`
                : 'Открываем PDF…'}
            </>
          ) : (
            <>
              <FileText className="h-4 w-4" aria-hidden="true" />
              Загрузить PDF с заданиями (до {MAX_LOADER_IMAGES} страниц)
            </>
          )}
        </button>
        <p className="mt-1 text-[11px] text-slate-400">
          Страницы PDF станут изображениями выше — лишние можно удалить до распознавания.
        </p>
      </div>

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
            {uploadProgress && uploadProgress.total > 0
              ? `Загружаем изображения ${Math.min(uploadProgress.done + 1, uploadProgress.total)}/${uploadProgress.total}…`
              : 'Распознаём задачи…'}
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
