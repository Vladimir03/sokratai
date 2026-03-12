import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Image, FileText, Link2, ChevronRight } from 'lucide-react';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTopic, useSubtopics, useCatalogTasks, useMaterials } from '@/hooks/useKnowledgeBase';
import { cn } from '@/lib/utils';
import type { KBTask, KBMaterial, MaterialType } from '@/types/kb';

function CatalogTopicContent() {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();

  const { topic, loading: topicLoading, error: topicError, refetch: refetchTopic, isFetching: topicFetching } = useTopic(topicId);
  const { subtopics } = useSubtopics(topicId);
  const { tasks, loading: tasksLoading, error: tasksError, refetch: refetchTasks } = useCatalogTasks(topicId);
  const { materials, loading: materialsLoading } = useMaterials(topicId);

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const isOge = topic?.exam === 'oge';
  const error = topicError || tasksError;

  return (
    <TutorLayout>
      <div className="space-y-6">
        <TutorDataStatus
          error={error}
          isFetching={topicFetching}
          onRetry={() => { refetchTopic(); refetchTasks(); }}
        />

        {/* Back button */}
        <button
          onClick={() => navigate('/tutor/knowledge')}
          className="flex items-center gap-1.5 text-sm font-medium text-socrat-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Каталог
        </button>

        {/* Topic loading skeleton */}
        {topicLoading && (
          <div className="h-40 animate-pulse rounded-2xl bg-socrat-border-light" />
        )}

        {/* Topic header card */}
        {topic && (
          <div className="rounded-2xl border border-socrat-border bg-white p-5">
            <div className="flex items-start justify-between">
              <div>
                {/* Title row */}
                <div className="mb-2 flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display text-[22px] font-bold">{topic.name}</h1>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide',
                      isOge ? 'bg-socrat-oge-bg text-socrat-oge' : 'bg-socrat-ege-bg text-socrat-ege'
                    )}
                  >
                    {isOge ? 'ОГЭ' : 'ЕГЭ'}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-socrat-border-light px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Каталог
                  </span>
                </div>

                {/* Section + KIM */}
                <div className="mb-2.5 text-sm text-muted-foreground">
                  {topic.section}
                  {topic.kim_numbers.length > 0 && ` · КИМ № ${topic.kim_numbers.join(', ')}`}
                </div>

                {/* Subtopic chips */}
                {subtopics.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {subtopics.map(s => (
                      <span
                        key={s.id}
                        className="rounded-lg bg-socrat-border-light px-2.5 py-1 text-xs font-medium text-muted-foreground"
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Task counter */}
              <div className="text-center">
                <div className="text-[22px] font-bold text-socrat-primary">{topic.task_count}</div>
                <div className="text-[11px] text-muted-foreground">задач</div>
              </div>
            </div>
          </div>
        )}

        {/* Tasks section */}
        <div>
          <h2 className="mb-3 text-base font-semibold">Задачи</h2>

          {tasksLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-socrat-border-light" />
              ))}
            </div>
          )}

          {!tasksLoading && tasks.length === 0 && (
            <div className="rounded-xl border border-dashed border-socrat-border py-8 text-center text-sm text-socrat-muted">
              Задач пока нет
            </div>
          )}

          <div className="flex flex-col gap-2">
            {tasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                subtopics={subtopics}
                isExpanded={expandedTaskId === task.id}
                onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
              />
            ))}
          </div>
        </div>

        {/* Materials section */}
        {!materialsLoading && materials.length > 0 && (
          <div>
            <h2 className="mb-3 text-base font-semibold">Материалы</h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {materials.map(m => (
                <MaterialCard key={m.id} material={m} />
              ))}
            </div>
          </div>
        )}
      </div>
    </TutorLayout>
  );
}

// ─── TaskCard (catalog, read-only) ───

interface TaskCardProps {
  task: KBTask;
  subtopics: { id: string; name: string }[];
  isExpanded: boolean;
  onToggle: () => void;
}

function TaskCard({ task, subtopics, isExpanded, onToggle }: TaskCardProps) {
  const subtopicName = subtopics.find(s => s.id === task.subtopic_id)?.name;

  return (
    <div className="overflow-hidden rounded-xl border border-socrat-border bg-white">
      <div
        className="flex cursor-pointer items-start gap-3 p-3.5"
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1">
          {/* Meta row */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full bg-socrat-primary-light px-2.5 py-0.5 text-[11px] font-semibold text-socrat-primary">
              Каталог
            </span>
            {subtopicName && (
              <span className="text-[11px] text-socrat-muted">{subtopicName}</span>
            )}
            {task.kim_number && (
              <span className="text-[11px] text-socrat-muted">· КИМ № {task.kim_number}</span>
            )}
            {task.attachment_url && (
              <Image className="h-3 w-3 text-socrat-muted" />
            )}
          </div>

          {/* Task text */}
          <p
            className={cn(
              'text-[13px] leading-relaxed',
              !isExpanded && 'line-clamp-2'
            )}
          >
            {task.text}
          </p>

          {/* Answer block (expanded) */}
          {isExpanded && task.answer && (
            <div className="mt-2.5 rounded-lg bg-socrat-surface p-3">
              <div className="mb-0.5 text-[11px] text-muted-foreground">Ответ:</div>
              <div className="font-mono text-sm font-semibold text-socrat-primary">
                {task.answer}
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => { /* placeholder: copy to folder */ }}
            className="flex items-center gap-1 rounded-lg border border-socrat-folder/20 bg-socrat-folder-bg px-3 py-1.5 text-xs font-semibold text-socrat-folder"
          >
            К себе
          </button>
          <button
            onClick={() => { /* placeholder: add to HW */ }}
            className="flex items-center gap-1 rounded-lg bg-socrat-primary px-3 py-1.5 text-xs font-semibold text-white"
          >
            В ДЗ
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MaterialCard ───

const materialIconMap: Record<MaterialType, typeof FileText> = {
  file: FileText,
  link: Link2,
  media: Image,
  board: ChevronRight,
};

const materialColorMap: Record<MaterialType, string> = {
  file: 'text-socrat-primary bg-socrat-primary/10',
  link: 'text-socrat-oge bg-socrat-oge/10',
  media: 'text-socrat-accent bg-socrat-accent/10',
  board: 'text-socrat-primary bg-socrat-primary/10',
};

function MaterialCard({ material }: { material: KBMaterial }) {
  const matType = (material.type as MaterialType) || 'file';
  const IconComp = materialIconMap[matType] || FileText;
  const colorClasses = materialColorMap[matType] || materialColorMap.file;

  return (
    <div className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-socrat-border bg-white p-3">
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', colorClasses)}>
        <IconComp className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{material.name}</div>
        {material.format && (
          <div className="text-[11px] text-socrat-muted">{material.format}</div>
        )}
      </div>
    </div>
  );
}

export default function CatalogTopicPage() {
  return (
    <TutorGuard>
      <CatalogTopicContent />
    </TutorGuard>
  );
}
