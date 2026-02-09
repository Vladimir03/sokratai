import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { 
  Pagination, 
  PaginationContent, 
  PaginationItem, 
  PaginationLink, 
  PaginationNext, 
  PaginationPrevious 
} from '@/components/ui/pagination';
import { UserPlus } from 'lucide-react';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { StudentCard } from '@/components/tutor/StudentCard';
import { AddStudentDialog } from '@/components/tutor/AddStudentDialog';
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
import { useTutorStudents, useTutor } from '@/hooks/useTutor';
import { calculateProgress, getPaymentStatus } from '@/lib/formatters';
import { getTutorInviteWebLink, getTutorInviteTelegramLink } from '@/utils/telegramLinks';
import type { TutorStudentWithProfile } from '@/types/tutor';

const PAGE_SIZE = 10;

// Extended type with new fields
type StudentWithExtras = TutorStudentWithProfile & {
  paid_until?: string | null;
  last_activity_at?: string | null;
};

function TutorStudentsContent() {
  const navigate = useNavigate();
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
  
  // State
  const [sortBy, setSortBy] = useState<SortField>('activity');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filters, setFilters] = useState<FilterValues>({
    paymentStatus: null,
    examType: null,
    subject: null,
  });
  const [page, setPage] = useState(1);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const initialLoading = loading && students.length === 0 && !error;
  const hasErrors = Boolean(error || tutorError);
  const isPageFetching = isFetching || tutorIsFetching;
  const isPageRecovering = isRecovering || tutorIsRecovering;
  const pageFailureCount = Math.max(failureCount, tutorFailureCount);
  
  // Invite URLs
  const inviteCode = tutor?.invite_code;
  const inviteWebLink = inviteCode ? getTutorInviteWebLink(inviteCode) : '';
  const inviteTelegramLink = inviteCode ? getTutorInviteTelegramLink(inviteCode) : '';

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filters, sortBy, sortOrder]);

  // Get unique subjects for filter
  const subjects = useMemo(() => {
    const subjectSet = new Set<string>();
    students.forEach(s => {
      if (s.subject) subjectSet.add(s.subject);
    });
    return Array.from(subjectSet).sort();
  }, [students]);

  // Cast students to extended type
  const studentsWithExtras = students as StudentWithExtras[];

  // Filter students
  const filteredStudents = useMemo(() => {
    return studentsWithExtras.filter(student => {
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
      
      return true;
    });
  }, [studentsWithExtras, filters]);

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

  const handleReset = useCallback(() => {
    setFilters({ paymentStatus: null, examType: null, subject: null });
    setSortBy('activity');
    setSortOrder('desc');
  }, []);

  const handleOpenStudent = useCallback((id: string) => {
    navigate(`/tutor/students/${id}`);
  }, [navigate]);

  const handleRetryAll = useCallback(() => {
    refetchTutor();
    refetch();
  }, [refetchTutor, refetch]);

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
    <TutorLayout>
      <div className="space-y-6">
        <TutorDataStatus
          error={error || tutorError}
          isFetching={isPageFetching}
          isRecovering={isPageRecovering}
          failureCount={pageFailureCount}
          onRetry={handleRetryAll}
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold">👥 Мои ученики</h1>
          <Button onClick={() => setInviteModalOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Добавить ученика
          </Button>
        </div>
        
        <AddStudentDialog
          open={inviteModalOpen}
          onOpenChange={setInviteModalOpen}
          inviteCode={inviteCode}
          inviteWebLink={inviteWebLink}
          inviteTelegramLink={inviteTelegramLink}
          onManualAdded={(tutorStudentId) => {
            refetch();
            navigate(`/tutor/students/${tutorStudentId}`);
          }}
        />

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
              filters={filters}
              subjects={subjects}
              totalCount={students.length}
              filteredCount={filteredStudents.length}
              onSortChange={handleSortChange}
              onSortOrderToggle={handleSortOrderToggle}
              onFilterChange={handleFilterChange}
              onReset={handleReset}
            />

            {/* Empty after filters */}
            {filteredStudents.length === 0 && (
              <StudentsEmptyFilters onReset={handleReset} />
            )}

            {/* Student cards */}
            {filteredStudents.length > 0 && (
              <div className="space-y-3">
                {paginatedStudents.map(student => (
                  <StudentCard
                    key={student.id}
                    student={student}
                    onClick={() => handleOpenStudent(student.id)}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {renderPagination()}
          </>
        )}
      </div>
    </TutorLayout>
  );
}

export default function TutorStudents() {
  return (
    <TutorGuard>
      <TutorStudentsContent />
    </TutorGuard>
  );
}
