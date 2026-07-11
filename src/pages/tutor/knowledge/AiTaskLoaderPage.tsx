import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LayoutGrid, Loader2, Sparkles, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { InputStage } from '@/components/kb/AiTaskLoader/InputStage';
import { DraftCard } from '@/components/kb/AiTaskLoader/DraftCard';
import { DraftTable } from '@/components/kb/AiTaskLoader/DraftTable';
import { BulkActionsBar } from '@/components/kb/AiTaskLoader/BulkActionsBar';
import type { CropState, ReviewOverrides, RowStatus } from '@/components/kb/AiTaskLoader/reviewTypes';
import { useCreateTasksBulk, useTopics } from '@/hooks/useKnowledgeBase';
import { resolveCheckFormatFromKb } from '@/lib/checkFormatHelpers';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
import { cropImageToFile } from '@/lib/cropImage';
import { deleteKBTaskImage, getKBImageSignedUrl, serializeAttachmentUrls, uploadKBTaskImage } from '@/lib/kbApi';
import { supabase } from '@/lib/supabaseClient';
import { trackKbAiLoaderEvent } from '@/lib/kbAiLoaderTelemetry';
import { refineDraft, type ExtractStats, type ExtractedTask } from '@/lib/kbAiExtractApi';
import { DEFAULT_KB_SUBJECT, type CreateKBTaskInput, type KBSubtopic } from '@/types/kb';
import { pluralizeRu } from '@/lib/pluralizeRu';
import { cn } from '@/lib/utils';

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
  // Балл: явный override тутора → извлечённый AI → авто по КИМ (только физика).
  const manualScore = ov.primaryScore.trim() ? parseInt(ov.primaryScore.trim(), 10) : null;
  const primaryScore =
    manualScore ?? draft.primary_score ?? getKimPrimaryScoreForSubject(subject, exam, kimNum);
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

