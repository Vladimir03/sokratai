import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Loader2, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { InputStage } from '@/components/kb/AiTaskLoader/InputStage';
import { DraftCard } from '@/components/kb/AiTaskLoader/DraftCard';
import { DraftTable } from '@/components/kb/AiTaskLoader/DraftTable';
import { BulkActionsBar } from '@/components/kb/AiTaskLoader/BulkActionsBar';
import type {
  AiLoaderCommitItem,
  AiLoaderDestination,
  AiLoaderGuardState,
  BatchClassification,
  CropState,
  ExtractCompleteness,
  ReviewOverrides,
  RowStatus,
} from '@/components/kb/AiTaskLoader/reviewTypes';
import { useCreateTasksBulk, useTopics } from '@/hooks/useKnowledgeBase';
import { resolveCheckFormatFromKb } from '@/lib/checkFormatHelpers';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
import { cropImageToFile } from '@/lib/cropImage';
import { deleteKBTaskImage, getKBImageSignedUrl, serializeAttachmentUrls, uploadKBTaskImage } from '@/lib/kbApi';
import { supabase } from '@/lib/supabaseClient';
import { trackKbAiLoaderEvent } from '@/lib/kbAiLoaderTelemetry';
import { refineDraft, type ExtractStats, type ExtractedTask } from '@/lib/kbAiExtractApi';
import { DEFAULT_KB_SUBJECT, type CreateKBTaskInput, type ExamType, type KBSubtopic } from '@/types/kb';
import { pluralizeRu } from '@/lib/pluralizeRu';
import { cn } from '@/lib/utils';

/**
 * Оркестрация AI-загрузчика задач: input → extract → ревью → commit.
 *
 * Фаза 1 «один загрузчик — N назначений» (2026-07-20): вынесено из
 * AiTaskLoaderPage в shared-компонент с `destination`-адаптером:
 * - `kb_folder` — прежний путь Базы (bulk insertTask, навигация в папку);
 * - `hw_draft`  — конструктор ДЗ: выбранные задачи после кроп-пайплайна
 *   возвращаются `onCommit`-колбэком (запись в БД — существующим path A;
 *   Базу наполняет авто-зеркало «Из ДЗ» на сохранении ДЗ, rule 40).
 * KB-путь байт-в-байт прежний; внешние ветки помечены `isExternal`.
 */

/**
 * Применить патч к override с реконсиляцией при СМЕНЕ ЭКЗАМЕНА (ревью
 * ChatGPT-5.6 P1): ЕГЭ/ОГЭ-темы дублируются по именам, поэтому при exam-change
 * (а) сбрасываем балл (пере-выведется по авто-КИМ нового экзамена, если тутор
 * не задал явный), (б) сбрасываем тему/подтему, если тема принадлежит ДРУГОМУ
 * экзамену. Единая точка для карточки/строки/bulk — консистентно.
 */
function applyOverridePatch(
  o: ReviewOverrides,
  patch: Partial<ReviewOverrides>,
  topicExamById: Map<string, ExamType | null>,
): ReviewOverrides {
  const next = { ...o, ...patch };
  if (patch.exam !== undefined) {
    if (patch.primaryScore === undefined) next.primaryScore = '';
    const topicExam = next.topicId ? topicExamById.get(next.topicId) ?? null : null;
    if (topicExam && topicExam !== (next.exam || null)) {
      next.topicId = null;
      next.subtopicId = null;
    }
  }
  return next;
}

type Stage = 'input' | 'review';
type ReviewView = 'table' | 'cards';

const VIEW_STORAGE_KEY = 'sokrat-kb-ai-loader-view';

/** Desktop → таблица (лидеры грузят 10–30 задач), mobile → карточки. */
function initReviewView(): ReviewView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === 'table' || stored === 'cards') return stored;
  } catch {
    /* localStorage unavailable */
  }
  return typeof window !== 'undefined' && window.innerWidth >= 768 ? 'table' : 'cards';
}

