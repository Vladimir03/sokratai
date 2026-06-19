import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Pagination, 
  PaginationContent, 
  PaginationItem, 
  PaginationLink, 
  PaginationNext, 
  PaginationPrevious 
} from '@/components/ui/pagination';
import { UserPlus, Archive, ArrowLeft, Users } from 'lucide-react';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { StudentCard } from '@/components/tutor/StudentCard';
import { AddStudentDialog } from '@/components/tutor/AddStudentDialog';
import { StudentCredentialsModal } from '@/components/tutor/StudentCredentialsModal';
import { 
  StudentsToolbar, 
  type SortField, 
  type SortOrder, 
  type FilterValues 
} from '@/components/tutor/StudentsToolbar';
import { 
  StudentsSkeleton, 
  StudentsEmpty, 
  StudentsEmptyFilters, 
  StudentsError 
} from '@/components/tutor/StudentsStates';
import { useTutorStudents, useArchivedTutorStudents, useTutor, useTutorGroups, useTutorGroupMemberships } from '@/hooks/useTutor';
import {
  createTutorGroup,
  deactivateTutorGroupMembership,
  resetStudentPassword,
  setTutorStudentArchived,
  upsertTutorGroupMembership,
} from '@/lib/tutors';
import { invalidateTutorStudentDependentQueries } from '@/lib/tutorStudentCacheSync';
import { calculateProgress, getPaymentStatus } from '@/lib/formatters';
import { getTutorInviteWebLink, getTutorInviteTelegramLink } from '@/utils/telegramLinks';
import { toast } from 'sonner';
import type { TutorGroup, TutorGroupMembership, TutorStudentWithProfile } from '@/types/tutor';

// Успеваемость — подвкладка (student-progress R2). Lazy: грузится только при выборе.
const StudentsProgressOverview = lazy(() => import('./students/StudentsProgressOverview'));

const PAGE_SIZE = 10;

// Extended type with new fields
type StudentWithExtras = TutorStudentWithProfile & {
  paid_until?: string | null;
  last_activity_at?: string | null;
  /** Основная (учебная) группа ученика — для группировки списка + groupLabel. */
  primary_group: TutorGroup | null;
  /** Метки (доп. группы, is_primary=false) — для фильтра и чипов. */
  tags: TutorGroup[];
  /** Алиас primary_group для обратной совместимости (groupLabel/фильтр). */
  mini_group: TutorGroup | null;
  mini_group_membership: TutorGroupMembership | null;
};

const UNASSIGNED_GROUP_KEY = '__unassigned__';

type StudentCredentialsData = {
  studentName: string;
  loginEmail: string;
  plainPassword: string;
};

