import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Folder, FolderPlus, LayoutGrid, Plus, Sparkles, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CreateFolderModal } from '@/components/kb/CreateFolderModal';
import { CreateTaskModal } from '@/components/kb/CreateTaskModal';
import { DeleteCatalogDialog } from '@/components/kb/DeleteCatalogDialog';
import { DeleteFolderDialog } from '@/components/kb/DeleteFolderDialog';
import { FolderCard } from '@/components/kb/FolderCard';
import { KBSearchDropdown } from '@/components/kb/KBSearchDropdown';
import { SubjectPills } from '@/components/kb/SubjectPills';
import { KBStatusCard } from '@/components/kb/KBStatusCard';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { RenameFolderModal } from '@/components/kb/RenameFolderModal';
import { SourcesManager } from '@/components/kb/SourcesManager';
import { TopicCard } from '@/components/kb/TopicCard';
import { TopicEditorModal } from '@/components/kb/TopicEditorModal';
import { FilterChips } from '@/components/kb/ui/FilterChips';
import { KBSearchInput } from '@/components/kb/ui/KBSearchInput';
import { useDeleteFolder, useRootFolders } from '@/hooks/useFolders';
import { useIsModerator } from '@/hooks/useIsModerator';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useKBSearch } from '@/hooks/useKBSearch';
import { useTopics } from '@/hooks/useKnowledgeBase';
import { useDeleteSectionToMyBase } from '@/hooks/useModeratorCatalog';
import { groupTopicsBySection } from '@/lib/kbCatalogGrouping';
import { loadLastClassification } from '@/lib/kbLastClassification';
import { pluralizeRu } from '@/lib/pluralizeRu';
import { getSubjectDative } from '@/lib/subjectHelpers';
import {
  readExamLastUsed,
  resolveTutorDefaultExam,
  resolveTutorDefaultSubject,
} from '@/lib/tutorSubjects';
import { useTutorProfile } from '@/hooks/useTutorProfile';
import { getSubjectLabel, SUBJECTS } from '@/types/homework';
import { cn } from '@/lib/utils';
import {
  KB_SUBJECTS,
  type CatalogFilter,
  type KBTopicWithCounts,
} from '@/types/kb';

type MainTab = 'catalog' | 'mybase';

// Дательный падеж предмета («По физике…») — shared `getSubjectDative`
// (`@/lib/subjectHelpers`), реюзается заголовком пробника ученика.

function KnowledgeBaseContent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'mybase' ? 'mybase' : 'catalog';
  // Профиль — для дефолта предмета и онбординг-нуджа (кэш card-ключа тёплый).
  const { data: tutorProfile } = useTutorProfile();
  const [mainTab, setMainTab] = useState<MainTab>(initialTab);
  // Дефолт-предмет: last-used (KB-серия) → профиль репетитора → physics.
  const [subject, setSubject] = useState<string>(() =>
    resolveTutorDefaultSubject(tutorProfile?.subjects, loadLastClassification().subject ?? null),
  );
  // Ф3: exam-фильтр витрины — из фокуса ВЫБРАННОГО предмета (prefill-only).
  // 'school' в витрине не существует → last-used предмета → прежний 'ege'
  // (ревью P2-5: непригодный единственный фокус не должен терять last-used).
  const [examFilter, setExamFilter] = useState<CatalogFilter>(() => {
    const initialSubject = resolveTutorDefaultSubject(
      tutorProfile?.subjects,
      loadLastClassification().subject ?? null,
    );
    const lastUsed = readExamLastUsed(initialSubject);
    const focus = resolveTutorDefaultExam(
      initialSubject,
      tutorProfile?.exam_focus_by_subject,
      lastUsed,
    );
    if (focus === 'ege' || focus === 'oge' || focus === 'olympiad') return focus;
    if (lastUsed === 'ege' || lastUsed === 'oge' || lastUsed === 'olympiad') return lastUsed;
    return 'ege';
  });
  const [searchQuery, setSearchQuery] = useState('');

  return (
      <KnowledgeBaseFrame>
        <div className="space-y-8">
          {/* Онбординг предметов теперь — SubjectsGateDialog в AppFrame
              (subject-personalization Ф1); баннер удалён, чтобы не дублировать. */}
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
              subject={subject}
              setSubject={setSubject}
              onOpenTopic={(topicId) => navigate(`/tutor/knowledge/topic/${topicId}`)}
            />
          ) : (
            <MyBaseHome onOpenFolder={(folderId) => navigate(`/tutor/knowledge/folder/${folderId}`)} />
          )}
        </div>
      </KnowledgeBaseFrame>
  );
}

