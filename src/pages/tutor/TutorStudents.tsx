import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { 
  Pagination, 
  PaginationContent, 
  PaginationItem, 
  PaginationLink, 
  PaginationNext, 
  PaginationPrevious 
} from '@/components/ui/pagination';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus, Copy, ExternalLink, Check } from 'lucide-react';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { StudentCard } from '@/components/tutor/StudentCard';
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
import { manualAddTutorStudent } from '@/lib/tutors';
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
  const { tutor } = useTutor();
  const { students, loading, error, refetch } = useTutorStudents();
  
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
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeTab, setActiveTab] = useState<'invite' | 'manual'>('invite');
  const [manualName, setManualName] = useState('');
  const [manualTelegram, setManualTelegram] = useState('');
  const [manualLearningGoalPreset, setManualLearningGoalPreset] = useState<string>('');
  const [manualLearningGoalOther, setManualLearningGoalOther] = useState('');
  const [manualParentContact, setManualParentContact] = useState('');
  const [manualGrade, setManualGrade] = useState('');
  const [manualExamType, setManualExamType] = useState<'ege' | 'oge' | ''>('');
  const [manualSubject, setManualSubject] = useState('');
  const [manualStartScore, setManualStartScore] = useState('');
  const [manualTargetScore, setManualTargetScore] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  
  // Invite URLs
  const inviteCode = tutor?.invite_code;
  const inviteWebLink = inviteCode ? getTutorInviteWebLink(inviteCode) : '';
  const inviteTelegramLink = inviteCode ? getTutorInviteTelegramLink(inviteCode) : '';
  
  const handleCopyLink = async () => {
    if (!inviteWebLink) return;
    try {
      await navigator.clipboard.writeText(inviteWebLink);
      setCopiedLink(true);
      toast.success('Ссылка скопирована');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };
  
  const handleOpenTelegram = () => {
    if (inviteTelegramLink) {
      window.open(inviteTelegramLink, '_blank');
    }
  };

  const resetManualForm = useCallback(() => {
    setManualName('');
    setManualTelegram('');
    setManualLearningGoalPreset('');
    setManualLearningGoalOther('');
    setManualParentContact('');
    setManualGrade('');
    setManualExamType('');
    setManualSubject('');
    setManualStartScore('');
    setManualTargetScore('');
    setManualNotes('');
  }, []);

  const handleManualSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = manualName.trim();
    const telegramUsername = manualTelegram.trim();
    const learningGoal = manualLearningGoalPreset === 'other'
      ? manualLearningGoalOther.trim()
      : manualLearningGoalPreset.trim();

    if (!name) {
      toast.error('Укажите имя ученика');
      return;
    }

    if (!telegramUsername) {
      toast.error('Укажите Telegram username');
      return;
    }

    if (!learningGoal) {
      toast.error('Укажите цель занятий');
      return;
    }

    const grade = manualGrade ? Number(manualGrade) : undefined;
    const startScore = manualStartScore ? Number(manualStartScore) : undefined;
    const targetScore = manualTargetScore ? Number(manualTargetScore) : undefined;

    setManualSubmitting(true);
    try {
      const response = await manualAddTutorStudent({
        name,
        telegram_username: telegramUsername,
        grade: Number.isFinite(grade) ? grade : undefined,
        exam_type: manualExamType || undefined,
        subject: manualSubject.trim() || undefined,
        start_score: Number.isFinite(startScore) ? startScore : undefined,
        target_score: Number.isFinite(targetScore) ? targetScore : undefined,
        notes: manualNotes.trim() || undefined,
        parent_contact: manualParentContact.trim() || undefined,
        learning_goal: learningGoal,
      });

      toast.success('Ученик добавлен');
      setInviteModalOpen(false);
      resetManualForm();
      refetch();
      navigate(`/tutor/students/${response.tutor_student_id}`);
    } catch (error: any) {
      console.error('Manual add student error:', error);
      toast.error(error.message || 'Не удалось добавить ученика');
    } finally {
      setManualSubmitting(false);
    }
  }, [
    manualName,
    manualTelegram,
    manualGrade,
    manualExamType,
    manualSubject,
    manualStartScore,
    manualTargetScore,
    manualNotes,
    manualParentContact,
    manualLearningGoalPreset,
    manualLearningGoalOther,
    navigate,
    refetch,
    resetManualForm,
  ]);

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
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold">👥 Мои ученики</h1>
          <Button onClick={() => setInviteModalOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Добавить ученика
          </Button>
        </div>
        
        {/* Invite Modal */}
        <Dialog
          open={inviteModalOpen}
          onOpenChange={(open) => {
            setInviteModalOpen(open);
            if (!open) {
              setActiveTab('invite');
            }
          }}
        >
          <DialogContent className="max-w-2xl flex flex-col">
            <DialogHeader>
              <DialogTitle>Добавить ученика</DialogTitle>
              <DialogDescription>
                Можно отправить ссылку для подключения к AI-помощнику или добавить ученика вручную.
              </DialogDescription>
            </DialogHeader>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'invite' | 'manual')} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="invite">По ссылке</TabsTrigger>
                <TabsTrigger value="manual">Вручную</TabsTrigger>
              </TabsList>

              <TabsContent value="invite" className="min-h-0">
                <ScrollArea className="h-[70vh] pr-4">
                  <div className="space-y-6 py-4">
                  {/* QR Code */}
                  {inviteWebLink && (
                    <div className="flex justify-center">
                      <div className="bg-white p-3 rounded-lg shadow-sm">
                        <QRCode value={inviteWebLink} size={160} level="M" />
                      </div>
                    </div>
                  )}
                  
                  {/* Link display */}
                  <div className="bg-muted p-3 rounded-md text-sm font-mono break-all text-center">
                    {inviteWebLink || 'Загрузка...'}
                  </div>
                  
                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button 
                      onClick={handleCopyLink} 
                      variant="outline" 
                      className="flex-1"
                      disabled={!inviteCode}
                    >
                      {copiedLink ? (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Скопировано
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-2" />
                          Скопировать ссылку
                        </>
                      )}
                    </Button>
                    
                    <Button 
                      onClick={handleOpenTelegram}
                      className="flex-1"
                      disabled={!inviteCode}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Открыть Telegram
                    </Button>
                  </div>
                  
                  {/* Instructions */}
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>1. Ученик открывает ссылку или сканирует QR-код</p>
                    <p>2. Переходит в Telegram и нажимает «Начать»</p>
                    <p>3. Автоматически появляется в вашем списке учеников</p>
                  </div>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="manual" className="min-h-0">
                <ScrollArea className="h-[70vh] pr-4">
                  <form onSubmit={handleManualSubmit} className="space-y-6 py-4">
                    <div className="flex justify-between items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setActiveTab('invite')}
                        className="px-0"
                      >
                        Назад к ссылке
                      </Button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="manualName">Имя ученика</Label>
                        <Input
                          id="manualName"
                          value={manualName}
                          onChange={(e) => setManualName(e.target.value)}
                          placeholder="Например, Лера"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="manualTelegram">Telegram username</Label>
                        <Input
                          id="manualTelegram"
                          value={manualTelegram}
                          onChange={(e) => setManualTelegram(e.target.value)}
                          placeholder="@username"
                          required
                        />
                        <p className="text-xs text-muted-foreground">
                          Укажите @username ученика, по нему привяжем Telegram при подключении.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Цель занятий</Label>
                        <Select
                          value={manualLearningGoalPreset || undefined}
                          onValueChange={(value) => setManualLearningGoalPreset(value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите цель" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ЕГЭ">ЕГЭ</SelectItem>
                            <SelectItem value="ОГЭ">ОГЭ</SelectItem>
                            <SelectItem value="Школьная программа">Школьная программа</SelectItem>
                            <SelectItem value="Олимпиада">Олимпиада</SelectItem>
                            <SelectItem value="other">Другое</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {manualLearningGoalPreset === 'other' && (
                        <div className="space-y-2">
                          <Label htmlFor="manualLearningGoalOther">Опишите цель</Label>
                          <Input
                            id="manualLearningGoalOther"
                            value={manualLearningGoalOther}
                            onChange={(e) => setManualLearningGoalOther(e.target.value)}
                            placeholder="Например, подготовка к ЕГЭ"
                            required
                          />
                        </div>
                      )}
                    </div>

                    <Accordion type="single" collapsible>
                      <AccordionItem value="optional">
                        <AccordionTrigger>Дополнительные данные</AccordionTrigger>
                        <AccordionContent>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="manualParentContact">Контакт родителя</Label>
                              <Input
                                id="manualParentContact"
                                value={manualParentContact}
                                onChange={(e) => setManualParentContact(e.target.value)}
                                placeholder="+7 999 123-45-67 или @telegram"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="manualGrade">Класс</Label>
                              <Input
                                id="manualGrade"
                                type="number"
                                min={1}
                                max={11}
                                value={manualGrade}
                                onChange={(e) => setManualGrade(e.target.value)}
                                placeholder="Например, 10"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Экзамен</Label>
                              <Select
                                value={manualExamType || undefined}
                                onValueChange={(value) => setManualExamType(value as 'ege' | 'oge' | '')}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Не выбран" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ege">ЕГЭ</SelectItem>
                                  <SelectItem value="oge">ОГЭ</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="manualSubject">Предмет</Label>
                              <Input
                                id="manualSubject"
                                value={manualSubject}
                                onChange={(e) => setManualSubject(e.target.value)}
                                placeholder="Математика"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="manualStartScore">Стартовый балл</Label>
                              <Input
                                id="manualStartScore"
                                type="number"
                                min={0}
                                max={100}
                                value={manualStartScore}
                                onChange={(e) => setManualStartScore(e.target.value)}
                                placeholder="Например, 50"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="manualTargetScore">Целевой балл</Label>
                              <Input
                                id="manualTargetScore"
                                type="number"
                                min={0}
                                max={100}
                                value={manualTargetScore}
                                onChange={(e) => setManualTargetScore(e.target.value)}
                                placeholder="Например, 85"
                              />
                            </div>
                          </div>

                          <div className="space-y-2 mt-4">
                            <Label htmlFor="manualNotes">Заметки</Label>
                            <Textarea
                              id="manualNotes"
                              value={manualNotes}
                              onChange={(e) => setManualNotes(e.target.value)}
                              placeholder="Дополнительные детали о ученике"
                              rows={3}
                            />
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={resetManualForm} disabled={manualSubmitting}>
                        Очистить
                      </Button>
                      <Button type="submit" disabled={manualSubmitting}>
                        {manualSubmitting ? 'Добавляем...' : 'Добавить ученика'}
                      </Button>
                    </div>
                  </form>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        {/* Loading state */}
        {loading && <StudentsSkeleton />}

        {/* Error state */}
        {error && !loading && <StudentsError onRetry={refetch} />}

        {/* Empty state */}
        {!loading && !error && students.length === 0 && (
          <StudentsEmpty />
        )}

        {/* Content */}
        {!loading && !error && students.length > 0 && (
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