/** Build a CreateKBTaskInput from a draft + резолвнутые overrides ревью (волна 2). */
function draftToCreateInput(
  draft: ExtractedTask,
  folderId: string,
  ov: ReviewOverrides,
  subject: string,
  /** undefined = attachment из черновика; string|null = явная замена (кроп / без картинки). */
  attachmentRefOverride: string | null | undefined,
): CreateKBTaskInput {
  const answer = draft.answer?.trim();
  const sourceLabel = ov.sourceLabel.trim();
  const attachmentRef =
    attachmentRefOverride !== undefined ? attachmentRefOverride : draft.attachment_ref;
  const attachmentUrl = attachmentRef
    ? serializeAttachmentUrls([attachmentRef]) ?? undefined
    : undefined;
  const exam = ov.exam || null;
  const kimNum = ov.kimNumber.trim() ? parseInt(ov.kimNumber.trim(), 10) : null;
  // P1-4: persist the grading mode so the task grades by the ФИПИ rubric on ДЗ
  // import. № КИМ-эвристика — только физика (review P2 2026-07-06).
  const checkFormat = resolveCheckFormatFromKb({
    check_format: draft.check_format,
    answer_format: draft.answer_format,
    kim_number: kimNum,
    subject,
  });
  // Балл (порядок — ревью ChatGPT-5.6 P1): явный override тутора → авто по
  // ТЕКУЩЕМУ № КИМ → извлечённый AI (последний фолбэк). Авто-балл ДОЛЖЕН
  // побеждать draft.primary_score, иначе после смены КИМ сохранялся старый балл
  // (визуально 3, в БД 1). AI-балл уже сидируется в override → нетронутые задачи
  // берут его через manualScore; draft.primary_score нужен лишь не-физике без карты.
  const manualScore = ov.primaryScore.trim() ? parseInt(ov.primaryScore.trim(), 10) : null;
  const primaryScore =
    manualScore ?? getKimPrimaryScoreForSubject(subject, exam, kimNum) ?? draft.primary_score;
  return {
    folder_id: folderId,
    text: draft.text,
    ...(answer ? { answer } : {}),
    ...(draft.solution?.trim() ? { solution: draft.solution } : {}),
    ...(draft.answer_format ? { answer_format: draft.answer_format } : {}),
    check_format: checkFormat,
    ...(kimNum !== null && !Number.isNaN(kimNum) ? { kim_number: kimNum } : {}),
    ...(exam ? { exam } : {}),
    ...(primaryScore !== null && !Number.isNaN(primaryScore) ? { primary_score: primaryScore } : {}),
    ...(draft.rubric_text?.trim() ? { rubric_text: draft.rubric_text } : {}),
    ...(ov.topicId ? { topic_id: ov.topicId } : {}),
    ...(ov.subtopicId ? { subtopic_id: ov.subtopicId } : {}),
    ...(attachmentUrl ? { attachment_url: attachmentUrl } : {}),
    // source_label: omit → insertTask defaults to 'my'.
    ...(sourceLabel ? { source_label: sourceLabel } : {}),
  };
}

export interface AiTaskLoaderFlowProps {
  destination: AiLoaderDestination;
  /** Гард закрытия Sheet-хоста (hw-режим): busy / есть-что-терять. */
  onGuardStateChange?: (state: AiLoaderGuardState) => void;
}