interface CatalogHomeProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  examFilter: CatalogFilter;
  setExamFilter: (value: CatalogFilter) => void;
  subject: string;
  setSubject: (value: string) => void;
  onOpenTopic: (topicId: string) => void;
}

function CatalogHome({
  searchQuery,
  setSearchQuery,
  examFilter,
  setExamFilter,
  subject,
  setSubject,
  onOpenTopic,
}: CatalogHomeProps) {
  const navigate = useNavigate();
  const { topics, loading, error, refetch, isFetching } = useTopics(examFilter, subject);
  // Все темы (без фильтров) — для дерайва «предметы с каталожным контентом».
  // Тот же кэш-ключ, что у KBPickerSheet (справочник, quiet).
  const { topics: allTopics } = useTopics(undefined, undefined);
  const { data: tutorProfile } = useTutorProfile();
  const search = useKBSearch(searchQuery, examFilter);
  const { isModerator } = useIsModerator();
  const { isAdmin } = useAdminAccess();

  // ВОЛНА 6: удаление раздела — модератор своего активного предмета ИЛИ владелец
  // (is_admin, bypass по любому предмету — зеркало kb_require_moderator_subject).
  const mySubjects = tutorProfile?.subjects ?? [];
  const canModerateSubject = isAdmin || (isModerator && mySubjects.includes(subject));
  const deleteSectionMutation = useDeleteSectionToMyBase();
  // Счётчики раздела приходят из СЕРВЕРНОГО preflight (ревью P0-2/P1-5): при
  // активном поиске список тем клиентски отфильтрован, а RPC удалит ВЕСЬ раздел
  // → счётчики врали бы. Кнопку удаления при поиске прячем (ниже, !searchQuery).
  const [deletingSection, setDeletingSection] = useState<{ section: string } | null>(null);
  const handleConfirmDeleteSection = useCallback(
    (folderId: string | null) => {
      if (!deletingSection) return;
      deleteSectionMutation.mutate(
        { subject, section: deletingSection.section, filter: examFilter, folderId },
        {
          onSuccess: (res) => {
            toast.success(`Раздел удалён · тем ${res.topicsDeleted ?? 0}, задач перенесено ${res.moved}`);
            setDeletingSection(null);
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : 'Не удалось удалить раздел'),
        },
      );
    },
    [deletingSection, deleteSectionMutation, subject, examFilter],
  );

  // Предметы существующих тем → pills (union-логика и рендер живут в общем
  // `SubjectPills`, чтобы витрина и пикер «+ из БЗ» не разъезжались, 2026-07-23).
  const topicSubjects = useMemo(() => allTopics.map((t) => t.subject), [allTopics]);
  const [showDropdown, setShowDropdown] = useState(true);
  const [showCreateTopic, setShowCreateTopic] = useState(false);
  const [showSources, setShowSources] = useState(false);

  // W3.3 (2026-07-12): счётчик Банка по активному предмету — сумма task_count
  // всех тем предмета (оба экзамена + олимпиады, независимо от exam-фильтра).
  // Из уже загруженного allTopics — ноль новых запросов. Мотивация лидеров +
  // цифра для маркетинга («в Банке N задач по физике»).
  const subjectTaskTotal = useMemo(
    () =>
      allTopics
        .filter((t) => (t.subject ?? 'physics') === subject)
        .reduce((acc, t) => acc + (t.task_count ?? 0), 0),
    [allTopics, subject],
  );

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

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Каталог задач
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Общая база
            {subjectTaskTotal > 0
              ? ` · ${getSubjectLabel(subject)}: ${subjectTaskTotal} ${pluralizeRu(subjectTaskTotal, ['задача', 'задачи', 'задач'])}`
              : ''}
            {' · Копируйте нужные задачи к себе'}
          </p>
        </div>
        {isModerator ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSources(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-socrat-border bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition-all duration-200 hover:border-socrat-primary/35 hover:text-socrat-primary [touch-action:manipulation]"
            >
              <Tags className="h-4 w-4" />
              Источники
            </button>
            <button
              type="button"
              onClick={() => setShowCreateTopic(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-socrat-primary/20 bg-socrat-primary-light px-4 py-2.5 text-sm font-semibold text-socrat-primary shadow-sm transition-all duration-200 hover:border-socrat-primary/35 [touch-action:manipulation]"
            >
              <Plus className="h-4 w-4" />
              Тема
            </button>
          </div>
        ) : null}
      </div>

      {/* Предмет — компактные pills, НЕ второй сегмент-контрол (UX review P2:
          три уровня навигации одинакового веса перед контентом перегружали
          «где я»; предмет — фильтр витрины, визуально легче таба раздела).
          Компонент общий с пикером «+ из БЗ». */}
      <SubjectPills
        className="mb-4"
        value={subject}
        onChange={setSubject}
        topicSubjects={topicSubjects}
        tutorSubjects={tutorProfile?.subjects}
        aria-label="Предмет каталога"
      />

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
        onChange={(key) => setExamFilter(key as CatalogFilter)}
        options={[
          { key: 'ege', label: 'ЕГЭ', activeClassName: 'text-socrat-ege' },
          { key: 'oge', label: 'ОГЭ', activeClassName: 'text-socrat-oge' },
          { key: 'olympiad', label: 'Олимпиады', activeClassName: 'text-socrat-folder' },
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
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{section}</h3>
            {/* Удаление раздела прячем при активном поиске: список тем клиентски
                отфильтрован, а RPC снесёт ВЕСЬ раздел — избегаем несоответствия
                (ревью P0-2). Точные счётчики берёт preflight в диалоге. */}
            {canModerateSubject && !searchQuery.trim() ? (
              <button
                type="button"
                onClick={() => setDeletingSection({ section })}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-red-500 transition-colors hover:bg-red-50 [touch-action:manipulation]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить раздел
              </button>
            ) : null}
          </div>
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

      {!loading && topics.length === 0 && !searchQuery.trim() ? (
        <div className="rounded-[22px] border border-dashed border-socrat-border bg-white/70 px-5 py-12 text-center">
          {/* Subject-aware (UX review P3): пустой предмет должен подтверждать,
              ГДЕ пусто, а не звучать как общий пустой каталог. */}
          <p className="text-sm font-semibold text-slate-800">
            {`По ${getSubjectDative(subject)} ${
              examFilter === 'olympiad'
                ? 'олимпиадных тем пока нет'
                : `тем ${examFilter === 'oge' ? 'ОГЭ' : 'ЕГЭ'} пока нет`
            }`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {isModerator
              ? `Создайте первую тему по ${getSubjectDative(subject)} кнопкой «Тема» выше и опубликуйте в неё задачи из своей папки.`
              : 'Скоро здесь появятся задачи.'}
          </p>
        </div>
      ) : null}

      {showCreateTopic ? (
        <TopicEditorModal
          mode="create"
          kind={examFilter === 'olympiad' ? 'olympiad' : 'exam'}
          subject={subject}
          onClose={() => setShowCreateTopic(false)}
        />
      ) : null}

      {showSources ? (
        <SourcesManager onClose={() => setShowSources(false)} />
      ) : null}

      {deletingSection ? (
        <DeleteCatalogDialog
          entity="раздел"
          name={deletingSection.section}
          target={{ kind: 'section', subject, section: deletingSection.section, filter: examFilter }}
          isPending={deleteSectionMutation.isPending}
          onConfirm={handleConfirmDeleteSection}
          onClose={() => setDeletingSection(null)}
        />
      ) : null}
    </div>
  );
}

interface MyBaseHomeProps {
  onOpenFolder: (folderId: string) => void;
}

function MyBaseHome({ onOpenFolder }: MyBaseHomeProps) {
  const navigate = useNavigate();
  const { folders, loading, error, refetch, isFetching } = useRootFolders();
  // W3.3: вклад лидера — сумма РЕКУРСИВНЫХ счётчиков root-папок (RPC
  // kb_folder_recursive_counts уже считает всё дерево, rule 50).
  const myTaskTotal = useMemo(
    () => folders.reduce((acc, f) => acc + (f.task_count ?? 0), 0),
    [folders],
  );
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
          <p className="mt-2 text-sm text-slate-500">
            Ваши папки, задачи и материалы
            {myTaskTotal > 0
              ? ` · вы загрузили ${myTaskTotal} ${pluralizeRu(myTaskTotal, ['задачу', 'задачи', 'задач'])}`
              : ''}
          </p>
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

      <button
        type="button"
        onClick={() => navigate('/tutor/knowledge/ai-loader')}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-[22px] border border-socrat-primary/20 bg-socrat-primary-light px-4 py-4 text-sm font-semibold text-socrat-primary transition-colors duration-200 hover:border-socrat-primary/35 [touch-action:manipulation]"
      >
        <Sparkles className="h-4 w-4" />
        AI-загрузка задач
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
              // Ревью-фикс P1 (2026-07-06): delete-гард шаблонов кидает русскую
              // фразу («В папке есть задачи, используемые в шаблонах…») —
              // показываем её, а не generic (rule 97).
              onError: (e) =>
                toast.error(
                  e instanceof Error && /[а-яё]/i.test(e.message)
                    ? e.message
                    : 'Не удалось удалить папку',
                ),
            });
          }}
          onClose={() => setDeletingFolder(null)}
        />
      ) : null}
    </div>
  );
}

export default function KnowledgeBasePage() {
  return <KnowledgeBaseContent />;
}
