import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Folder, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useFolderTree } from '@/hooks/useFolders';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useSubtopics, useTopics } from '@/hooks/useKnowledgeBase';
import { deleteKBTaskImage, uploadKBTaskImage } from '@/lib/kbApi';
import { ImageUploadField } from '@/components/kb/ui/ImageUploadField';
import {
  extractTasks,
  KbAiExtractApiError,
  type AnswersTableEntry,
  type ExtractResponse,
  type ExtractStats,
  type ExtractedTask,
} from '@/lib/kbAiExtractApi';
import { trackKbAiLoaderEvent } from '@/lib/kbAiLoaderTelemetry';
import { loadLastClassification, saveLastSubject } from '@/lib/kbLastClassification';
import { scanTaskMarkers } from '@/lib/taskMarkers';
import { resolveTutorDefaultSubject } from '@/lib/tutorSubjects';
import { useTutorProfile } from '@/hooks/useTutorProfile';
import { cn } from '@/lib/utils';
import { SUBJECTS } from '@/types/homework';
import type { BatchClassification, ExtractCompleteness } from '@/components/kb/AiTaskLoader/reviewTypes';
import type { CatalogFilter, KBFolderTreeNode } from '@/types/kb';

/** Max screenshots per session (mirror edge MAX_IMAGES). */
const MAX_LOADER_IMAGES = 10;

/**
 * W3.1 (2026-07-12): кап страниц PDF за сессию С УЧЁТОМ очереди. Страницы сверх
 * первых 10 слотов копятся в pdfQueue и распознаются автоматически по частям.
 */
const MAX_PDF_PAGES_TOTAL = 60;

/**
 * W4 (2026-07-16, репорт физика «73 из 73» + демо химиков): страниц-картинок на
 * ОДИН AI-вызов. Было 10 → плотный сборник (решуЕГЭ ~15 задач/стр) отправлял до
 * 150 задач в один вызов, и модель «лениво» отдавала первые 5-7 (вывод такого
 * объёма физически не помещается). 2 страницы ≈ 15-30 задач ≈ 3-8k output-токенов
 * — комфортно. Универсально для страниц PDF И ручных скриншотов (химики: «по
 * одному скриншоту работает» — ровно поэтому).
 */
const CHUNK_IMAGES = 2;
/** Параллельных extract-вызовов (upload-first делает офсеты детерминированными). */
const EXTRACT_CONCURRENCY = 3;
/** Хвост текста следующей страницы — для завершения задачи, разрезанной границей. */
const NEXT_PAGE_TAIL_CHARS = 600;
/** Распознано < 60% ожидаемого по текстовому слою → авто-повтор чанка (1 раз). */
const SHORTFALL_RATIO = 0.6;
/** Кап текста одного вызова (зеркало edge MAX_TEXT_CHARS с запасом). */
const CHUNK_TEXT_CAP = 59_000;

/** Общий класс select'ов каскада «тема по умолчанию» (16px + touch — rule 80/90). */
const CASCADE_SELECT_CLASS =
  'w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]';

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
  /**
   * hw-режим (фаза 1 «один загрузчик — N назначений»): предмет форсится из
   * конструктора ДЗ (meta.subject) — селектор предмета скрыт, last-used Базы
   * не загрязняется.
   */
  fixedSubject?: string;
  /**
   * hw-режим: lazy find-or-create папки «Из ДЗ» вместо селектора папки
   * (edge-гейт требует folder_id владельца; резолвим в начале handleExtract).
   */
  resolveFolderIdLazy?: () => Promise<string>;
  /** Сигнал занятости для гарда закрытия Sheet-хоста (hw-режим). */
  onExtractingChange?: (busy: boolean) => void;
  /** Метка назначения для телеметрии (default: hw при lazy-папке, иначе kb). */
  telemetryDestination?: 'kb' | 'hw' | 'mock';
  onExtracted: (
    drafts: ExtractedTask[],
    stats: ExtractStats,
    folderId: string,
    subject: string,
    /** Волна 2: загруженные refs исходников — контекст refine + orphan-cleanup. */
    uploadedRefs: string[],
    /** W4: честность о полноте (ожидание по текстовому слою PDF + недоборы). */
    completeness: ExtractCompleteness,
    /** ВОЛНА 5: тема/тип по умолчанию на весь пакет (пусто для hw/mock). */
    defaultClassification: BatchClassification,
  ) => void;
}

