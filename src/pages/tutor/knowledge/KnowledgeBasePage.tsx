import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Folder, FolderPlus, LayoutGrid, Plus } from 'lucide-react';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { CreateFolderModal } from '@/components/kb/CreateFolderModal';
import { CreateTaskModal } from '@/components/kb/CreateTaskModal';
import { DeleteFolderDialog } from '@/components/kb/DeleteFolderDialog';
import { FolderCard } from '@/components/kb/FolderCard';
import { KBSearchDropdown } from '@/components/kb/KBSearchDropdown';
import { KBStatusCard } from '@/components/kb/KBStatusCard';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { RenameFolderModal } from '@/components/kb/RenameFolderModal';
import { TopicCard } from '@/components/kb/TopicCard';
import { FilterChips } from '@/components/kb/ui/FilterChips';
import { KBSearchInput } from '@/components/kb/ui/KBSearchInput';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { useDeleteFolder, useRootFolders } from '@/hooks/useFolders';
import { useKBSearch } from '@/hooks/useKBSearch';
import { useTopics } from '@/hooks/useKnowledgeBase';
import { cn } from '@/lib/utils';
import type { ExamType, KBTopicWithCounts } from '@/types/kb';

type MainTab = 'catalog' | 'mybase';

function KnowledgeBaseContent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'mybase' ? 'mybase' : 'catalog';
  const [mainTab, setMainTab] = useState<MainTab>(initialTab);
  const [examFilter, setExamFilter] = useState<ExamType>('ege');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <TutorLayout>
      <KnowledgeBaseFrame>
        <div className="space-y-8">
          <div className="flex gap-1.5 rounded-2xl bg-socrat-border-light p-1.5">
            {([
              { key: 'catalog' as MainTab, label: 'Каталог Сократ AI', Icon: LayoutGrid },
              { key: 'mybase' as MainTab, label: 'Моя база', Icon: Folder },
            ]).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setMainTab(tab.key);
                  setSearchQuery('');
                }}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-[14px] px-4 py-3 text-sm font-medium transition-all duration-200',
                  mainTab === tab.key
                    ? 'bg-white font-semibold text-slate-950 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.45)]'
                    : 'text-slate-500 hover:text-slate-800',
                )}
              >
                <tab.Icon className={cn('h-4 w-4', mainTab === tab.key ? 'text-socrat-primary' : 'text-slate-400')} />
                {tab.label}
              </button>
            ))}
          </div>

          {mainTab === 'catalog' ? (
            <CatalogHome
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              examFilter={examFilter}
              setExamFilter={setExamFilter}
              onOpenTopic={(topicId) => navigate(`/tutor/knowledge/topic/${topicId}`)}
            />
          ) : (
            <MyBaseHome onOpenFolder={(folderId) => navigate(`/tutor/knowledge/folder/${folderId}`)} />
          )}
        </div>
      </KnowledgeBaseFrame>
    </TutorLayout>
  );
}

interface CatalogHomeProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  examFilter: ExamType;
  setExamFilter: (value: ExamType) => void;
  onOpenTopic: (topicId: string) => void;
}

function CatalogHome({
  searchQuery,
  setSearchQuery,
  examFilter,
  setExamFilter,
  onOpenTopic,
}: CatalogHomeProps) {
  const navigate = useNavigate();
  const { topics, loading, error, refetch, isFetching } = useTopics(examFilter);
  const search = useKBSearch(searchQuery, examFilter);
  const [showDropdown, setShowDropdown] = useState(true);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setShowDropdown(true);
  }, [setSearchQuery]);

  const handleCloseDropdown = useCallback(() => {
    setShowDropdown(false);
  }, []);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) {
      return topics;
    }

    const normalizedQuery = searchQuery.trim().toLowerCase();
    return topics.filter((topic) =>
      topic.name.toLowerCase().includes(normalizedQuery)
      || topic.section.toLowerCase().includes(normalizedQuery)
      || topic.subtopic_names.some((name) => name.toLowerCase().includes(normalizedQuery)),
    );
  }, [topics, searchQuery]);

  const sections = useMemo(() => {
    const grouped = new Map<string, KBTopicWithCounts[]>();

    for (const topic of filtered) {
      const current = grouped.get(topic.section) ?? [];
      current.push(topic);
      grouped.set(topic.section, current);
    }

    return Array.from(grouped.entries());
  }, [filtered]);

  return (
    <div>
      <KBStatusCard error={error} isFetching={isFetching} onRetry={refetch} className="mb-6" />

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground">
          Каталог задач
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Общая база · Копируйте нужные задачи к себе</p>
      </div>

      <div className="relative mb-4">
        <KBSearchInput
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Поиск по темам, подтемам и задачам..."
        />
        {showDropdown ? (
          <KBSearchDropdown
            grouped={search}
            isLoading={search.isLoading}
            hasResults={search.hasResults}
            isActive={search.isActive}
            onSelectTopic={(topicId) => {
              setShowDropdown(false);
              navigate(`/tutor/knowledge/topic/${topicId}`);
            }}
            onSelectTask={(task) => {
              setShowDropdown(false);
              if (task.parent_topic_id) {
                navigate(`/tutor/knowledge/topic/${task.parent_topic_id}`);
              }
            }}
            onClose={handleCloseDropdown}
          />
        ) : null}
      </div>

      <FilterChips
        className="mb-7"
        selected={examFilter}
        onChange={(key) => setExamFilter(key as ExamType)}
        options={[
          { key: 'ege', label: 'ЕГЭ Физика', activeClassName: 'text-socrat-ege' },
          { key: 'oge', label: 'ОГЭ Физика', activeClassName: 'text-socrat-oge' },
        ]}
      />

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((index) => (
            <div key={index} className="h-28 animate-pulse rounded-[22px] bg-white/80" />
          ))}
        </div>
      ) : null}

      {!loading && sections.map(([section, sectionTopics]) => (
        <section key={section} className="mb-8">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{section}</h3>
          <div className="flex flex-col gap-2.5">
            {sectionTopics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} onClick={() => onOpenTopic(topic.id)} />
            ))}
          </div>
        </section>
      ))}

      {!loading && filtered.length === 0 && searchQuery.trim() ? (
        <div className="rounded-[22px] border border-dashed border-socrat-border bg-white/70 px-5 py-12 text-center">
          <p className="text-sm font-semibold text-slate-800">Ничего не найдено</p>
          <p className="mt-1 text-xs text-slate-500">Попробуйте изменить запрос</p>
        </div>
      ) : null}
    </div>
  );
}

