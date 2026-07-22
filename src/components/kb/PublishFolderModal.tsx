import { useEffect, useMemo, useState } from 'react';
import { Plus, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import { TopicEditorModal } from '@/components/kb/TopicEditorModal';
import { useSubtopics, useTopics } from '@/hooks/useKnowledgeBase';
import { usePublishFolder } from '@/hooks/useModeratorCatalog';
import { useTutorProfile } from '@/hooks/useTutorProfile';
import { resolveTutorDefaultSubject } from '@/lib/tutorSubjects';
import { cn } from '@/lib/utils';
import { getSubjectLabel, SUBJECTS } from '@/types/homework';
import type { KBFolder, TopicKind } from '@/types/kb';

interface PublishFolderModalProps {
  folder: KBFolder;
  onClose: () => void;
}

function topicLabel(exam: string | null, kind: string): string {
  if (kind === 'olympiad') return 'Олимпиада';
  if (exam === 'ege') return 'ЕГЭ';
  if (exam === 'oge') return 'ОГЭ';
  return '';
}

/**
 * Публикация всех задач папки в выбранную тему каталога (source→copy).
 * Тему можно выбрать существующую или создать новую инлайн. Папка «помнит»
 * выбранную тему (binding) → prefill при повторной публикации.
 *
 * ВОЛНА 7 (репорт Светланы): темы скоупятся ПРЕДМЕТОМ — раньше селект сыпал
 * все ~100 тем всех предметов вперемешку, а инлайн-создание темы дефолтилось
 * в physics (математик опубликовал бы задачи невидимо для вкладки «Математика»).
 * Предмет — derived (ручной выбор → предмет сохранённой привязки папки →
 * дефолт из профиля), без эффектов-клобберов (rule 40).
 */
export function PublishFolderModal({ folder, onClose }: PublishFolderModalProps) {
  const { topics: allTopics, loading: topicsLoading } = useTopics();
  const { data: tutorProfile } = useTutorProfile();
  const publishFolder = usePublishFolder();

  const [topicId, setTopicId] = useState<string>(folder.catalog_topic_id ?? '');
  const [subtopicId, setSubtopicId] = useState<string>(folder.catalog_subtopic_id ?? '');
  const [createKind, setCreateKind] = useState<TopicKind | null>(null);
  // null = предмет не выбран вручную → derived ниже.
  const [subjectManual, setSubjectManual] = useState<string | null>(null);

  // Предмет сохранённой привязки папки (asynс-кэш тем мог ещё не прогрузиться —
  // derived-выражение само подхватит, когда придёт; ручной выбор всегда wins).
  const bindingSubject = useMemo(
    () => allTopics.find((t) => t.id === folder.catalog_topic_id)?.subject ?? null,
    [allTopics, folder.catalog_topic_id],
  );
  const subject =
    subjectManual ?? bindingSubject ?? resolveTutorDefaultSubject(tutorProfile?.subjects, null);

  const topics = useMemo(
    () => allTopics.filter((t) => (t.subject ?? 'physics') === subject),
    [allTopics, subject],
  );

  const { subtopics } = useSubtopics(topicId || undefined);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Reset subtopic when topic changes (unless it's the prefilled binding).
  useEffect(() => {
    if (topicId !== folder.catalog_topic_id) setSubtopicId('');
  }, [topicId, folder.catalog_topic_id]);

  const handleSubjectChange = (next: string) => {
    setSubjectManual(next);
    // Сброс темы/подтемы в хендлере, не эффектом (rule 40 анти-клоббер).
    setTopicId('');
    setSubtopicId('');
  };

  const canPublish = topicId !== '' && !publishFolder.isPending;

  const handlePublish = () => {
    if (!canPublish) return;
    publishFolder.mutate(
      { folderId: folder.id, topicId, subtopicId: subtopicId || null },
      {
        onSuccess: ({ published, skipped }) => {
          if (published === 0 && skipped > 0) {
            toast.info('Все задачи папки уже в каталоге');
          } else {
            toast.success(
              `Опубликовано ${published}` + (skipped > 0 ? ` · пропущено ${skipped} (уже в каталоге)` : ''),
            );
          }
          onClose();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось опубликовать папку'),
      },
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />

      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold">Опубликовать папку в каталог</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
          <p className="text-sm text-slate-600">
            Все задачи папки <span className="font-semibold text-slate-900">«{folder.name}»</span> попадут
            в общий каталог под выбранной темой. Оригиналы останутся у вас в базе и будут
            синхронизироваться при правках.
          </p>

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">Предмет</legend>
            <select
              value={subject}
              onChange={(e) => handleSubjectChange(e.target.value)}
              className="w-full rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
            >
              {SUBJECTS.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Тема каталога <span className="text-red-500">*</span>
            </legend>
            <select
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              disabled={topicsLoading}
              className="w-full rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
            >
              <option value="">
                {topics.length === 0 && !topicsLoading
                  ? `Тем по предмету «${getSubjectLabel(subject)}» пока нет — создайте ниже`
                  : 'Выберите тему…'}
              </option>
              {topics.map((t) => {
                const tag = topicLabel(t.exam, t.kind);
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}{tag ? ` · ${tag}` : ''}
                  </option>
                );
              })}
            </select>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCreateKind('olympiad')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-socrat-folder/30 bg-socrat-folder-bg px-3 py-1.5 text-[13px] font-semibold text-socrat-folder [touch-action:manipulation]"
              >
                <Plus className="h-3.5 w-3.5" />
                Олимпиадную тему
              </button>
              <button
                type="button"
                onClick={() => setCreateKind('exam')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-socrat-border bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-600 [touch-action:manipulation]"
              >
                <Plus className="h-3.5 w-3.5" />
                Тему ЕГЭ/ОГЭ
              </button>
            </div>
          </fieldset>

          {topicId && subtopics.length > 0 ? (
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold text-slate-500">Подтема (необязательно)</legend>
              <select
                value={subtopicId}
                onChange={(e) => setSubtopicId(e.target.value)}
                className="w-full rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
              >
                <option value="">Без подтемы</option>
                {subtopics.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </fieldset>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-socrat-border px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-socrat-border bg-transparent px-4 py-2 text-[13px] text-muted-foreground"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={!canPublish}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              canPublish ? 'bg-socrat-primary' : 'cursor-default bg-socrat-border',
            )}
          >
            <UploadCloud className="h-4 w-4" />
            {publishFolder.isPending ? 'Публикуем…' : 'Опубликовать'}
          </button>
        </div>
      </div>

      {createKind ? (
        <TopicEditorModal
          mode="create"
          kind={createKind}
          // КРИТИЧНО (ВОЛНА 7): без subject тема создавалась бы с дефолтом
          // 'physics' — задачи математика уезжали бы в раздел физики.
          subject={subject}
          onSaved={(newId) => setTopicId(newId)}
          onClose={() => setCreateKind(null)}
        />
      ) : null}
    </>
  );
}