function AiTaskLoaderContent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialFolderId = searchParams.get('folder') ?? '';

  const { topics } = useTopics();
  const createTasksBulk = useCreateTasksBulk();

  const [stage, setStage] = useState<Stage>('input');
  const [drafts, setDrafts] = useState<ExtractedTask[]>([]);
  const [overrides, setOverrides] = useState<ReviewOverrides[]>([]);
  const [crops, setCrops] = useState<Array<CropState | null>>([]);
  const [rowStatus, setRowStatus] = useState<RowStatus[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [uploadedRefs, setUploadedRefs] = useState<string[]>([]);
  const [stats, setStats] = useState<ExtractStats | null>(null);
  const [folderId, setFolderId] = useState(initialFolderId);
  const [subject, setSubject] = useState<string>(DEFAULT_KB_SUBJECT);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [refiningIndex, setRefiningIndex] = useState<number | null>(null);
  const [view, setView] = useState<ReviewView>(() => initReviewView());
  // Кэш кроп-аплоадов между ретраями commit'а: index → загруженный ref (или null
  // при сбое кропа). Инвалидируется при смене рамки/картинки и на новом extract.
  const cropUploadCacheRef = useRef(new Map<number, string | null>());

  const subjectTopics = useMemo(
    () => topics.filter((t) => t.subject === subject),
    [topics, subject],
  );

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
    ) => {
      // Ф0 (волна 2): пре-резолв темы ПРИ ВХОДЕ в ревью — тутор сразу видит,
      // сматчилась ли тема (раньше — невидимый сюрприз на коммите).
      const resolveTopicId = (suggestion: string): string | null => {
        const s = suggestion.trim().toLowerCase();
        if (!s) return null;
        const match = topics.find(
          (t) => t.subject === chosenSubject && t.name.trim().toLowerCase() === s,
        );
        return match?.id ?? null;
      };
      const initialOverrides: ReviewOverrides[] = newDrafts.map((d) => ({
        topicId: resolveTopicId(d.topic_suggestion),
        subtopicId: null,
        sourceLabel: d.source_label.trim(),
        exam: d.exam ?? '',
        kimNumber: d.kim_number !== null ? String(d.kim_number) : '',
        primaryScore: d.primary_score !== null ? String(d.primary_score) : '',
      }));

      setDrafts(newDrafts);
      setOverrides(initialOverrides);
      setCrops(
        newDrafts.map((d) =>
          d.attachment_ref && d.image_bbox ? { bbox: d.image_bbox, status: 'suggested' } : null,
        ),
      );
      setRowStatus(newDrafts.map(() => 'idle'));
      // Default-deselect drafts that look like duplicates (edge fingerprint_match).
      setSelected(newDrafts.map((d) => d.fingerprint_match === null));
      setUploadedRefs(newUploadedRefs);
      setStats(newStats);
      setFolderId(chosenFolderId);
      setSubject(chosenSubject);
      setExpandedIndex(null);
      cropUploadCacheRef.current.clear();
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
    [topics],
  );

  const updateDraft = useCallback((index: number, patch: Partial<ExtractedTask>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }, []);

  const updateOverride = useCallback((index: number, patch: Partial<ReviewOverrides>) => {
    setOverrides((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }, []);

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

  const selectedCount = useMemo(
    () => selected.filter((s, i) => s && rowStatus[i] !== 'saved').length,
    [selected, rowStatus],
  );
  const failedCount = useMemo(
    () => rowStatus.filter((s) => s === 'failed').length,
    [rowStatus],
  );
  const dupCount = useMemo(
    () => drafts.filter((d, i) => d.fingerprint_match !== null && selected[i]).length,
    [drafts, selected],
  );

  // Массовые действия (BulkActionsBar).
  const applyBulk = useCallback(
    (patch: Partial<ReviewOverrides>) => {
      setOverrides((prev) =>
        prev.map((ov, i) => (selected[i] && rowStatus[i] !== 'saved' ? { ...ov, ...patch } : ov)),
      );
    },
    [selected, rowStatus],
  );
  const selectAll = useCallback(
    () => setSelected((prev) => prev.map((_, i) => rowStatus[i] !== 'saved')),
    [rowStatus],
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
        // source_image_index надёжен только когда все изображения дошли до AI
        // (при сбоях инлайна индексы смещаются относительно uploadedRefs).
        if (
          d.source_image_index !== null &&
          (stats?.unreadable_images ?? 0) === 0 &&
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
    [drafts, folderId, subject, uploadedRefs, stats, refiningIndex, updateDraft],
  );

  // ── Commit: кроп (лениво) → bulk insertTask → per-row статусы ──
  const handleCommit = useCallback(async () => {
    if (selectedCount === 0 || isSaving) return;
    const chosen = drafts
      .map((draft, index) => ({ draft, index }))
      .filter(({ index }) => selected[index] && rowStatus[index] !== 'saved');

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

      setRowStatus((prev) =>
        prev.map((s, i) => {
          if (okKeys.has(i)) return 'saved';
          if (chosen.some((c) => c.index === i)) return 'failed';
          return s;
        }),
      );

      const skippedDup = drafts.filter((d, i) => !selected[i] && d.fingerprint_match !== null).length;
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
        // (кропнутые копии заменили оригиналы мультизадачных скринов).
        const usedRefs = new Set(
          items
            .map((it) => it.input.attachment_url)
            .filter((u): u is string => typeof u === 'string'),
        );
        for (const ref of uploadedRefs) {
          const serialized = serializeAttachmentUrls([ref]);
          if (serialized && !usedRefs.has(serialized)) void deleteKBTaskImage(ref);
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
    rowStatus,
    selectedCount,
    folderId,
    subject,
    isSaving,
    uploadedRefs,
    createTasksBulk,
    navigate,
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
    ],
  );

  const commitLabel = isSaving
    ? 'Сохраняем…'
    : failedCount > 0
      ? `Повторить неудачные (${selectedCount})`
      : selectedCount > 0
        ? `Сохранить ${selectedCount} ${pluralizeRu(selectedCount, ['задачу', 'задачи', 'задач'])}`
        : 'Сохранить задачи';

  return (
    <KnowledgeBaseFrame>
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => navigate('/tutor/knowledge?tab=mybase')}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-socrat-primary transition-colors duration-200 hover:text-socrat-primary-dark"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Моя база
        </button>

        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-socrat-primary-light text-socrat-primary">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-foreground">AI-загрузка задач</h1>
            <p className="text-xs text-slate-500">
              Вставьте текст или фото — AI разложит задачи по полям, вы проверите и сохраните.
            </p>
          </div>
        </div>

        {stage === 'input' ? (
          <InputStage initialFolderId={folderId} onExtracted={handleExtracted} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">
                Найдено задач: {drafts.length}
                {stats && stats.low_confidence_answers > 0 ? (
                  <span className="ml-2 font-normal text-amber-700">
                    · {stats.low_confidence_answers} без ответа
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

            <BulkActionsBar
              selectedCount={selectedCount}
              totalCount={drafts.length}
              dupCount={dupCount}
              disabled={isSaving}
              topics={subjectTopics}
              onApply={applyBulk}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              onDeselectDups={deselectDups}
            />

            {view === 'table' ? (
              <div className="hidden md:block">
                <DraftTable
                  drafts={drafts}
                  overrides={overrides}
                  crops={crops}
                  rowStatus={rowStatus}
                  selected={selected}
                  subject={subject}
                  topics={subjectTopics}
                  disabled={isSaving}
                  expandedIndex={expandedIndex}
                  onToggleSelect={toggleSelect}
                  onToggleExpand={toggleExpand}
                  onChangeDraft={updateDraft}
                  onChangeOverride={updateOverride}
                  renderExpanded={(i) => renderDraftCard(i, true)}
                />
              </div>
            ) : null}

            {/* Карточки: mobile всегда; desktop — когда выбран режим «Карточки». */}
            <div className={cn('space-y-3', view === 'table' && 'md:hidden')}>
              {drafts.map((_, index) => renderDraftCard(index, false))}
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
        )}
      </div>
    </KnowledgeBaseFrame>
  );
}

export default function AiTaskLoaderPage() {
  return <AiTaskLoaderContent />;
}