interface MyBaseHomeProps {
  onOpenFolder: (folderId: string) => void;
}

function MyBaseHome({ onOpenFolder }: MyBaseHomeProps) {
  const { folders, loading, error, refetch, isFetching } = useRootFolders();
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<{ id: string; name: string } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string } | null>(null);
  const deleteFolder = useDeleteFolder();

  return (
    <div>
      <KBStatusCard error={error} isFetching={isFetching} onRetry={refetch} className="mb-6" />

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Моя база
          </h2>
          <p className="mt-2 text-sm text-slate-500">Ваши папки, задачи и материалы</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateFolder(true)}
          className={cn(
            'inline-flex items-center gap-2 rounded-xl border border-socrat-primary/20 bg-socrat-primary-light px-4 py-2.5',
            'text-sm font-semibold text-socrat-primary shadow-sm transition-all duration-200 hover:border-socrat-primary/35',
          )}
        >
          <FolderPlus className="h-4 w-4" />
          Новая папка
        </button>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((index) => (
            <div key={index} className="h-[82px] animate-pulse rounded-[22px] bg-white/80" />
          ))}
        </div>
      ) : null}

      {!loading ? (
        <div className="flex flex-col gap-2.5">
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              childCount={folder.child_count}
              taskCount={folder.task_count}
              onClick={() => onOpenFolder(folder.id)}
              onRename={() => setRenamingFolder({ id: folder.id, name: folder.name })}
              onDelete={() => setDeletingFolder({
                id: folder.id,
                name: folder.name,
              })}
            />
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setShowCreateTask(true)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-[22px] border-[1.5px] border-dashed border-socrat-border bg-transparent px-4 py-4 text-sm font-medium text-slate-500 transition-colors duration-200 hover:border-socrat-primary/30 hover:text-socrat-primary"
      >
        <Plus className="h-4 w-4" />
        Добавить задачу
      </button>

      {!loading && folders.length === 0 ? (
        <div className="mt-4 rounded-[22px] border border-dashed border-socrat-border bg-white/70 px-5 py-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-socrat-folder-bg text-socrat-folder">
            <Folder className="h-7 w-7" />
          </div>
          <p className="text-sm font-semibold text-slate-800">Пока нет папок</p>
          <p className="mt-1 text-xs text-slate-500">Создайте папку для своих задач и материалов</p>
        </div>
      ) : null}

      {showCreateFolder ? (
        <CreateFolderModal onClose={() => setShowCreateFolder(false)} />
      ) : null}

      {showCreateTask ? (
        <CreateTaskModal onClose={() => setShowCreateTask(false)} />
      ) : null}

      {renamingFolder ? (
        <RenameFolderModal
          folderId={renamingFolder.id}
          currentName={renamingFolder.name}
          onClose={() => setRenamingFolder(null)}
        />
      ) : null}

      {deletingFolder ? (
        <DeleteFolderDialog
          folder={deletingFolder}
          isPending={deleteFolder.isPending}
          onConfirm={() => {
            deleteFolder.mutate(deletingFolder.id, {
              onSuccess: () => {
                toast.success('Папка удалена');
                setDeletingFolder(null);
              },
              onError: () => toast.error('Не удалось удалить папку'),
            });
          }}
          onClose={() => setDeletingFolder(null)}
        />
      ) : null}
    </div>
  );
}

export default function KnowledgeBasePage() {
  return (
    <TutorGuard>
      <KnowledgeBaseContent />
    </TutorGuard>
  );
}
