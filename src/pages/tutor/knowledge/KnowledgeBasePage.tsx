import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, LayoutGrid, Folder, FolderPlus, ChevronRight, Plus } from 'lucide-react';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { TopicCard } from '@/components/kb/TopicCard';
import { useTopics } from '@/hooks/useKnowledgeBase';
import { useRootFolders } from '@/hooks/useFolders';
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
      <div className="space-y-6">
        {/* Tab Switcher */}
        <div className="flex gap-1 rounded-xl bg-socrat-border-light p-1">
          {([
            { key: 'catalog' as MainTab, label: 'Каталог Сократа', Icon: LayoutGrid },
            { key: 'mybase' as MainTab, label: 'Моя база', Icon: Folder },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setMainTab(tab.key); setSearchQuery(''); }}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-medium transition-all',
                mainTab === tab.key
                  ? 'bg-white font-semibold text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <tab.Icon className={cn('h-4 w-4', mainTab === tab.key ? 'text-socrat-primary' : 'text-socrat-muted')} />
              {tab.label}
            </button>
          ))}
        </div>

        {mainTab === 'catalog' && (
          <CatalogHome
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            examFilter={examFilter}
            setExamFilter={setExamFilter}
            onOpenTopic={(topicId) => navigate(`/tutor/knowledge/topic/${topicId}`)}
          />
        )}
        {mainTab === 'mybase' && (
          <MyBaseHome
            onOpenFolder={(folderId) => navigate(`/tutor/knowledge/folder/${folderId}`)}
          />
        )}
      </div>
    </TutorLayout>
  );
}

// ─── Catalog Tab ───

interface CatalogHomeProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  examFilter: ExamType;
  setExamFilter: (e: ExamType) => void;
  onOpenTopic: (topicId: string) => void;
}

function CatalogHome({ searchQuery, setSearchQuery, examFilter, setExamFilter, onOpenTopic }: CatalogHomeProps) {
  const { topics, loading, error, refetch, isFetching } = useTopics(examFilter);

  // Client-side search filtering (search also includes subtopic_names)
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return topics;
    const q = searchQuery.toLowerCase();
    return topics.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.section.toLowerCase().includes(q) ||
      t.subtopic_names.some(s => s.toLowerCase().includes(q))
    );
  }, [topics, searchQuery]);

  // Group by section
  const sections = useMemo(() => {
    const sectionMap = new Map<string, KBTopicWithCounts[]>();
    for (const t of filtered) {
      const list = sectionMap.get(t.section) ?? [];
      list.push(t);
      sectionMap.set(t.section, list);
    }
    return Array.from(sectionMap.entries());
  }, [filtered]);

  return (
    <div>
      <TutorDataStatus error={error} isFetching={isFetching} onRetry={refetch} />

      {/* Header */}
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Каталог задач</h1>
        <p className="text-sm text-muted-foreground">Общая база · Копируйте нужные задачи к себе</p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-3 h-[18px] w-[18px] text-socrat-muted" />
        <input
          type="text"
          placeholder="Поиск по темам, подтемам и задачам..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border-[1.5px] border-socrat-border bg-white py-2.5 pl-11 pr-4 text-sm font-body focus:border-socrat-primary focus:outline-none"
          style={{ fontSize: 16 }}
        />
      </div>

      {/* Exam filter pill switcher */}
      <div className="mb-6 flex gap-1 rounded-xl bg-socrat-border-light p-1">
        {([
          { key: 'ege' as ExamType, label: 'ЕГЭ Физика', activeColor: 'text-socrat-ege' },
          { key: 'oge' as ExamType, label: 'ОГЭ Физика', activeColor: 'text-socrat-oge' },
        ]).map(ex => (
          <button
            key={ex.key}
            onClick={() => setExamFilter(ex.key)}
            className={cn(
              'flex-1 rounded-[10px] px-4 py-2.5 text-sm font-medium transition-all',
              examFilter === ex.key
                ? `bg-white font-semibold shadow-sm ${ex.activeColor}`
                : 'text-muted-foreground'
            )}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-socrat-border-light" />
          ))}
        </div>
      )}

      {/* Topic sections */}
      {!loading && sections.map(([section, topicList]) => (
        <div key={section} className="mb-7">
          <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {section}
          </h2>
          <div className="flex flex-col gap-1.5">
            {topicList.map(topic => (
              <TopicCard
                key={topic.id}
                topic={topic}
                onClick={() => onOpenTopic(topic.id)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Empty search result */}
      {!loading && filtered.length === 0 && searchQuery.trim() && (
        <div className="py-12 text-center text-muted-foreground">
          <p className="text-sm font-medium">Ничего не найдено</p>
          <p className="text-xs">Попробуйте изменить запрос</p>
        </div>
      )}
    </div>
  );
}

// ─── My Base Tab ───

interface MyBaseHomeProps {
  onOpenFolder: (folderId: string) => void;
}

function MyBaseHome({ onOpenFolder }: MyBaseHomeProps) {
  const { folders, loading, error, refetch, isFetching } = useRootFolders();

  return (
    <div>
      <TutorDataStatus error={error} isFetching={isFetching} onRetry={refetch} />

      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Моя база</h1>
          <p className="text-sm text-muted-foreground">Ваши папки, задачи и материалы</p>
        </div>
        <button
          onClick={() => { /* placeholder for session 5 */ }}
          className="flex items-center gap-1.5 rounded-[10px] border-[1.5px] border-socrat-primary/20 bg-socrat-primary-light px-4 py-2 text-sm font-semibold text-socrat-primary"
        >
          <FolderPlus className="h-4 w-4" />
          Новая папка
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-1.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-[72px] animate-pulse rounded-xl bg-socrat-border-light" />
          ))}
        </div>
      )}

      {/* Folder list */}
      {!loading && (
        <div className="flex flex-col gap-1.5">
          {folders.map(f => (
            <button
              key={f.id}
              onClick={() => onOpenFolder(f.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-socrat-border bg-white p-3.5 text-left transition-colors hover:border-socrat-folder/40"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-socrat-folder-bg">
                <Folder className="h-5 w-5 text-socrat-folder" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{f.name}</div>
                {/* Task/child counts will come from enhanced query in future session */}
              </div>
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-socrat-muted" />
            </button>
          ))}
        </div>
      )}

      {/* Add task button */}
      <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-socrat-border bg-transparent px-4 py-3.5 text-sm font-medium text-muted-foreground">
        <Plus className="h-4 w-4" />
        Добавить задачу
      </button>

      {/* Empty state */}
      {!loading && folders.length === 0 && (
        <div className="py-12 text-center text-socrat-muted">
          <div className="mb-2 text-4xl">📂</div>
          <p className="text-sm font-medium">Пока нет папок</p>
          <p className="text-xs">Создайте папку для своих задач и материалов</p>
        </div>
      )}
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