export function AiTaskLoaderFlow({ destination, onGuardStateChange }: AiTaskLoaderFlowProps) {
  const navigate = useNavigate();
  // «Внешнее» назначение (hw_draft | mock_variant): commit уходит колбэком,
  // KB-таксономия скрыта, предмет форсится, дубли default-выбраны.
  const isExternal = destination.kind !== 'kb_folder';

  const { topics } = useTopics();
  const createTasksBulk = useCreateTasksBulk();

  const [stage, setStage] = useState<Stage>('input');
  const [drafts, setDrafts] = useState<ExtractedTask[]>([]);
  const [overrides, setOverrides] = useState<ReviewOverrides[]>([]);
  const [crops, setCrops] = useState<Array<CropState | null>>([]);
  const [rowStatus, setRowStatus] = useState<RowStatus[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  // Мягкое скрытие «удалённых» черновиков (запрос Милады 2026-07-13): НЕ вырезаем
  // из массивов — индексы должны быть стабильны (cropUploadCacheRef по абсолютному
  // индексу, source_image_index → uploadedRefs по абсолютному индексу). removed[i]
  // прячет строку из вида и исключает из commit; undo = снять флаг.
  const [removed, setRemoved] = useState<boolean[]>([]);
  const [uploadedRefs, setUploadedRefs] = useState<string[]>([]);
  /** W4: честность о полноте — «Найдено 68 из ~73» + недобранные страницы. */
  const [completeness, setCompleteness] = useState<ExtractCompleteness | null>(null);
  const [folderId, setFolderId] = useState(
    destination.kind === 'kb_folder' ? destination.initialFolderId : '',
  );
  const [subject, setSubject] = useState<string>(
    destination.kind === 'kb_folder' ? DEFAULT_KB_SUBJECT : destination.subject,
  );
  const [isSaving, setIsSaving] = useState(false);
  /** hw-режим: extract идёт внутри InputStage — сигнал для гарда закрытия Sheet. */
  const [inputBusy, setInputBusy] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [refiningIndex, setRefiningIndex] = useState<number | null>(null);
  const [view, setView] = useState<ReviewView>(() => initReviewView());
  // Кэш кроп-аплоадов между ретраями commit'а: index → загруженный ref (или null
  // при сбое кропа). Инвалидируется при смене рамки/картинки и на новом extract.
  const cropUploadCacheRef = useRef(new Map<number, string | null>());
  // Аккумулятор attachment сохранённых строк по ВСЕЙ пачке (между ретраями):
  // orphan-cleanup после ретрая не должен удалять оригинал строки, сохранённой
  // в 1-й попытке (ревью ChatGPT-5.6 P2). Очищается на новом extract.
  const savedAttachmentRefsRef = useRef(new Set<string>());

  // Гард закрытия Sheet-хоста: во время extract/commit закрытие блокируется,
  // в ревью — confirm (черновики будут потеряны).
  useEffect(() => {
    onGuardStateChange?.({ busy: inputBusy || isSaving, hasDrafts: stage === 'review' });
  }, [inputBusy, isSaving, stage, onGuardStateChange]);

  const subjectTopics = useMemo(
    () => topics.filter((t) => t.subject === subject),
    [topics, subject],
  );
  // topicId → exam (для реконсиляции темы при смене экзамена, P1).
  const topicExamById = useMemo(() => {
    const m = new Map<string, ExamType | null>();
    for (const t of topics) m.set(t.id, t.exam);
    return m;
  }, [topics]);

  const setViewPersist = useCallback((next: ReviewView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const handleExtracted = useCallback(
    (
      newDrafts: ExtractedTask[],
      newStats: ExtractStats,
      chosenFolderId: string,
      chosenSubject: string,
      newUploadedRefs: string[],
      newCompleteness: ExtractCompleteness,
      defaultClassification: BatchClassification,
    ) => {
      // Ф0 (волна 2): пре-резолв темы ПРИ ВХОДЕ в ревью — тутор сразу видит,
      // сматчилась ли тема (раньше — невидимый сюрприз на коммите). ЕГЭ/ОГЭ-темы
      // дублируются по именам → матчим с учётом exam черновика; неоднозначность
      // (несколько одноимённых, exam не различает) → null (ревью P1).
      // hw-режим: таксономия скрыта из UI, но пре-резолв ОСТАВЛЕН — топик/подтема
      // уезжают в зеркало «Из ДЗ» (База наполняется классифицированной).
      const resolveTopicId = (suggestion: string, exam: ExamType | null): string | null => {
        const s = suggestion.trim().toLowerCase();
        if (!s) return null;
        const named = topics.filter(
          (t) => t.subject === chosenSubject && t.name.trim().toLowerCase() === s,
        );
        if (named.length === 0) return null;
        if (exam) {
          const byExam = named.filter((t) => t.exam === exam);
          if (byExam.length === 1) return byExam[0].id;
          if (byExam.length > 1) return null;
        }
        return named.length === 1 ? named[0].id : null;
      };
      // ВОЛНА 5: явный batch-дефолт (тема/тип, заданные ДО распознавания в
      // InputStage) ПОБЕЖДАЕТ per-task подсказку AI — тутор задал тему, применяем
      // ко всем; переопределение по одной остаётся в ревью. Пусто (hw/mock / не
      // задано) → прежний AI-резолв (поведение байт-в-байт).
      const batchExam: ExamType | null = defaultClassification.exam || null;
      // Явная batch-тема несёт СВОЙ exam — он побеждает AI d.exam (для поля exam И
      // для скоупа резолва), иначе Тип=«Не указан» + тема ОГЭ + AI-ЕГЭ = тихий
      // mismatch topic_id↔exam (ревью 5.6 P1). `topics` — уже dep этого useCallback.
      const batchTopicExam: ExamType | null = defaultClassification.topicId
        ? topics.find((t) => t.id === defaultClassification.topicId)?.exam ?? null
        : null;
      const initialOverrides: ReviewOverrides[] = newDrafts.map((d) => {
        const effExam: ExamType | null = batchExam ?? batchTopicExam ?? d.exam;
        return {
          topicId: defaultClassification.topicId || resolveTopicId(d.topic_suggestion, effExam),
          subtopicId: defaultClassification.subtopicId || null,
          sourceLabel: d.source_label.trim(),
          exam: defaultClassification.exam || batchTopicExam || d.exam || '',
          kimNumber: d.kim_number !== null ? String(d.kim_number) : '',
          primaryScore: d.primary_score !== null ? String(d.primary_score) : '',
        };
      });

      setDrafts(newDrafts);
      setOverrides(initialOverrides);
      setCrops(
        newDrafts.map((d) =>
          d.attachment_ref && d.image_bbox ? { bbox: d.image_bbox, status: 'suggested' } : null,
        ),
      );
      setRowStatus(newDrafts.map(() => 'idle'));
      // Default-deselect drafts that look like duplicates (edge fingerprint_match).
      // Внешние назначения: дубли ВЫБРАНЫ — «уже есть в Базе» не мешает добавить
      // в ДЗ/пробник (для ДЗ авто-зеркало прилинкует существующую по fingerprint).
      setSelected(newDrafts.map((d) => (isExternal ? true : d.fingerprint_match === null)));
      setRemoved(newDrafts.map(() => false));
      setUploadedRefs(newUploadedRefs);
      setCompleteness(newCompleteness);
      setFolderId(chosenFolderId);
      setSubject(chosenSubject);
      setExpandedIndex(null);
      cropUploadCacheRef.current.clear();
      savedAttachmentRefsRef.current.clear();
      setStage('review');

      // Подтемы сматченных тем — один bulk-запрос, дорезолв exact-name match.
      const matchedTopicIds = [
        ...new Set(initialOverrides.map((o) => o.topicId).filter((id): id is string => id !== null)),
      ];
      if (matchedTopicIds.length > 0) {
        void supabase
          .from('kb_subtopics')
          .select('id, topic_id, name')
          .in('topic_id', matchedTopicIds)
          .then(({ data }) => {
            const rows = (data ?? []) as KBSubtopic[];
            if (rows.length === 0) return;
            setOverrides((prev) =>
              prev.map((ov, i) => {
                if (!ov.topicId || ov.subtopicId) return ov;
                const s = newDrafts[i]?.subtopic_suggestion.trim().toLowerCase();
                if (!s) return ov;
                const match = rows.find(
                  (st) => st.topic_id === ov.topicId && st.name.trim().toLowerCase() === s,
                );
                return match ? { ...ov, subtopicId: match.id } : ov;
              }),
            );
          });
      }
    },
    [topics, isExternal],
  );

  const updateDraft = useCallback((index: number, patch: Partial<ExtractedTask>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }, []);

  const updateOverride = useCallback(
    (index: number, patch: Partial<ReviewOverrides>) => {
      setOverrides((prev) =>
        prev.map((o, i) => (i === index ? applyOverridePatch(o, patch, topicExamById) : o)),
      );
    },
    [topicExamById],
  );

  const updateCrop = useCallback((index: number, crop: CropState | null) => {
    setCrops((prev) => prev.map((c, i) => (i === index ? crop : c)));
    cropUploadCacheRef.current.delete(index); // рамка изменилась → перекроп на commit
    if (crop?.status === 'edited') trackKbAiLoaderEvent('kb_ai_crop_action', { action: 'edited' });
    else if (crop?.status === 'full') trackKbAiLoaderEvent('kb_ai_crop_action', { action: 'full' });
    else if (crop === null) trackKbAiLoaderEvent('kb_ai_crop_action', { action: 'removed' });
  }, []);

  const toggleSelect = useCallback((index: number) => {
    setSelected((prev) => prev.map((s, i) => (i === index ? !s : s)));
  }, []);

  const toggleExpand = useCallback((index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  // Удалить черновик из списка (мягко) + тост «Вернуть» (запрос Милады). Сохранённую
  // строку не трогаем (она уже в БД — «удаление» из вида ввело бы в заблуждение).
  const removeDraft = useCallback(
    (index: number) => {
      if (rowStatus[index] === 'saved') return;
      setRemoved((prev) => prev.map((r, i) => (i === index ? true : r)));
      setExpandedIndex((prev) => (prev === index ? null : prev));
      toast('Задача убрана из списка', {
        action: {
          label: 'Вернуть',
          onClick: () => setRemoved((prev) => prev.map((r, i) => (i === index ? false : r))),
        },
        duration: 6000,
      });
    },
    [rowStatus],
  );

  const selectedCount = useMemo(
    () => selected.filter((s, i) => s && !removed[i] && rowStatus[i] !== 'saved').length,
    [selected, removed, rowStatus],
  );
  // Ревью 2026-07-16 P1: удалённые (removed) строки исключаются из ВСЕХ
  // счётчиков — иначе удалённая failed-строка держала «Повторить неудачные»,
  // а bulk-бар показывал «из 8» после удаления.
  const failedCount = useMemo(
    () => rowStatus.filter((s, i) => s === 'failed' && !removed[i]).length,
    [rowStatus, removed],
  );
  const dupCount = useMemo(
    () => drafts.filter((d, i) => d.fingerprint_match !== null && selected[i] && !removed[i]).length,
    [drafts, selected, removed],
  );
  // Видимые (не удалённые) черновики — для заголовка «Найдено задач».
  const visibleCount = useMemo(() => removed.filter((r) => !r).length, [removed]);
  // Кандидаты на выбор (видимые несохранённые) — total для bulk-бара и
  // «Выбрать все». «Без ответа» — live по видимым (правки ответов уменьшают).
  const eligibleCount = useMemo(
    () => drafts.filter((_, i) => !removed[i] && rowStatus[i] !== 'saved').length,
    [drafts, removed, rowStatus],
  );
  const lowConfCount = useMemo(
    () =>
      drafts.filter(
        (d, i) => !removed[i] && rowStatus[i] !== 'saved' && (!d.answer || d.answer.trim() === ''),
      ).length,
    [drafts, removed, rowStatus],
  );

  // Массовые действия (BulkActionsBar).
  const applyBulk = useCallback(
    (patch: Partial<ReviewOverrides>) => {
      setOverrides((prev) =>
        prev.map((ov, i) =>
          selected[i] && !removed[i] && rowStatus[i] !== 'saved'
            ? applyOverridePatch(ov, patch, topicExamById)
            : ov,
        ),
      );
    },
    [selected, removed, rowStatus, topicExamById],
  );
  const selectAll = useCallback(
    () => setSelected((prev) => prev.map((_, i) => rowStatus[i] !== 'saved' && !removed[i])),
    [rowStatus, removed],
  );
  const deselectAll = useCallback(() => setSelected((prev) => prev.map(() => false)), []);
  const deselectDups = useCallback(
    () => setSelected((prev) => prev.map((s, i) => (drafts[i]?.fingerprint_match ? false : s))),
    [drafts],
  );

  // ── Refine (#45а полная часть): перегонка ОДНОГО черновика с комментарием ──
  const handleRefine = useCallback(
    async (index: number, comment: string) => {
      if (refiningIndex !== null) return; // rate-guard: один refine за раз
      setRefiningIndex(index);
      try {
        const d = drafts[index];
        const ctxRefs: string[] = [];
        if (d.attachment_ref) ctxRefs.push(d.attachment_ref);
        // source_image_index уже нормализован InputStage в глобальную систему
        // координат uploadedRefs (W3.1 чанкинг): ненадёжные индексы (сбои инлайна
        // внутри чанка) обнулены там же — здесь просто резолвим.
        if (
          d.source_image_index !== null &&
          uploadedRefs[d.source_image_index] &&
          !ctxRefs.includes(uploadedRefs[d.source_image_index])
        ) {
          ctxRefs.push(uploadedRefs[d.source_image_index]);
        }
        const refined = await refineDraft({
          folder_id: folderId,
          subject,
          comment,
          draft: d,
          image_refs: ctxRefs.slice(0, 2),
        });
        // Мерж ТОЛЬКО контент-полей — классификацию тутора (overrides) не затираем.
        updateDraft(index, {
          text: refined.text,
          answer: refined.answer,
          answer_confidence: refined.answer_confidence,
          solution: refined.solution,
          rubric_text: refined.rubric_text,
          needs_review_fields: refined.needs_review_fields,
          notes: refined.notes,
          fingerprint_match: refined.fingerprint_match,
        });
        trackKbAiLoaderEvent('kb_ai_draft_refined', { folderId });
        toast.success('Черновик обновлён по комментарию');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Не удалось перегенерировать задачу.');
      } finally {
        setRefiningIndex(null);
      }
    },
    [drafts, folderId, subject, uploadedRefs, refiningIndex, updateDraft],
  );

  // ── Commit: кроп (лениво) → адаптер назначения → per-row статусы (KB) ──
  const handleCommit = useCallback(async () => {
    if (selectedCount === 0 || isSaving) return;
    const chosen = drafts
      .map((draft, index) => ({ draft, index }))
      .filter(({ index }) => selected[index] && !removed[index] && rowStatus[index] !== 'saved');

    setIsSaving(true);
    try {
      // Кроп-он-коммит: только выбранные черновики порождают блобы.
      let croppedCount = 0;
      let cropFailedCount = 0;
      const attachmentOverrideByIndex = new Map<number, string | null>();
      for (const { draft, index } of chosen) {
        const crop = crops[index];
        if (!draft.attachment_ref || !crop || crop.status === 'full' || !crop.bbox) continue;
        // Ретрай после частичного сбоя: кроп уже загружен → переиспользуем ref.
        const cached = cropUploadCacheRef.current.get(index);
        if (cached !== undefined) {
          attachmentOverrideByIndex.set(index, cached);
          if (cached !== null) croppedCount += 1;
          else cropFailedCount += 1;
          continue;
        }
        try {
          const signedUrl = await getKBImageSignedUrl(draft.attachment_ref);
          if (!signedUrl) throw new Error('no signed url');
          const file = await cropImageToFile(signedUrl, crop.bbox, `crop-${index + 1}.jpg`);
          const res = await uploadKBTaskImage(file);
          attachmentOverrideByIndex.set(index, res.storageRef);
          cropUploadCacheRef.current.set(index, res.storageRef);
          croppedCount += 1;
        } catch {
          // Решение владельца: сбой кропа → задача сохраняется БЕЗ картинки
          // (мультизадачный скрин целиком НЕ прикрепляем молча).
          attachmentOverrideByIndex.set(index, null);
          cropUploadCacheRef.current.set(index, null);
          cropFailedCount += 1;
        }
      }

      // ── Внешние назначения (hw_draft | mock_variant): задачи уходят колбэком
      // в конструктор (БЕЗ записи в БД — сохранение идёт существующим write-path
      // соответствующего конструктора; никаких новых write-path, rule 40).
      if (destination.kind !== 'kb_folder') {
        const items: AiLoaderCommitItem[] = chosen.map(({ draft, index }) => {
          const overrideRef = attachmentOverrideByIndex.get(index);
          return {
            draft,
            override: overrides[index],
            attachmentRef: overrideRef !== undefined ? overrideRef : draft.attachment_ref,
          };
        });
        // Orphan-cleanup: залитые исходники, не ставшие финальным attachment ни
        // одной добавляемой задачи (кропы заменили оригиналы; де-селект/удаление).
        const usedRefs = new Set(
          items.map((it) => it.attachmentRef).filter((r): r is string => r !== null),
        );
        for (const ref of uploadedRefs) {
          if (!usedRefs.has(ref)) void deleteKBTaskImage(ref);
        }
        const commitPayload = {
          count: items.length,
          noAnswer: items.filter((it) => !it.draft.answer || it.draft.answer.trim() === '').length,
          cropped: croppedCount,
          cropFailed: cropFailedCount,
        };
        if (destination.kind === 'mock_variant') {
          trackKbAiLoaderEvent('kb_ai_tasks_added_to_mock', commitPayload);
        } else {
          trackKbAiLoaderEvent('kb_ai_tasks_added_to_hw', commitPayload);
        }
        destination.onCommit(items);
        return; // Sheet закрывает адаптер — сюда Flow больше не рендерится.
      }

      const items = chosen.map(({ draft, index }) => ({
        key: index,
        input: draftToCreateInput(
          draft,
          folderId,
          overrides[index],
          subject,
          attachmentOverrideByIndex.get(index),
        ),
      }));

      const results = await createTasksBulk.mutateAsync(items);
      const okKeys = new Set(results.filter((r) => r.ok).map((r) => r.key));
      const saved = okKeys.size;
      const failed = results.length - saved;

      // Аккумулируем attachment УСПЕШНО сохранённых строк по всей пачке (между
      // ретраями) — иначе orphan-cleanup после ретрая удалил бы оригинал строки,
      // сохранённой в 1-й попытке (ревью P2; сейчас спасал только DB-триггер).
      for (const it of items) {
        if (okKeys.has(it.key) && typeof it.input.attachment_url === 'string') {
          savedAttachmentRefsRef.current.add(it.input.attachment_url);
        }
      }

      setRowStatus((prev) =>
        prev.map((s, i) => {
          if (okKeys.has(i)) return 'saved';
          if (chosen.some((c) => c.index === i)) return 'failed';
          return s;
        }),
      );

      const skippedDup = drafts.filter(
        (d, i) => !selected[i] && !removed[i] && d.fingerprint_match !== null,
      ).length;
      trackKbAiLoaderEvent('kb_ai_tasks_saved', {
        folderId,
        saved,
        skipped: skippedDup,
        failed,
        cropped: croppedCount,
        cropFailed: cropFailedCount,
      });

      if (failed > 0) {
        // Остаёмся на странице: неудачные строки помечены, CTA → «Повторить».
        toast.error(`Сохранено ${saved}, с ошибкой ${failed}. Нажмите «Повторить неудачные».`);
        return;
      }

      if (saved > 0) {
        // Orphan-cleanup: исходники, не попавшие ни в один сохранённый attachment
        // по ВСЕЙ пачке (аккумулятор, не только текущий ретрай) — кропнутые копии
        // заменили оригиналы мультизадачных скринов.
        for (const ref of uploadedRefs) {
          const serialized = serializeAttachmentUrls([ref]);
          if (serialized && !savedAttachmentRefsRef.current.has(serialized)) {
            void deleteKBTaskImage(ref);
          }
        }

        const parts = [`Добавлено ${saved}`];
        if (skippedDup > 0) parts.push(`${skippedDup} дубл. пропущено`);
        if (cropFailedCount > 0) parts.push(`${cropFailedCount} без рисунка (сбой обрезки)`);
        toast.success(parts.join(' · '));
        navigate(folderId ? `/tutor/knowledge/folder/${folderId}` : '/tutor/knowledge?tab=mybase');
      } else {
        toast.error('Не удалось сохранить задачи. Попробуйте ещё раз.');
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    drafts,
    overrides,
    crops,
    selected,
    removed,
    rowStatus,
    selectedCount,
    folderId,
    subject,
    isSaving,
    uploadedRefs,
    createTasksBulk,
    navigate,
    destination,
  ]);

  const renderDraftCard = useCallback(
    (index: number, hideSelect: boolean) => (
      <DraftCard
        key={index}
        index={index}
        draft={drafts[index]}
        selected={selected[index] ?? false}
        subject={subject}
        onToggleSelect={toggleSelect}
        onChange={updateDraft}
        disabled={isSaving}
        override={overrides[index]}
        onOverrideChange={updateOverride}
        topics={subjectTopics}
        crop={crops[index] ?? null}
        onCropChange={updateCrop}
        onRefine={handleRefine}
        refining={refiningIndex === index}
        hideSelect={hideSelect}
        showTaxonomy={!isExternal}
        // Ревью P2: сохранённой строке (уже в БД) «Удалить» не показываем.
        onRemove={rowStatus[index] === 'saved' ? undefined : removeDraft}
      />
    ),
    [
      drafts,
      selected,
      subject,
      toggleSelect,
      updateDraft,
      isSaving,
      overrides,
      updateOverride,
      subjectTopics,
      crops,
      updateCrop,
      handleRefine,
      refiningIndex,
      rowStatus,
      removeDraft,
      isExternal,
    ],
  );

  const externalTargetLabel = destination.kind === 'mock_variant' ? 'в пробник' : 'в ДЗ';
  const commitLabel = isExternal
    ? isSaving
      ? 'Добавляем…'
      : selectedCount > 0
        ? `Добавить ${selectedCount} ${pluralizeRu(selectedCount, ['задачу', 'задачи', 'задач'])} ${externalTargetLabel}`
        : `Добавить задачи ${externalTargetLabel}`
    : isSaving
      ? 'Сохраняем…'
      : failedCount > 0
        ? `Повторить неудачные (${selectedCount})`
        : selectedCount > 0
          ? `Сохранить ${selectedCount} ${pluralizeRu(selectedCount, ['задачу', 'задачи', 'задач'])}`
          : 'Сохранить задачи';

  if (stage === 'input') {
    return destination.kind !== 'kb_folder' ? (
      <InputStage
        initialFolderId=""
        fixedSubject={destination.subject}
        resolveFolderIdLazy={destination.resolveFolderId}
        onExtractingChange={setInputBusy}
        telemetryDestination={destination.kind === 'mock_variant' ? 'mock' : 'hw'}
        onExtracted={handleExtracted}
      />
    ) : (
      <InputStage initialFolderId={folderId} onExtracted={handleExtracted} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700">
          Найдено задач: {visibleCount}
          {/* W4: ожидание по текстовому слою PDF — показываем, только если оно
              не меньше найденного (недооценка счётчика выглядела бы нелепо). */}
          {completeness?.expectedTotal != null && completeness.expectedTotal >= drafts.length ? (
            <span className="font-normal text-slate-500"> из ~{completeness.expectedTotal}</span>
          ) : null}
          {lowConfCount > 0 ? (
            <span className="ml-2 font-normal text-amber-700">
              · {lowConfCount} без ответа
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-3">
          {/* Тумблер вида: таблица (desktop-default) / карточки */}
          <div
            role="group"
            aria-label="Вид ревью"
            className="hidden items-center overflow-hidden rounded-lg border border-socrat-border md:flex"
          >
            <button
              type="button"
              aria-pressed={view === 'table'}
              onClick={() => setViewPersist('table')}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-colors [touch-action:manipulation]',
                view === 'table' ? 'bg-socrat-primary text-white' : 'bg-white text-slate-500 hover:text-socrat-primary',
              )}
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
              Таблица
            </button>
            <button
              type="button"
              aria-pressed={view === 'cards'}
              onClick={() => setViewPersist('cards')}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-colors [touch-action:manipulation]',
                view === 'cards' ? 'bg-socrat-primary text-white' : 'bg-white text-slate-500 hover:text-socrat-primary',
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              Карточки
            </button>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => setStage('input')}
            className="text-xs font-semibold text-socrat-primary transition-colors hover:text-socrat-primary-dark disabled:opacity-50"
          >
            ← Загрузить другой материал
          </button>
        </div>
      </div>

      {/* W4: недобранные страницы (после авто-повтора) — честное предупреждение. */}
      {completeness && completeness.shortfalls.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {completeness.shortfalls
            .map((s) => `со ${s.pages} распознано ${s.got} из ~${s.expected}`)
            .join('; ')}
          {' '}— проверьте эти страницы и при необходимости загрузите их отдельным заходом.
        </div>
      ) : null}

      <BulkActionsBar
        selectedCount={selectedCount}
        totalCount={eligibleCount}
        dupCount={dupCount}
        disabled={isSaving}
        topics={subjectTopics}
        onApply={applyBulk}
        onSelectAll={selectAll}
        onDeselectAll={deselectAll}
        onDeselectDups={deselectDups}
        showTaxonomy={!isExternal}
      />

      {view === 'table' ? (
        <div className="hidden md:block">
          <DraftTable
            drafts={drafts}
            overrides={overrides}
            crops={crops}
            rowStatus={rowStatus}
            selected={selected}
            removed={removed}
            subject={subject}
            topics={subjectTopics}
            disabled={isSaving}
            expandedIndex={expandedIndex}
            onToggleSelect={toggleSelect}
            onToggleExpand={toggleExpand}
            onRemove={removeDraft}
            onChangeDraft={updateDraft}
            onChangeOverride={updateOverride}
            renderExpanded={(i) => renderDraftCard(i, true)}
            showTopicColumn={!isExternal}
          />
        </div>
      ) : null}

      {/* Карточки: mobile всегда; desktop — когда выбран режим «Карточки».
          Удалённые (removed) черновики скрыты. */}
      <div className={cn('space-y-3', view === 'table' && 'md:hidden')}>
        {drafts.map((_, index) => (removed[index] ? null : renderDraftCard(index, false)))}
      </div>

      {/* Primary CTA */}
      <div className="sticky bottom-0 -mx-1 border-t border-socrat-border bg-white/95 px-1 py-3 backdrop-blur">
        <button
          type="button"
          disabled={selectedCount === 0 || isSaving}
          onClick={handleCommit}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-xl bg-socrat-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-socrat-primary-dark [touch-action:manipulation]',
            (selectedCount === 0 || isSaving) && 'cursor-not-allowed opacity-50',
          )}
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {commitLabel}
        </button>
      </div>
    </div>
  );
}