export function InputStage({
  initialFolderId,
  fixedSubject,
  resolveFolderIdLazy,
  onExtractingChange,
  telemetryDestination,
  onExtracted,
}: InputStageProps) {
  const isHw = resolveFolderIdLazy !== undefined;
  // hw-режим: дерево папок не нужно (папка резолвится лениво) — disabled-query
  // не фетчится и не focus-рефетчится под high-risk конструктором ДЗ.
  const { tree, loading: treeLoading } = useFolderTree({ enabled: !isHw });
  // Профиль для дефолта предмета (кэш card-ключа тёплый — SideNav держит).
  const { data: tutorProfile } = useTutorProfile();
  const [folderId, setFolderId] = useState(initialFolderId);
  // Дефолт: форс из конструктора (hw) → [один предмет в профиле] → last-used
  // (серия KB) → профиль → physics.
  const [subject, setSubject] = useState<string>(() =>
    fixedSubject ??
    resolveTutorDefaultSubject(tutorProfile?.subjects, loadLastClassification().subject ?? null),
  );
  // Холодный кэш профиля мог не успеть к useState-init (редко — SideNav держит
  // тёплым). One-shot ре-дефолт, когда профиль подъехал: ТОЛЬКО если тутор не
  // трогал селектор и нет last-used (не клоббер выбора — класс багов rule 40).
  const userTouchedSubjectRef = useRef(false);
  const subjectAutoSetRef = useRef(false);
  useEffect(() => {
    if (subjectAutoSetRef.current) return;
    if (fixedSubject !== undefined) return; // hw форсит предмет
    if (userTouchedSubjectRef.current) return; // тутор выбрал вручную
    if (loadLastClassification().subject) return; // last-used уже решил init
    const profs = tutorProfile?.subjects;
    if (!profs || profs.length === 0) return; // ждём профиль
    subjectAutoSetRef.current = true;
    setSubject(resolveTutorDefaultSubject(profs, null));
  }, [tutorProfile, fixedSubject]);
  // ВОЛНА 5: тема по умолчанию на ВЕСЬ пакет (необязательно) — предмет → тип →
  // тема → подтема. Применится ко всем задачам (переопределение по одной — в
  // ревью). Только KB-назначение (fixedSubject === undefined).
  const [defaultExam, setDefaultExam] = useState<'' | 'ege' | 'oge'>('');
  const [defaultTopicId, setDefaultTopicId] = useState('');
  const [defaultSubtopicId, setDefaultSubtopicId] = useState('');
  const defaultTopicFilter: CatalogFilter | undefined = defaultExam || undefined;
  const { topics: defaultTopics = [], loading: defaultTopicsLoading } = useTopics(
    defaultTopicFilter,
    subject,
  );
  const { subtopics: defaultSubtopics = [], loading: defaultSubtopicsLoading } = useSubtopics(
    defaultTopicId || undefined,
  );
  const [text, setText] = useState('');
  // Свободная подсказка для AI (#45а): «ответы в конце страницы», «все задачи — КИМ 17»…
  const [tutorHint, setTutorHint] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  /** «Страница N из M» при рендере PDF (UX review P1 — не немой спиннер). */
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);
  /** «Загружаем N/M» при аплоаде в storage (UX review P2 — фаза видна отдельно от OCR). */
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  /** W4: живой прогресс распознавания — «Страница k из m · найдено N задач» + %. */
  const [chunkProgress, setChunkProgress] = useState<
    { pagesDone: number; pagesTotal: number; tasksFound: number } | null
  >(null);
  /** W3.1: страницы PDF сверх первых 10 слотов — распознаются авто-чанками. */
  const [pdfQueue, setPdfQueue] = useState<File[]>([]);
  /**
   * W4: мета страницы PDF по File-идентичности (ручные скриншоты — без записи):
   * текст (точный источник условий + счёт ожидаемых задач) + принадлежность
   * документу (ревью P1: «ПРОДОЛЖЕНИЕ» — только СОСЕДНЯЯ страница ТОГО ЖЕ PDF,
   * иначе хвост чужого файла «завершал» бы последнюю задачу). Map накапливается
   * за сессию — строки дёшевы.
   */
  const pageTextByFileRef = useRef(
    new Map<File, { text: string | null; docId: number; docPageNo: number }>(),
  );
  /** Счётчик загруженных PDF-документов (docId для смежности страниц). */
  const pdfDocCounterRef = useRef(0);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  // isRenderingPdf НЕ входит в disabled хука: addFiles сам гейтится на disabled,
  // а страницы добавляются как раз во время рендера PDF (гейт — на контролах).
  const imageUpload = useImageUpload({ maxImages: MAX_LOADER_IMAGES, disabled: isExtracting });

  const flatFolders = flattenTree(tree);
  const hasMaterial =
    text.trim().length > 0 || imageUpload.files.length > 0 || pdfQueue.length > 0;
  // hw-режим: папка резолвится лениво в handleExtract — folderId не требуется.
  const canExtract = (isHw || folderId !== '') && hasMaterial && !isExtracting && !isRenderingPdf;

  // PDF → картинки страниц (client-side, pdfjs lazy) → существующий image-пайплайн.
  // W3.1: страницы сверх первых 10 слотов идут в очередь и распознаются
  // автоматически прогонами по 10 — сборник больше не грузят 10 раз руками.
  const handlePdfSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isExtracting || isRenderingPdf) return;

    const remainingSlots = Math.max(0, imageUpload.maxImages - imageUpload.totalImages);
    const queueCapacity = Math.max(
      0,
      MAX_PDF_PAGES_TOTAL - imageUpload.totalImages - pdfQueue.length,
    );
    if (queueCapacity <= 0) {
      toast.error(`Максимум ${MAX_PDF_PAGES_TOTAL} страниц за сессию — распознайте текущие или уберите очередь.`);
      return;
    }

    setIsRenderingPdf(true);
    try {
      // Lazy: pdfjs (~тяжёлый) грузится только при реальном выборе PDF.
      const { renderPdfPagesToFiles, PdfRenderError } = await import('@/lib/pdfToImages');
      try {
        const { files, pageCount, renderedPages, pageTexts, pageNumbers } =
          await renderPdfPagesToFiles(file, {
            maxPages: queueCapacity,
            onProgress: (done, total) => setPdfProgress({ done, total }),
          });
        // W4: мета каждой страницы — по File-идентичности (выровнена с files).
        // docId/docPageNo — для смежности «ПРОДОЛЖЕНИЯ» (ревью P1).
        const docId = ++pdfDocCounterRef.current;
        files.forEach((f, i) =>
          pageTextByFileRef.current.set(f, {
            text: pageTexts[i] ?? null,
            docId,
            docPageNo: pageNumbers[i] ?? i + 1,
          }),
        );
        const visible = files.slice(0, remainingSlots);
        const queued = files.slice(remainingSlots);
        if (visible.length > 0) imageUpload.addFiles(visible);
        if (queued.length > 0) setPdfQueue((prev) => [...prev, ...queued]);
        trackKbAiLoaderEvent('kb_ai_pdf_rendered', { pageCount, renderedPages });
        if (pageCount > renderedPages) {
          // No silent caps (rule 40): честно говорим, что взяли не всё.
          toast.info(`В PDF ${pageCount} стр. — обработаем первые ${renderedPages}. Остальные загрузите отдельным заходом.`);
        } else if (queued.length > 0) {
          toast.success(
            `Добавлено страниц: ${renderedPages}. ${queued.length} из них в очереди — распознаются автоматически по частям.`,
          );
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

  // W3.2 (2026-07-12): CSV/TSV-файл → текст в поле материала (zero deps; AI
  // сам маппит колонки — промпт уже понимает таблицы). Бинарный .xlsx требует
  // библиотеку (решение о зависимости отложено) — «Сохранить как CSV» либо
  // копирование ячеек прямо в поле (paste из Excel = TSV-текст, уже работает).
  const CSV_MAX_CHARS = 60_000; // mirror edge MAX_TEXT_CHARS
  const handleCsvSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isExtracting) return;
    if (/\.xlsx?$/i.test(file.name)) {
      toast.error('Файлы Excel (.xlsx) пока не читаются напрямую — сохраните лист как CSV или скопируйте ячейки в поле текста (Ctrl+V).');
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      let content: string;
      try {
        // Excel-RU часто сохраняет CSV в windows-1251 — utf-8 с fatal ловит это.
        content = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        content = new TextDecoder('windows-1251').decode(buf);
      }
      const trimmed = content.trim();
      if (!trimmed) {
        toast.error('Файл пустой.');
        return;
      }
      const combined = text.trim() ? `${text.trimEnd()}\n\n${trimmed}` : trimmed;
      if (combined.length > CSV_MAX_CHARS) {
        toast.error('Слишком много текста за один раз — разбейте таблицу на части.');
        return;
      }
      setText(combined);
      toast.success('Таблица добавлена в поле текста — нажмите «Распознать задачи».');
    } catch {
      toast.error('Не удалось прочитать файл. Попробуйте другой формат (CSV).');
    }
  };

  const handleExtract = async () => {
    if (!canExtract) return;
    setIsExtracting(true);
    onExtractingChange?.(true);

    // W4 (2026-07-16, «73 из 73»): upload-first → мелкие чанки по CHUNK_IMAGES
    // страниц → параллельные вызовы → авто-повтор недобора. Порядок файлов:
    // видимые (скриншоты + первые страницы PDF) + очередь PDF.
    const allFiles = [...imageUpload.getNewFiles(), ...pdfQueue];
    const textareaText = text.trim();
    const allRefs: string[] = []; // ВСЕ успешно загруженные (для cleanup/ревью)
    // hw-режим: лениво резолвим папку «Из ДЗ» — ДО фазы аплоада (сбой = ничего
    // не залито, чистый выход с русской фразой через общий catch).
    let effectiveFolderId = folderId;

    try {
      if (resolveFolderIdLazy) {
        try {
          effectiveFolderId = await resolveFolderIdLazy();
        } catch (e) {
          throw new KbAiExtractApiError(
            e instanceof Error ? e.message : 'Не удалось подготовить папку «Из ДЗ».',
          );
        }
      }
      // ── Фаза 1: залить ВСЕ файлы заранее — офсеты source_image_index каждого
      // чанка детерминированы → вызовы можно параллелить.
      interface PageEntry {
        ref: string;
        pageText: string | null;
        /** 1-based глобальный номер страницы (для лейблов «стр. N»). */
        pageNo: number;
        /** Принадлежность PDF-документу (null = ручной скриншот): смежность
         *  «ПРОДОЛЖЕНИЯ» — только соседняя страница ТОГО ЖЕ PDF (ревью P1). */
        doc: { docId: number; docPageNo: number } | null;
      }
      const entries: PageEntry[] = [];
      const failedUploadPages: number[] = [];
      for (let i = 0; i < allFiles.length; i += 1) {
        setUploadProgress({ done: i, total: allFiles.length });
        const file = allFiles[i];
        let ref: string | null = null;
        for (let attempt = 0; attempt < 2 && ref === null; attempt += 1) {
          try {
            ref = (await uploadKBTaskImage(file)).storageRef;
          } catch {
            /* RU DPI рвёт ~1 из N запросов — второй заход обычно проходит */
          }
        }
        if (ref !== null) {
          allRefs.push(ref);
          const meta = pageTextByFileRef.current.get(file);
          entries.push({
            ref,
            pageText: meta?.text ?? null,
            pageNo: i + 1,
            doc: meta ? { docId: meta.docId, docPageNo: meta.docPageNo } : null,
          });
        } else {
          failedUploadPages.push(i + 1);
        }
      }
      setUploadProgress(null);
      if (allFiles.length > 0 && entries.length === 0) {
        throw new KbAiExtractApiError('Не удалось загрузить изображения. Проверьте соединение и попробуйте ещё раз.');
      }
      if (failedUploadPages.length > 0) {
        toast.warning(`Не загрузились страницы: ${failedUploadPages.join(', ')} — распознаем без них.`);
      }

      // Скан нумерации текстового слоя: ожидаемое число задач + сами НОМЕРА.
      // Фидбэк химиков (2026-07-16): у полного варианта (stepenin [1]..[34])
      // сквозная нумерация = № КИМ → проставляем детерминированно.
      const markerScan = scanTaskMarkers(entries.map((e) => e.pageText));
      const expectedPerEntry = markerScan.perPage;

      // ── Фаза 2: чанки по CHUNK_IMAGES страниц.
      interface Chunk {
        entries: PageEntry[];
        /** Офсет первой страницы чанка в entries (= в allRefs). */
        startIndex: number;
        /** Σ ожидаемых задач страниц чанка (null = хотя бы одна без ожидания). */
        expected: number | null;
        /** Номера маркеров страниц чанка по порядку (для авто-КИМ полного
         *  варианта); null = хотя бы одна страница без надёжной нумерации. */
        markerNumbers: number[] | null;
        pageLabel: string;
      }
      const chunks: Chunk[] = [];
      if (entries.length === 0) {
        // Текст без картинок — один вызов.
        chunks.push({ entries: [], startIndex: 0, expected: null, markerNumbers: null, pageLabel: '' });
      } else {
        for (let i = 0; i < entries.length; i += CHUNK_IMAGES) {
          const chunkEntries = entries.slice(i, i + CHUNK_IMAGES);
          const exps = chunkEntries.map((_, j) => expectedPerEntry[i + j]);
          const known = exps.filter((v): v is number => v !== null);
          const nums = chunkEntries.map((_, j) => markerScan.numbersPerPage[i + j]);
          const first = chunkEntries[0].pageNo;
          const last = chunkEntries[chunkEntries.length - 1].pageNo;
          chunks.push({
            entries: chunkEntries,
            startIndex: i,
            expected: known.length === chunkEntries.length ? known.reduce((a, b) => a + b, 0) : null,
            markerNumbers: nums.every((n): n is number[] => n !== null) ? nums.flat() : null,
            pageLabel: first === last ? `стр. ${first}` : `стр. ${first}–${last}`,
          });
        }
      }

      // Текст вызова: textarea → ТОЛЬКО чанк 0 (инвариант W3.1 — иначе задачи из
      // него дублируются каждым прогоном); текст страниц чанка (точный источник
      // условий) + хвост следующей страницы (задача, разрезанная границей).
      // Бюджет БЕЗ слепого slice (ревью P1): textarea пользователя НЕ режем
      // (переполнение честно отобьёт edge MATERIAL_TOO_LARGE, как раньше);
      // page-text'ы добавляются целиком, пока влезают (картинка страницы всё
      // равно приложена — модель прочтёт с неё); ПРОДОЛЖЕНИЕ — только при
      // остатке бюджета И только СОСЕДНЯЯ страница ТОГО ЖЕ PDF (ревью P1:
      // хвост другого документа «завершал» бы последнюю задачу чужим текстом).
      const buildChunkText = (chunk: Chunk, chunkIdx: number): string => {
        const parts: string[] = [];
        let budget = CHUNK_TEXT_CAP;
        const pushIfFits = (part: string): boolean => {
          if (part.length + 2 > budget) return false;
          parts.push(part);
          budget -= part.length + 2; // + разделитель '\n\n'
          return true;
        };
        if (chunkIdx === 0 && textareaText) {
          // Пользовательский ввод всегда целиком (даже сверх бюджета — тогда
          // edge вернёт явную ошибку, а не молчаливое усечение).
          parts.push(textareaText);
          budget -= textareaText.length + 2;
        }
        for (const e of chunk.entries) {
          if (!e.pageText) continue;
          pushIfFits(`— ТЕКСТ СТРАНИЦЫ ${e.pageNo} (извлечён из PDF) —\n${e.pageText}`);
        }
        const lastEntry = chunk.entries[chunk.entries.length - 1];
        const next = entries[chunk.startIndex + chunk.entries.length];
        const isAdjacentSameDoc =
          lastEntry?.doc != null &&
          next?.doc != null &&
          next.doc.docId === lastEntry.doc.docId &&
          next.doc.docPageNo === lastEntry.doc.docPageNo + 1;
        if (isAdjacentSameDoc && next.pageText && lastEntry.pageText) {
          pushIfFits(
            `— ПРОДОЛЖЕНИЕ (начало следующей страницы; только для завершения последней задачи, новых задач отсюда не начинать) —\n${next.pageText.slice(0, NEXT_PAGE_TAIL_CHARS)}`,
          );
        }
        return parts.join('\n\n');
      };

      // ── Фаза 3: параллельный пул extract-вызовов + живой прогресс.
      const pagesTotal = entries.length;
      let pagesDone = 0;
      let tasksFound = 0;
      let autoRetries = 0;
      if (pagesTotal > 0) setChunkProgress({ pagesDone: 0, pagesTotal, tasksFound: 0 });

      type ChunkResult =
        | { ok: true; drafts: ExtractedTask[]; stats: ExtractStats; answers_table?: AnswersTableEntry[] }
        | { ok: false; error: unknown };
      const results: ChunkResult[] = new Array(chunks.length);

      const runChunk = async (idx: number): Promise<ExtractResponse> => {
        const chunk = chunks[idx];
        const chunkRefs = chunk.entries.map((e) => e.ref);
        const callExtract = (hintOverride?: string, boost?: boolean) =>
          extractTasks({
            folder_id: effectiveFolderId,
            subject,
            material: {
              type: chunkRefs.length > 0 ? 'image' : 'text',
              text: buildChunkText(chunk, idx) || undefined,
              image_refs: chunkRefs.length > 0 ? chunkRefs : undefined,
            },
            tutor_hint: (hintOverride ?? tutorHint.trim()) || undefined,
            ...(boost ? { boost: true } : {}),
          });
        let res = await callExtract();
        // Авто-повтор недобора (решение владельца 2026-07-16): текстовый слой
        // обещает K задач, распознано < 60% → 1 повтор с жёсткой подсказкой И
        // усиленной моделью (boost → edge берёт pro); берём лучший результат.
        if (chunk.expected !== null && res.drafts.length < chunk.expected * SHORTFALL_RATIO) {
          autoRetries += 1;
          try {
            const retryHint =
              `На этих страницах ровно ${chunk.expected} задач — извлеки ВСЕ до единой, не сокращай список. ${tutorHint.trim()}`.slice(0, 500);
            const retry = await callExtract(retryHint, true);
            if (retry.drafts.length > res.drafts.length) res = retry;
          } catch {
            /* повтор не удался — остаёмся с первым результатом */
          }
        }
        return res;
      };

      let nextIdx = 0;
      const worker = async () => {
        while (nextIdx < chunks.length) {
          const idx = nextIdx;
          nextIdx += 1;
          try {
            const res = await runChunk(idx);
            results[idx] = { ok: true, ...res };
            tasksFound += res.drafts.length;
          } catch (error) {
            results[idx] = { ok: false, error };
          }
          pagesDone += chunks[idx].entries.length;
          if (pagesTotal > 0) setChunkProgress({ pagesDone, pagesTotal, tasksFound });
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(EXTRACT_CONCURRENCY, chunks.length) }, () => worker()),
      );

      // ── Фаза 4: сборка в порядке чанков.
      const allDrafts: ExtractedTask[] = [];
      const totals: ExtractStats = { found: 0, low_confidence_answers: 0, unreadable_images: 0 };
      const failedChunkLabels: string[] = [];
      const shortfalls: ExtractCompleteness['shortfalls'] = [];
      // Кросс-чанковая таблица ответов (2026-07-17): «номер задачи → ответ».
      const answersByNum = new Map<number, string>();
      let completedChunks = 0;
      let kimAutoFilled = 0;
      let firstError: unknown = null;

      results.forEach((r, idx) => {
        const chunk = chunks[idx];
        // === false, не !r.ok: при strictNullChecks:false truthiness не сужает union
        if (r.ok === false) {
          if (chunk.entries.length > 0) failedChunkLabels.push(chunk.pageLabel);
          if (firstError === null) firstError = r.error;
          return;
        }
        // source_image_index — per-chunk (0-based по приложенным этого вызова) →
        // глобальная система координат allRefs через фиксированный офсет чанка.
        // Сбои инлайна внутри чанка смещают индексы → обнуляем (как раньше).
        for (const d of r.drafts) {
          if (d.source_image_index !== null) {
            d.source_image_index =
              r.stats.unreadable_images === 0 ? d.source_image_index + chunk.startIndex : null;
          }
        }
        // Zip маркер→задача (детерминированный), ТОЛЬКО когда число распознанных
        // задач чанка ТОЧНО равно числу маркеров (иначе сдвиг пронумеровал бы
        // весь чанк неверно — лучше оставить AI):
        // - source_num (номер в сборниковой нумерации) — ВСЕГДА: ключ
        //   кросс-чанкового мерджа ответов из answers_table (2026-07-17);
        // - kim_number — только для ПОЛНОГО ВАРИАНТА (фидбэк химиков 2026-07-16:
        //   stepenin [1]..[34] = номера КИМ; маркер ПОБЕЖДАЕТ догадку AI).
        const markerNums = chunk.markerNumbers;
        if (markerNums !== null && r.drafts.length === markerNums.length) {
          r.drafts.forEach((d, i) => {
            d.source_num = markerNums[i];
            if (markerScan.isVariantNumbering) d.kim_number = markerNums[i];
          });
          if (markerScan.isVariantNumbering) kimAutoFilled += r.drafts.length;
        }
        // Таблицы ответов чанков — в общий пул (мердж после полной сборки:
        // таблица может прийти из чанка ПОСЛЕ задач).
        for (const entry of r.answers_table ?? []) {
          if (!answersByNum.has(entry.num)) answersByNum.set(entry.num, entry.answer);
        }
        allDrafts.push(...r.drafts);
        totals.found += r.stats.found;
        totals.low_confidence_answers += r.stats.low_confidence_answers;
        totals.unreadable_images += r.stats.unreadable_images;
        completedChunks += 1;
        if (chunk.expected !== null && r.drafts.length < chunk.expected) {
          shortfalls.push({ pages: chunk.pageLabel, got: r.drafts.length, expected: chunk.expected });
        }
      });

      // Кросс-чанковый мердж ответов (2026-07-17, репорт «ответы только у 31 из
      // 73»): таблица ответов сборника живёт в СВОЁМ чанке и не видна чанкам с
      // условиями. Мержим по номеру сборниковой нумерации (source_num из
      // маркеров). Пустые answer заполняем, непустые НЕ перетираем (ответ из
      // авторской таблицы — но если модель уже вписала, не спорим).
      let answersMerged = 0;
      if (answersByNum.size > 0) {
        for (const d of allDrafts) {
          if (d.answer && d.answer.trim() !== '') continue;
          if (d.source_num == null) continue;
          const fromTable = answersByNum.get(d.source_num);
          if (fromTable === undefined) continue;
          d.answer = fromTable;
          d.answer_confidence = 'high';
          d.needs_review_fields = d.needs_review_fields.filter((f) => f !== 'answer');
          answersMerged += 1;
        }
        if (answersMerged > 0) {
          // Счётчик «без ответа» в totals пересчитается на ревью (live-счёт).
          totals.low_confidence_answers = allDrafts.filter(
            (d) => d.answer_confidence === 'low',
          ).length;
        }
      }

      if (allDrafts.length === 0 && firstError !== null) throw firstError;
      if (failedChunkLabels.length > 0) {
        // Blobs сбойных чанков не удаляем: allRefs должен оставаться выровнен с
        // source_image_index; неиспользованные подчистит orphan-cleanup на commit.
        toast.error(
          `Не распознались: ${failedChunkLabels.join(', ')} — показываем остальное. Эти страницы загрузите отдельным заходом.`,
        );
      }

      const expectedTotal = expectedPerEntry.some((v) => v !== null)
        ? expectedPerEntry.reduce<number>((a, b) => a + (b ?? 0), 0)
        : null;

      trackKbAiLoaderEvent('kb_ai_extract_run', {
        folderId: effectiveFolderId,
        destination: telemetryDestination ?? (isHw ? 'hw' : 'kb'),
        materialType: allRefs.length > 0 ? 'image' : 'text',
        found: totals.found,
        lowConfAnswers: totals.low_confidence_answers,
        chunks: completedChunks,
        expected: expectedTotal,
        autoRetries,
        kimAutoFilled,
        answersMerged,
      });

      if (allDrafts.length === 0) {
        toast.info('Не удалось распознать задачи в этом материале. Попробуйте другой текст или фото.');
        // Clean up uploaded blobs — nothing will reference them.
        for (const ref of allRefs) void deleteKBTaskImage(ref);
        return;
      }
      // Персист предмета в last-used (review P2): следующий заход загрузчика/
      // форм/корзины стартует с него — не переключать «Химия» каждый раз.
      // hw-режим: предмет форсится конструктором — last-used Базы не трогаем.
      if (!fixedSubject) saveLastSubject(subject);
      onExtracted(allDrafts, totals, effectiveFolderId, subject, allRefs, { expectedTotal, shortfalls }, {
        exam: defaultExam,
        topicId: defaultTopicId,
        subtopicId: defaultSubtopicId,
      });
    } catch (e) {
      // Полный провал: залитые blobs никем не референсятся — чистим.
      for (const ref of allRefs) void deleteKBTaskImage(ref);
      toast.error(e instanceof KbAiExtractApiError ? e.message : 'Не удалось распознать задачи. Попробуйте ещё раз.');
    } finally {
      setIsExtracting(false);
      onExtractingChange?.(false);
      setUploadProgress(null);
      setChunkProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Предмет — выбирает системный промпт распознавания (физика / обществознание /
          generic для остальных школьных). Полный словарь SUBJECTS.
          hw-режим: предмет форсится из ДЗ — селектор скрыт. */}
      {fixedSubject === undefined ? (
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-slate-500">Предмет</legend>
          <select
            value={subject}
            onChange={(e) => {
              userTouchedSubjectRef.current = true;
              setSubject(e.target.value);
              setDefaultTopicId('');
              setDefaultSubtopicId('');
            }}
            disabled={isExtracting}
            className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]"
          >
            {SUBJECTS.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </fieldset>
      ) : null}

      {/* ВОЛНА 5: тема по умолчанию на ВЕСЬ пакет (необязательно) — применится ко
          всем распознанным задачам, переопределение по одной остаётся в ревью.
          Только KB-назначение (hw/mock форсят предмет — каскад скрыт). */}
      {fixedSubject === undefined ? (
        <fieldset className="rounded-lg border border-dashed border-socrat-border/70 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-500">
            Тема по умолчанию{' '}
            <span className="font-normal text-slate-400">— применится ко всем задачам, необязательно</span>
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1 block text-[11px] font-medium text-slate-400">Тип</span>
              <select
                aria-label="Тип задания по умолчанию"
                value={defaultExam}
                onChange={(e) => {
                  setDefaultExam(e.target.value as '' | 'ege' | 'oge');
                  setDefaultTopicId('');
                  setDefaultSubtopicId('');
                }}
                disabled={isExtracting}
                className={CASCADE_SELECT_CLASS}
              >
                <option value="">Не указан</option>
                <option value="ege">ЕГЭ</option>
                <option value="oge">ОГЭ</option>
              </select>
            </div>
            <div>
              <span className="mb-1 block text-[11px] font-medium text-slate-400">Тема</span>
              <select
                aria-label="Тема по умолчанию"
                value={defaultTopicId}
                onChange={(e) => {
                  setDefaultTopicId(e.target.value);
                  setDefaultSubtopicId('');
                }}
                disabled={isExtracting || defaultTopicsLoading}
                className={CASCADE_SELECT_CLASS}
              >
                <option value="">Не выбрана</option>
                {defaultTopics.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          {defaultTopicId ? (
            <div className="mt-3">
              <span className="mb-1 block text-[11px] font-medium text-slate-400">Подтема</span>
              <select
                aria-label="Подтема по умолчанию"
                value={defaultSubtopicId}
                onChange={(e) => setDefaultSubtopicId(e.target.value)}
                disabled={isExtracting || defaultSubtopicsLoading}
                className={CASCADE_SELECT_CLASS}
              >
                <option value="">Не выбрана</option>
                {defaultSubtopics.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {/* Folder select — hw-режим: папка резолвится лениво («Из ДЗ»), селектор скрыт. */}
      {!isHw ? (
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
      ) : null}

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
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            disabled={isExtracting}
            onClick={() => csvInputRef.current?.click()}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-socrat-primary hover:underline disabled:opacity-50 [touch-action:manipulation]"
          >
            <FileText className="h-3 w-3" aria-hidden="true" />
            Загрузить CSV-таблицу
          </button>
          <span className="text-[11px] text-slate-400">
            Таблицу из Excel можно вставить прямо в поле (Ctrl+C в Excel → Ctrl+V сюда).
          </span>
        </div>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          onChange={handleCsvSelect}
          className="hidden"
        />
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

      {/* Свободная подсказка для AI (#45а, Егор/Елена): контекст распознавания —
          где ответы, какой КИМ, что не прикреплять. Edge инжектит в промпт. */}
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-slate-500">
          Подсказка для AI <span className="font-normal text-slate-400">(необязательно)</span>
        </legend>
        <input
          type="text"
          value={tutorHint}
          onChange={(e) => setTutorHint(e.target.value)}
          disabled={isExtracting}
          maxLength={500}
          placeholder="Например: «ответы в конце страницы», «все задачи — КИМ 17»"
          className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]"
        />
      </fieldset>

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
              Загрузить PDF с заданиями (до {MAX_PDF_PAGES_TOTAL} страниц)
            </>
          )}
        </button>
        <p className="mt-1 text-[11px] text-slate-400">
          Первые {MAX_LOADER_IMAGES} страниц появятся выше (лишние можно удалить), остальные
          распознаются автоматически по частям.
        </p>
        {/* W3.1: очередь страниц сверх первых 10 слотов (авто-прогоны по 10). */}
        {pdfQueue.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-socrat-primary/20 bg-socrat-primary-light/50 px-3 py-2">
            <span className="text-xs text-slate-600">
              В очереди ещё <span className="font-semibold">{pdfQueue.length}</span> стр. PDF —
              распознаются автоматически по частям.
            </span>
            <button
              type="button"
              disabled={isExtracting}
              onClick={() => setPdfQueue([])}
              className="text-xs font-semibold text-slate-500 transition-colors hover:text-red-600 [touch-action:manipulation]"
            >
              Убрать очередь
            </button>
          </div>
        ) : null}
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
              : chunkProgress
                ? `Страница ${Math.min(chunkProgress.pagesDone + 1, chunkProgress.pagesTotal)} из ${chunkProgress.pagesTotal} · найдено ${chunkProgress.tasksFound}`
                : 'Распознаём задачи…'}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {(() => {
              const pages = imageUpload.files.length + pdfQueue.length;
              return pages > CHUNK_IMAGES ? `Распознать все (${pages} стр.)` : 'Распознать задачи';
            })()}
          </>
        )}
      </button>
      {/* W4: живой прогресс-бар в процентах (фидбэк химиков — «идёт прогресс или нет»). */}
      {isExtracting && chunkProgress && chunkProgress.pagesTotal > 0 ? (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-socrat-primary transition-[width] duration-500"
              style={{
                width: `${Math.round((chunkProgress.pagesDone / chunkProgress.pagesTotal) * 100)}%`,
              }}
            />
          </div>
          <p className="text-center text-[11px] text-slate-400">
            {Math.round((chunkProgress.pagesDone / chunkProgress.pagesTotal) * 100)}% · распознаём по {CHUNK_IMAGES} страницы — так AI находит все задачи
          </p>
        </div>
      ) : null}
      {!canExtract && !isExtracting ? (
        <p className="text-center text-xs text-slate-400">
          {!isHw && folderId === ''
            ? 'Выберите папку для сохранения, чтобы продолжить'
            : 'Добавьте текст задач или хотя бы одно фото'}
        </p>
      ) : null}
    </div>
  );
}