function TutorStudentsContent() {
  const navigate = useNavigate();
  // Подвкладка «Успеваемость» (R2). ?view=progress — linkable (deep-link с Главной).
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'progress' ? 'progress' : 'students';
  const {
    tutor,
    error: tutorError,
    refetch: refetchTutor,
    isFetching: tutorIsFetching,
    isRecovering: tutorIsRecovering,
    failureCount: tutorFailureCount,
  } = useTutor();
  const {
    students,
    loading,
    error,
    refetch,
    isFetching,
    isRecovering,
    failureCount,
  } = useTutorStudents();
  // Формат занятий теперь задаётся в профиле (/tutor/profile), по умолчанию ВКЛ
  // (миграция 20260607120100). Здесь read-only — самовыключающийся тумблер убран.
  const miniGroupsEnabled = Boolean(tutor?.mini_groups_enabled ?? true);
  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
    refetch: refetchGroups,
    isFetching: groupsIsFetching,
    isRecovering: groupsIsRecovering,
    failureCount: groupsFailureCount,
  } = useTutorGroups(miniGroupsEnabled);
  const {
    memberships,
    loading: membershipsLoading,
    error: membershipsError,
    refetch: refetchMemberships,
    isFetching: membershipsIsFetching,
    isRecovering: membershipsIsRecovering,
    failureCount: membershipsFailureCount,
  } = useTutorGroupMemberships(miniGroupsEnabled);

  // State
  const [sortBy, setSortBy] = useState<SortField>('activity');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterValues>({
    paymentStatus: null,
    examType: null,
    subject: null,
    groupMode: 'all',
    groupId: null,
    tagId: null,
  });
  const [page, setPage] = useState(1);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [credentialsData, setCredentialsData] = useState<StudentCredentialsData | null>(null);
  const [resettingStudentId, setResettingStudentId] = useState<string | null>(null);

  // Архив учеников (запрос Елены 2026-06-17). Фетчим архив только когда открыт режим.
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const { students: archivedStudents, loading: archivedLoading } = useArchivedTutorStudents(showArchived);
  const [unarchivingId, setUnarchivingId] = useState<string | null>(null);

  const handleUnarchive = useCallback(async (tutorStudentId: string) => {
    setUnarchivingId(tutorStudentId);
    try {
      const ok = await setTutorStudentArchived(tutorStudentId, false);
      if (!ok) {
        toast.error('Не удалось вернуть из архива');
        return;
      }
      await invalidateTutorStudentDependentQueries(queryClient, tutorStudentId);
      toast.success('Ученик возвращён из архива');
    } catch (err) {
      console.error('Error unarchiving student:', err);
      toast.error('Не удалось вернуть из архива');
    } finally {
      setUnarchivingId(null);
    }
  }, [queryClient]);
  const initialLoading = loading && students.length === 0 && !error;
  const hasErrors = Boolean(error || tutorError || (miniGroupsEnabled && (groupsError || membershipsError)));
  const isPageFetching = isFetching || tutorIsFetching || (miniGroupsEnabled && (groupsIsFetching || membershipsIsFetching));
  
  // Invite URLs
  const inviteCode = tutor?.invite_code;
  // Phase 9 (2026-05-25): canonical claim URL sokratai.ru/invite/{code}.
  const inviteWebLink = inviteCode ? getTutorInviteWebLink(inviteCode) : '';
  const inviteTelegramLink = inviteCode ? getTutorInviteTelegramLink(inviteCode) : '';


  useEffect(() => {
    if (miniGroupsEnabled) return;
    setFilters((prev) => ({
      ...prev,
      groupMode: 'all',
      groupId: null,
      tagId: null,
    }));
  }, [miniGroupsEnabled]);

  // Reset page when filters / search change
  useEffect(() => {
    setPage(1);
  }, [filters, sortBy, sortOrder, search]);

  // Get unique subjects for filter
  const groupsById = useMemo(() => {
    const map = new Map<string, TutorGroup>();
    groups.forEach((group) => {
      map.set(group.id, group);
    });
    return map;
  }, [groups]);

  // Несколько групп на ученика (запрос Елены/Егора 2026-06-18): Map<id, membership[]>.
  const membershipsByStudentId = useMemo(() => {
    const map = new Map<string, TutorGroupMembership[]>();
    memberships.forEach((membership) => {
      if (!membership.is_active) return;
      const list = map.get(membership.tutor_student_id);
      if (list) list.push(membership);
      else map.set(membership.tutor_student_id, [membership]);
    });
    return map;
  }, [memberships]);

  // Основные группы (учебные) vs метки (теги). primary → группировка + groupLabel;
  // метки → фильтр + чипы. См. план crispy-soaring-lobster.md.
  const primaryGroups = useMemo(() => groups.filter((g) => g.is_primary), [groups]);
  const tagGroups = useMemo(() => groups.filter((g) => !g.is_primary), [groups]);

  // Cast students to extended type + derive primary group + tags from memberships.
  const studentsWithExtras = useMemo(() => {
    return (students as (TutorStudentWithProfile & {
      paid_until?: string | null;
      last_activity_at?: string | null;
    })[]).map((student) => {
      const ms = membershipsByStudentId.get(student.id) ?? [];
      let primaryGroup: TutorGroup | null = null;
      let primaryMembership: TutorGroupMembership | null = null;
      const tags: TutorGroup[] = [];
      for (const m of ms) {
        // is_primary берём из groupsById (getTutorGroups select('*') — не зависит от
        // nested-select, который deploy-skew мог бы уронить 400, review P1).
        const g = groupsById.get(m.tutor_group_id) ?? m.tutor_group ?? null;
        if (!g) continue;
        if (g.is_primary) {
          if (!primaryGroup) {
            primaryGroup = g;
            primaryMembership = m;
          }
        } else {
          tags.push(g);
        }
      }
      tags.sort((a, b) =>
        (a.short_name?.trim() || a.name).localeCompare(b.short_name?.trim() || b.name, 'ru'),
      );
      return {
        ...student,
        mini_group_membership: primaryMembership,
        mini_group: primaryGroup,
        primary_group: primaryGroup,
        tags,
      } as StudentWithExtras;
    });
  }, [students, membershipsByStudentId, groupsById]);

  // Get unique subjects for filter
  const subjects = useMemo(() => {
    const subjectSet = new Set<string>();
    studentsWithExtras.forEach(s => {
      if (s.subject) subjectSet.add(s.subject);
    });
    return Array.from(subjectSet).sort();
  }, [studentsWithExtras]);

  // Filter students
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return studentsWithExtras.filter(student => {
      // Поиск по имени / username / telegram (маркировка репетитора, не данные ученика).
      if (q) {
        const hay = [
          student.display_name,
          student.profiles?.username,
          student.profiles?.full_name,
          student.profiles?.telegram_username,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      // Payment filter
      if (filters.paymentStatus) {
        const { isPaid } = getPaymentStatus(student.paid_until ?? null);
        if (filters.paymentStatus === 'paid' && !isPaid) return false;
        if (filters.paymentStatus === 'unpaid' && isPaid) return false;
      }

      // Exam type filter
      if (filters.examType && student.exam_type !== filters.examType) return false;

      // Subject filter
      if (filters.subject && student.subject !== filters.subject) return false;

      if (miniGroupsEnabled) {
        const hasGroup = Boolean(student.primary_group);
        if (filters.groupMode === 'grouped' && !hasGroup) return false;
        if (filters.groupMode === 'individual' && hasGroup) return false;
        if (filters.groupId && student.primary_group?.id !== filters.groupId) return false;
        // Фильтр по метке (#интенсив и т.п.).
        if (filters.tagId && !student.tags.some((t) => t.id === filters.tagId)) return false;
      }

      return true;
    });
  }, [studentsWithExtras, filters, search, miniGroupsEnabled]);

  // Sort students
  const sortedStudents = useMemo(() => {
    const sorted = [...filteredStudents];
    
    sorted.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'activity': {
          const aDate = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
          const bDate = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
          comparison = bDate - aDate;
          break;
        }
        case 'name': {
          const aName = a.profiles?.username?.toLowerCase() || '';
          const bName = b.profiles?.username?.toLowerCase() || '';
          comparison = aName.localeCompare(bName, 'ru');
          break;
        }
        case 'progress': {
          const aProgress = calculateProgress(a.current_score, a.target_score);
          const bProgress = calculateProgress(b.current_score, b.target_score);
          comparison = bProgress - aProgress;
          break;
        }
      }
      
      return sortOrder === 'asc' ? -comparison : comparison;
    });
    
    return sorted;
  }, [filteredStudents, sortBy, sortOrder]);

  // Paginate students
  const totalPages = Math.ceil(sortedStudents.length / PAGE_SIZE);
  const paginatedStudents = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedStudents.slice(start, start + PAGE_SIZE);
  }, [sortedStudents, page]);

  // Группировка по основной группе (дефолт): когда нет поиска / фильтра по метке /
  // конкретной группе / режиму — список бьётся секциями по основной группе
  // («Без группы» в конце). Иначе плоский (пагинированный) список. Запрос Егора (скрин 5).
  const isGroupedView =
    miniGroupsEnabled &&
    !search.trim() &&
    !filters.tagId &&
    !filters.groupId &&
    filters.groupMode === 'all' &&
    primaryGroups.length > 0;

  const groupSections = useMemo(() => {
    if (!isGroupedView) return null;
    const byKey = new Map<string, { key: string; label: string; students: StudentWithExtras[] }>();
    for (const s of sortedStudents) {
      const g = s.primary_group;
      const key = g?.id ?? UNASSIGNED_GROUP_KEY;
      const label = g ? (g.short_name?.trim() || g.name.trim()) : 'Без группы';
      const sec = byKey.get(key);
      if (sec) sec.students.push(s);
      else byKey.set(key, { key, label, students: [s] });
    }
    const sections = [...byKey.values()];
    sections.sort((a, b) => {
      if (a.key === UNASSIGNED_GROUP_KEY) return 1;
      if (b.key === UNASSIGNED_GROUP_KEY) return -1;
      return a.label.localeCompare(b.label, 'ru');
    });
    return sections;
  }, [isGroupedView, sortedStudents]);

  // Handlers
  const handleSortChange = useCallback((field: SortField) => {
    setSortBy(field);
  }, []);

  const handleSortOrderToggle = useCallback(() => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  }, []);

  const handleFilterChange = useCallback((newFilters: FilterValues) => {
    setFilters(newFilters);
  }, []);

  const handleCreateGroup = useCallback(async (name: string) => {
    // Создаётся из AddStudentDialog = учебная (основная) группа → is_primary: true.
    const createdGroup = await createTutorGroup({ name, is_primary: true });
    if (!createdGroup) {
      return null;
    }

    refetchGroups();
    return createdGroup;
  }, [refetchGroups]);

  const handleSyncStudentMembership = useCallback(async (tutorStudentId: string, tutorGroupId: string | null) => {
    if (!miniGroupsEnabled) {
      return;
    }

    if (tutorGroupId) {
      const synced = await upsertTutorGroupMembership(tutorStudentId, tutorGroupId);
      if (!synced) {
        throw new Error('Не удалось назначить мини-группу');
      }
    } else {
      const deactivated = await deactivateTutorGroupMembership(tutorStudentId);
      if (!deactivated) {
        throw new Error('Не удалось обновить membership мини-группы');
      }
    }

    refetchMemberships();
  }, [miniGroupsEnabled, refetchMemberships]);

  const handleReset = useCallback(() => {
    setSearch('');
    setFilters({
      paymentStatus: null,
      examType: null,
      subject: null,
      groupMode: 'all',
      groupId: null,
      tagId: null,
    });
    setSortBy('activity');
    setSortOrder('desc');
  }, []);

  const handleOpenStudent = useCallback((id: string) => {
    navigate(`/tutor/students/${id}`);
  }, [navigate]);

  const handleRetryAll = useCallback(() => {
    refetchTutor();
    refetch();
    if (miniGroupsEnabled) {
      refetchGroups();
      refetchMemberships();
    }
  }, [miniGroupsEnabled, refetch, refetchGroups, refetchMemberships, refetchTutor]);

  const handleCredentialsModalOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setCredentialsData(null);
    }
  }, []);

  const handleResetStudentPassword = useCallback(
    async (student: StudentWithExtras) => {
      if (resettingStudentId) {
        return;
      }

      setResettingStudentId(student.student_id);
      try {
        const response = await resetStudentPassword({
          student_id: student.student_id,
        });

        setCredentialsData({
          studentName: student.profiles?.username || 'Ученик',
          loginEmail: response.login_email,
          plainPassword: response.plain_password,
        });
        toast.success('Пароль сброшен');
      } catch (resetError) {
        toast.error(
          resetError instanceof Error
            ? resetError.message
            : 'Не удалось сбросить пароль ученика'
        );
      } finally {
        setResettingStudentId(null);
      }
    },
    [resettingStudentId]
  );

  // Render pagination
  const renderPagination = () => {
    if (totalPages <= 1) return null;

    return (
      <Pagination className="mt-6">
        <PaginationContent>
          {page > 1 && (
            <PaginationItem>
              <PaginationPrevious 
                onClick={() => setPage(p => p - 1)}
                className="cursor-pointer"
              />
            </PaginationItem>
          )}
          
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (page <= 3) {
              pageNum = i + 1;
            } else if (page >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = page - 2 + i;
            }
            
            return (
              <PaginationItem key={pageNum}>
                <PaginationLink
                  onClick={() => setPage(pageNum)}
                  isActive={page === pageNum}
                  className="cursor-pointer"
                >
                  {pageNum}
                </PaginationLink>
              </PaginationItem>
            );
          })}
          
          {page < totalPages && (
            <PaginationItem>
              <PaginationNext 
                onClick={() => setPage(p => p + 1)}
                className="cursor-pointer"
              />
            </PaginationItem>
          )}
        </PaginationContent>
      </Pagination>
    );
  };

  return (
    <>
      <div className="space-y-6">
        <TutorDataStatus
          criticalError={error || tutorError}
          isFetching={isPageFetching}
          onRetry={handleRetryAll}
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">👥 Мои ученики</h1>
            <p className="text-sm text-muted-foreground">
              Все ваши ученики, мини-группы и индивидуальные занятия в одном месте.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={() => setInviteModalOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Добавить ученика
            </Button>
          </div>
        </div>
        
        <AddStudentDialog
          open={inviteModalOpen}
          onOpenChange={setInviteModalOpen}
          inviteCode={inviteCode}
          inviteWebLink={inviteWebLink}
          inviteTelegramLink={inviteTelegramLink}
          miniGroupsEnabled={miniGroupsEnabled}
          groups={primaryGroups}
          onCreateGroup={handleCreateGroup}
          onSyncStudentMembership={handleSyncStudentMembership}
          onManualAdded={(tutorStudentId) => {
            refetch();
            if (miniGroupsEnabled) {
              refetchMemberships();
            }
            navigate(`/tutor/students/${tutorStudentId}`);
          }}
        />

        {/* Sub-tabs: Ученики (список) / Успеваемость (обзор R2) */}
        <div role="tablist" aria-label="Раздел учеников" className="flex gap-1 border-b border-slate-200">
          {([
            { key: 'students', label: 'Ученики' },
            { key: 'progress', label: 'Успеваемость' },
          ] as const).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={view === t.key}
              onClick={() => setSearchParams(t.key === 'students' ? {} : { view: 'progress' }, { replace: true })}
              className={`min-h-[40px] -mb-px border-b-2 px-4 text-sm font-medium transition-colors touch-manipulation ${
                view === t.key ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {view === 'progress' ? (
          <Suspense fallback={<StudentsSkeleton />}>
            <StudentsProgressOverview />
          </Suspense>
        ) : (
        <>
        {/* Архив-тоггл (запрос Елены 2026-06-17) */}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
            className="text-muted-foreground"
          >
            {showArchived ? (
              <><ArrowLeft className="h-4 w-4 mr-1.5" /> К активным</>
            ) : (
              <><Archive className="h-4 w-4 mr-1.5" /> Архив</>
            )}
          </Button>
        </div>

        {showArchived ? (
          <div className="space-y-3">
            {archivedLoading ? (
              <StudentsSkeleton />
            ) : archivedStudents.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-muted-foreground">
                В архиве пока нет учеников. Архивировать можно в профиле ученика.
              </p>
            ) : (
              archivedStudents.map((student) => (
                <StudentCard
                  key={student.id}
                  student={student}
                  onCredentialsClick={() => { void handleResetStudentPassword(student as StudentWithExtras); }}
                  isResettingCredentials={resettingStudentId === student.student_id}
                  onClick={() => handleOpenStudent(student.id)}
                  onUnarchive={() => { void handleUnarchive(student.id); }}
                  isUnarchiving={unarchivingId === student.id}
                />
              ))
            )}
          </div>
        ) : (
        <>
        {/* Loading state */}
        {initialLoading && <StudentsSkeleton />}

        {/* Error state */}
        {hasErrors && !initialLoading && students.length === 0 && <StudentsError onRetry={handleRetryAll} />}

        {/* Empty state */}
        {!initialLoading && !hasErrors && students.length === 0 && (
          <StudentsEmpty />
        )}

        {/* Content */}
        {students.length > 0 && (
          <>
            {/* Toolbar */}
            <StudentsToolbar
              sortBy={sortBy}
              sortOrder={sortOrder}
              search={search}
              filters={filters}
              subjects={subjects}
              groups={primaryGroups}
              tags={tagGroups}
              showGroupControls={miniGroupsEnabled}
              totalCount={studentsWithExtras.length}
              filteredCount={filteredStudents.length}
              onSearchChange={setSearch}
              onSortChange={handleSortChange}
              onSortOrderToggle={handleSortOrderToggle}
              onFilterChange={handleFilterChange}
              onReset={handleReset}
            />

            {/* Empty after filters */}
            {filteredStudents.length === 0 && (
              <StudentsEmptyFilters onReset={handleReset} />
            )}

            {/* Student cards — сгруппированы по основной группе (дефолт) или плоский список */}
            {filteredStudents.length > 0 &&
              (groupSections ? (
                <div className="space-y-5">
                  {groupSections.map((section) => (
                    <div key={section.key} className="space-y-2.5">
                      <div className="flex items-center gap-2 px-1">
                        <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
                        <h3 className="text-sm font-semibold text-slate-700">{section.label}</h3>
                        <span className="text-xs text-slate-400">{section.students.length}</span>
                      </div>
                      <div className="space-y-3">
                        {section.students.map((student) => (
                          <StudentCard
                            key={student.id}
                            student={student}
                            tags={student.tags.map((t) => ({
                              id: t.id,
                              name: t.short_name?.trim() || t.name,
                              color: t.color,
                            }))}
                            onCredentialsClick={() => {
                              void handleResetStudentPassword(student);
                            }}
                            isResettingCredentials={resettingStudentId === student.student_id}
                            onClick={() => handleOpenStudent(student.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {paginatedStudents.map((student) => (
                      <StudentCard
                        key={student.id}
                        student={student}
                        groupLabel={
                          miniGroupsEnabled
                            ? student.primary_group?.short_name || student.primary_group?.name || null
                            : null
                        }
                        tags={student.tags.map((t) => ({
                          id: t.id,
                          name: t.short_name?.trim() || t.name,
                          color: t.color,
                        }))}
                        onCredentialsClick={() => {
                          void handleResetStudentPassword(student);
                        }}
                        isResettingCredentials={resettingStudentId === student.student_id}
                        onClick={() => handleOpenStudent(student.id)}
                      />
                    ))}
                  </div>
                  {renderPagination()}
                </>
              ))}
          </>
        )}
        </>
        )}
        </>
        )}
      </div>

      {credentialsData && (
        <StudentCredentialsModal
          open={Boolean(credentialsData)}
          onOpenChange={handleCredentialsModalOpenChange}
          studentName={credentialsData.studentName}
          loginEmail={credentialsData.loginEmail}
          plainPassword={credentialsData.plainPassword}
        />
      )}
    </>
  );
}

export default function TutorStudents() {
  return <TutorStudentsContent />;
}
