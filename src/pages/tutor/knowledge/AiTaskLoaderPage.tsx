import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { InputStage } from '@/components/kb/AiTaskLoader/InputStage';
import { DraftCard } from '@/components/kb/AiTaskLoader/DraftCard';
import { useCreateTask, useTopics } from '@/hooks/useKnowledgeBase';
import { resolveCheckFormatFromKb } from '@/lib/checkFormatHelpers';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
import { serializeAttachmentUrls } from '@/lib/kbApi';
import { supabase } from '@/lib/supabaseClient';
import { trackKbAiLoaderEvent } from '@/lib/kbAiLoaderTelemetry';
import type { ExtractStats, ExtractedTask } from '@/lib/kbAiExtractApi';
import { DEFAULT_KB_SUBJECT, type CreateKBTaskInput, type KBSubtopic } from '@/types/kb';
import { cn } from '@/lib/utils';

type Stage = 'input' | 'review';

/** Build a CreateKBTaskInput from a draft + resolved topic/subtopic ids. */
function draftToCreateInput(
  draft: ExtractedTask,
  folderId: string,
  topicId: string | null,
  subtopicId: string | null,
  subject: string,
): CreateKBTaskInput {
  const answer = draft.answer?.trim();
  const sourceLabel = draft.source_label?.trim();
  const attachmentUrl = draft.attachment_ref
    ? serializeAttachmentUrls([draft.attachment_ref]) ?? undefined
    : undefined;
  // P1-4: persist the grading mode so the task grades by the ФИПИ rubric on ДЗ
  // import. AI usually returns check_format; fall back to answer_format / № КИМ.
  // № КИМ-эвристика — только физика (номера Части 2 предметно-специфичны, review P2).
  const checkFormat = resolveCheckFormatFromKb({
    check_format: draft.check_format,
    answer_format: draft.answer_format,
    kim_number: draft.kim_number,
    subject,
  });
  // P1-4: if AI didn't extract a score, fall back to the № КИМ score (ФИПИ) so a
  // Часть-2 task (КИМ 21-26) imports to ДЗ with the right max_score, not 1.
  // Only physics has ФИПИ maps → subject-aware (review P1); social → manual only.
  const primaryScore = draft.primary_score ?? getKimPrimaryScoreForSubject(subject, draft.exam, draft.kim_number);
  return {
    folder_id: folderId,
    text: draft.text,
    ...(answer ? { answer } : {}),
    ...(draft.solution ? { solution: draft.solution } : {}),
    ...(draft.answer_format ? { answer_format: draft.answer_format } : {}),
    check_format: checkFormat,
    ...(draft.kim_number !== null ? { kim_number: draft.kim_number } : {}),
    ...(draft.exam ? { exam: draft.exam } : {}),
    ...(primaryScore !== null ? { primary_score: primaryScore } : {}),
    ...(draft.rubric_text ? { rubric_text: draft.rubric_text } : {}),
    ...(topicId ? { topic_id: topicId } : {}),
    ...(subtopicId ? { subtopic_id: subtopicId } : {}),
    ...(attachmentUrl ? { attachment_url: attachmentUrl } : {}),
    // source_label: omit → insertTask defaults to 'my'.
    ...(sourceLabel ? { source_label: sourceLabel } : {}),
  };
}

function AiTaskLoaderContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialFolderId = searchParams.get('folder') ?? '';

  const { topics } = useTopics();
  const createTask = useCreateTask();

  const [stage, setStage] = useState<Stage>('input');
  const [drafts, setDrafts] = useState<ExtractedTask[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [stats, setStats] = useState<ExtractStats | null>(null);
  const [folderId, setFolderId] = useState(initialFolderId);
  const [subject, setSubject] = useState<string>(DEFAULT_KB_SUBJECT);
  const [isSaving, setIsSaving] = useState(false);

  const handleExtracted = useCallback(
    (
      newDrafts: ExtractedTask[],
      newStats: ExtractStats,
      chosenFolderId: string,
      chosenSubject: string,
    ) => {
      setDrafts(newDrafts);
      // Default-deselect drafts that look like duplicates (edge fingerprint_match).
      setSelected(newDrafts.map((d) => d.fingerprint_match === null));
      setStats(newStats);
      setFolderId(chosenFolderId);
      setSubject(chosenSubject);
      setStage('review');
    },
    [],
  );

  const updateDraft = useCallback((index: number, patch: Partial<ExtractedTask>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }, []);

  const toggleSelect = useCallback((index: number) => {
    setSelected((prev) => prev.map((s, i) => (i === index ? !s : s)));
  }, []);

  const selectedCount = useMemo(() => selected.filter(Boolean).length, [selected]);

  // Exact case-insensitive topic-name match within the chosen subject's taxonomy
  // (мультипредметный каталог; locked decision: never auto-create catalog topics;
  // no match → null).
  const resolveTopicId = useCallback(
    (suggestion: string): string | null => {
      const s = suggestion.trim().toLowerCase();
      if (!s) return null;
      const match = topics.find(
        (t) => t.subject === subject && t.name.trim().toLowerCase() === s,
      );
      return match?.id ?? null;
    },
    [topics, subject],
  );

  const handleCommit = useCallback(async () => {
    if (selectedCount === 0 || isSaving) return;
    const chosen = drafts
      .map((draft, index) => ({ draft, index }))
      .filter(({ index }) => selected[index]);

    setIsSaving(true);
    try {
      // Resolve topic ids, then bulk-fetch subtopics for matched topics (one query).
      const topicIdByDraftIndex = new Map<number, string | null>();
      for (const { draft, index } of chosen) {
        topicIdByDraftIndex.set(index, resolveTopicId(draft.topic_suggestion));
      }
      const matchedTopicIds = [
        ...new Set([...topicIdByDraftIndex.values()].filter((id): id is string => id !== null)),
      ];
      const subtopicsByTopic = new Map<string, KBSubtopic[]>();
      if (matchedTopicIds.length > 0) {
        const { data } = await supabase
          .from('kb_subtopics')
          .select('id, topic_id, name')
          .in('topic_id', matchedTopicIds);
        for (const st of (data ?? []) as KBSubtopic[]) {
          const list = subtopicsByTopic.get(st.topic_id) ?? [];
          list.push(st);
          subtopicsByTopic.set(st.topic_id, list);
        }
      }
      const resolveSubtopicId = (topicId: string | null, suggestion: string): string | null => {
        if (!topicId) return null;
        const s = suggestion.trim().toLowerCase();
        if (!s) return null;
        const list = subtopicsByTopic.get(topicId) ?? [];
        return list.find((st) => st.name.trim().toLowerCase() === s)?.id ?? null;
      };

      let saved = 0;
      let failed = 0;
      for (const { draft, index } of chosen) {
        const topicId = topicIdByDraftIndex.get(index) ?? null;
        const subtopicId = resolveSubtopicId(topicId, draft.subtopic_suggestion);
        try {
          await createTask.mutateAsync(draftToCreateInput(draft, folderId, topicId, subtopicId, subject));
          saved += 1;
        } catch {
          failed += 1;
        }
      }

      // Drafts left unchecked because they looked like duplicates.
      const skippedDup = drafts.filter((d, i) => !selected[i] && d.fingerprint_match !== null).length;

      trackKbAiLoaderEvent('kb_ai_tasks_saved', { folderId, saved, skipped: skippedDup });

      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });

      if (saved > 0) {
        const parts = [`Добавлено ${saved}`];
        if (skippedDup > 0) parts.push(`${skippedDup} дубл. пропущено`);
        if (failed > 0) parts.push(`${failed} с ошибкой`);
        toast.success(parts.join(' · '));
        navigate(folderId ? `/tutor/knowledge/folder/${folderId}` : '/tutor/knowledge?tab=mybase');
      } else {
        toast.error('Не удалось сохранить задачи. Попробуйте ещё раз.');
      }
    } finally {
      setIsSaving(false);
    }
  }, [drafts, selected, selectedCount, folderId, subject, isSaving, resolveTopicId, createTask, navigate, queryClient]);

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
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setStage('input')}
                className="text-xs font-semibold text-socrat-primary transition-colors hover:text-socrat-primary-dark disabled:opacity-50"
              >
                ← Загрузить другой материал
              </button>
            </div>

            <div className="space-y-3">
              {drafts.map((draft, index) => (
                <DraftCard
                  key={index}
                  index={index}
                  draft={draft}
                  selected={selected[index] ?? false}
                  subject={subject}
                  onToggleSelect={toggleSelect}
                  onChange={updateDraft}
                  disabled={isSaving}
                />
              ))}
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
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Сохраняем…
                  </>
                ) : (
                  <>
                    Сохранить {selectedCount > 0 ? `${selectedCount} ` : ''}
                    {selectedCount === 1 ? 'задачу' : 'задач'}
                  </>
                )}
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
