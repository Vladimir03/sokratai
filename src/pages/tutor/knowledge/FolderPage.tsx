import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Folder, FolderPlus, Plus, ChevronRight, Image } from 'lucide-react';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useFolder } from '@/hooks/useFolders';
import { cn } from '@/lib/utils';
import type { KBTask } from '@/types/kb';

function FolderContent() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const { folder, children, tasks, loading, error, refetch, isFetching } = useFolder(folderId);

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  return (
    <TutorLayout>
      <div className="space-y-6">
        <TutorDataStatus error={error} isFetching={isFetching} onRetry={refetch} />

        {/* Back */}
        <button
          onClick={() => {
            if (folder?.parent_id) {
              navigate(`/tutor/knowledge/folder/${folder.parent_id}`);
            } else {
              navigate('/tutor/knowledge?tab=mybase');
            }
          }}
          className="flex items-center gap-1.5 text-sm font-medium text-socrat-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {folder?.parent_id ? 'Назад' : 'Моя база'}
        </button>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            <div className="h-10 w-48 animate-pulse rounded-lg bg-socrat-border-light" />
            <div className="h-16 animate-pulse rounded-xl bg-socrat-border-light" />
            <div className="h-16 animate-pulse rounded-xl bg-socrat-border-light" />
          </div>
        )}

        {folder && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between">
              <h1 className="font-display text-[22px] font-bold">{folder.name}</h1>
              <div className="flex gap-2">
                <button
                  onClick={() => { /* placeholder: create subfolder */ }}
                  className="flex items-center gap-1.5 rounded-lg border border-socrat-border bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  Подпапка
                </button>
                <button
                  onClick={() => { /* placeholder: create task */ }}
                  className="flex items-center gap-1.5 rounded-lg bg-socrat-primary px-3 py-1.5 text-xs font-semibold text-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Задача
                </button>
              </div>
            </div>

            {/* Subfolders */}
            {children.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Папки
                </div>
                <div className="flex flex-col gap-1.5">
                  {children.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => navigate(`/tutor/knowledge/folder/${sub.id}`)}
                      className="flex w-full items-center gap-3 rounded-xl border border-socrat-border bg-white p-3.5 text-left transition-colors hover:border-socrat-folder/40"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-socrat-folder-bg">
                        <Folder className="h-5 w-5 text-socrat-folder" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold">{sub.name}</div>
                      </div>
                      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-socrat-muted" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Tasks */}
            {tasks.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Задачи
                </div>
                <div className="flex flex-col gap-2">
                  {tasks.map(task => (
                    <FolderTaskCard
                      key={task.id}
                      task={task}
                      isExpanded={expandedTaskId === task.id}
                      onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {children.length === 0 && tasks.length === 0 && (
              <div className="py-12 text-center text-socrat-muted">
                <div className="mb-2 text-4xl">📂</div>
                <p className="text-sm font-medium">Папка пуста</p>
                <p className="text-xs">Добавьте подпапки или скопируйте задачи из Каталога</p>
              </div>
            )}
          </>
        )}
      </div>
    </TutorLayout>
  );
}

// ─── Task card for folder (isOwn = true) ───

function FolderTaskCard({ task, isExpanded, onToggle }: { task: KBTask; isExpanded: boolean; onToggle: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-socrat-border bg-white">
      <div className="flex cursor-pointer items-start gap-3 p-3.5" onClick={onToggle}>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full bg-socrat-accent-light px-2.5 py-0.5 text-[11px] font-semibold text-socrat-accent">
              Моя
            </span>
            {task.kim_number && (
              <span className="text-[11px] text-socrat-muted">КИМ № {task.kim_number}</span>
            )}
            {task.attachment_url && (
              <Image className="h-3 w-3 text-socrat-muted" />
            )}
          </div>
          <p className={cn('text-[13px] leading-relaxed', !isExpanded && 'line-clamp-2')}>
            {task.text}
          </p>
          {isExpanded && task.answer && (
            <div className="mt-2.5 rounded-lg bg-socrat-surface p-3">
              <div className="mb-0.5 text-[11px] text-muted-foreground">Ответ:</div>
              <div className="font-mono text-sm font-semibold text-socrat-primary">{task.answer}</div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => { /* placeholder: add to HW */ }}
            className="flex items-center gap-1 rounded-lg bg-socrat-primary px-3 py-1.5 text-xs font-semibold text-white"
          >
            В ДЗ
          </button>
          <button
            onClick={() => { /* placeholder: context menu */ }}
            className="flex items-center justify-center rounded-lg border border-socrat-border p-1.5"
          >
            <span className="text-sm leading-none text-muted-foreground">⋯</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FolderPage() {
  return (
    <TutorGuard>
      <FolderContent />
    </TutorGuard>
  );
}
