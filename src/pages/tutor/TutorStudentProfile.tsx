import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Plus, Trash2, MessageSquare, ChevronRight, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { 
  useTutorStudent, 
  useMockExams, 
  useStudentChats, 
  useStudentChatMessages 
} from '@/hooks/useTutor';
import { 
  updateTutorStudent, 
  createMockExam, 
  deleteMockExam,
  removeStudentFromTutor,
  updateTutorStudentProfile
} from '@/lib/tutors';
import { 
  formatRelativeTime, 
  calculateProgress, 
  getPaymentStatus, 
  getInitials, 
  formatExamType 
} from '@/lib/formatters';
import type { MockExam } from '@/types/tutor';

// =============================================
// Компонент профиля ученика
// =============================================

function TutorStudentProfileContent() {
  const { tutorStudentId } = useParams<{ tutorStudentId: string }>();
  const navigate = useNavigate();
  
  const { student, loading, error, refetch } = useTutorStudent(tutorStudentId);
  const { mockExams, loading: mockExamsLoading, refetch: refetchMockExams } = useMockExams(tutorStudentId);
  const { chats, loading: chatsLoading } = useStudentChats(student?.student_id);
  
  // Локальное состояние для редактирования
  const [notes, setNotes] = useState<string>('');
  const [parentContact, setParentContact] = useState<string>('');
  const [lastLessonAt, setLastLessonAt] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [notesInitialized, setNotesInitialized] = useState(false);
  
  // Диалоги
  const [addMockExamOpen, setAddMockExamOpen] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [deleteStudentOpen, setDeleteStudentOpen] = useState(false);
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);
  const [editStudentOpen, setEditStudentOpen] = useState(false);
  const [isUpdatingStudent, setIsUpdatingStudent] = useState(false);
  const [editFormInitialized, setEditFormInitialized] = useState(false);

  const [editName, setEditName] = useState('');
  const [editTelegram, setEditTelegram] = useState('');
  const [editLearningGoalPreset, setEditLearningGoalPreset] = useState('');
  const [editLearningGoalOther, setEditLearningGoalOther] = useState('');
  const [editParentContact, setEditParentContact] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [editExamType, setEditExamType] = useState<'ege' | 'oge' | ''>('');
  const [editSubject, setEditSubject] = useState('');
  const [editStartScore, setEditStartScore] = useState('');
  const [editTargetScore, setEditTargetScore] = useState('');
  const [editNotes, setEditNotes] = useState('');
  
  // Инициализация полей при загрузке студента
  if (student && !notesInitialized) {
    setNotes(student.notes || '');
    setParentContact(student.parent_contact || '');
    setLastLessonAt(student.last_lesson_at || '');
    setNotesInitialized(true);
  }

  if (student && !editFormInitialized) {
    const learningGoal = student.profiles?.learning_goal || '';
    const presetOptions = ['ЕГЭ', 'ОГЭ', 'Школьная программа', 'Олимпиада'];
    const isPreset = presetOptions.includes(learningGoal);

    setEditName(student.profiles?.username || '');
    setEditTelegram(student.profiles?.telegram_username || '');
    setEditLearningGoalPreset(isPreset ? learningGoal : learningGoal ? 'other' : '');
    setEditLearningGoalOther(isPreset ? '' : learningGoal);
    setEditParentContact(student.parent_contact || '');
    setEditGrade(student.profiles?.grade ? String(student.profiles.grade) : '');
    setEditExamType(student.exam_type || '');
    setEditSubject(student.subject || '');
    setEditStartScore(student.start_score ? String(student.start_score) : '');
    setEditTargetScore(student.target_score ? String(student.target_score) : '');
    setEditNotes(student.notes || '');
    setEditFormInitialized(true);
  }
  
  // Сохранение изменений
  const handleSave = useCallback(async () => {
    if (!tutorStudentId) return;
    
    setIsSaving(true);
    try {
      await updateTutorStudent(tutorStudentId, {
        notes,
        parent_contact: parentContact || undefined,
        last_lesson_at: lastLessonAt || undefined,
      });
      toast.success('Изменения сохранены');
      refetch();
    } catch (err) {
      console.error('Error saving:', err);
      toast.error('Ошибка сохранения');
    } finally {
      setIsSaving(false);
    }
  }, [tutorStudentId, notes, parentContact, lastLessonAt, refetch]);

  const handleDeleteStudent = useCallback(async () => {
    if (!tutorStudentId) return;
    setIsDeletingStudent(true);
    try {
      const success = await removeStudentFromTutor(tutorStudentId);
      if (!success) {
        toast.error('Не удалось удалить ученика');
        return;
      }
      toast.success('Ученик удалён');
      navigate('/tutor/students');
    } catch (error) {
      console.error('Error deleting student:', error);
      toast.error('Не удалось удалить ученика');
    } finally {
      setIsDeletingStudent(false);
      setDeleteStudentOpen(false);
    }
  }, [navigate, tutorStudentId]);

  const handleUpdateStudent = useCallback(async () => {
    if (!tutorStudentId) return;
    const name = editName.trim();
    const telegramUsername = editTelegram.trim();
    const learningGoal = editLearningGoalPreset === 'other'
      ? editLearningGoalOther.trim()
      : editLearningGoalPreset.trim();

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

    const grade = editGrade ? Number(editGrade) : undefined;
    const startScore = editStartScore ? Number(editStartScore) : undefined;
    const targetScore = editTargetScore ? Number(editTargetScore) : undefined;

    setIsUpdatingStudent(true);
    try {
      await updateTutorStudentProfile({
        tutor_student_id: tutorStudentId,
        name,
        telegram_username: telegramUsername,
        learning_goal: learningGoal,
        grade: Number.isFinite(grade) ? grade : undefined,
        exam_type: editExamType || undefined,
        subject: editSubject.trim() || undefined,
        start_score: Number.isFinite(startScore) ? startScore : undefined,
        target_score: Number.isFinite(targetScore) ? targetScore : undefined,
        parent_contact: editParentContact.trim() || undefined,
        notes: editNotes.trim() || undefined,
      });
      toast.success('Данные ученика обновлены');
      setEditStudentOpen(false);
      setEditFormInitialized(false);
      refetch();
    } catch (error: any) {
      console.error('Error updating student:', error);
      toast.error(error.message || 'Не удалось обновить ученика');
    } finally {
      setIsUpdatingStudent(false);
    }
  }, [
    tutorStudentId,
    editName,
    editTelegram,
    editLearningGoalPreset,
    editLearningGoalOther,
    editGrade,
    editExamType,
    editSubject,
    editStartScore,
    editTargetScore,
    editParentContact,
    editNotes,
    refetch,
  ]);
  
  // Загрузка
  if (loading) {
    return (
      <TutorLayout>
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </TutorLayout>
    );
  }
  
  // Ошибка или не найден
  if (error || !student) {
    return (
      <TutorLayout>
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground mb-4">
            {error || 'Ученик не найден'}
          </p>
          <Button onClick={() => navigate('/tutor/students')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Назад к списку
          </Button>
        </div>
      </TutorLayout>
    );
  }
  
  const displayName = student.profiles?.username || 'Без имени';
  const grade = student.profiles?.grade;
  const examType = formatExamType(student.exam_type);
  const subject = student.subject;
  const progress = calculateProgress(student.current_score, student.target_score);
  const paymentStatus = getPaymentStatus(student.paid_until);
  
  return (
    <TutorLayout>
      <div className="space-y-6">
        {/* Хедер с навигацией */}
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => navigate('/tutor/students')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold flex-1">Профиль ученика</h1>
          <Button
            variant="outline"
            onClick={() => setEditStudentOpen(true)}
          >
            <Edit className="h-4 w-4 mr-2" />
            Редактировать
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDeleteStudentOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Удалить ученика
          </Button>
        </div>
        
        {/* Карточка-шапка */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="bg-primary/10 text-primary text-xl font-semibold">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-semibold">{displayName}</h2>
                  <Badge variant={student.status === 'active' ? 'default' : 'secondary'}>
                    {student.status === 'active' ? 'Активен' : 
                     student.status === 'paused' ? 'Пауза' : 'Завершён'}
                  </Badge>
                </div>
                
                <p className="text-muted-foreground">
                  {[
                    grade ? `${grade} класс` : null,
                    examType,
                    subject,
                  ].filter(Boolean).join(' • ') || 'Не указано'}
                </p>
                
                <div className="flex items-center gap-4 text-sm flex-wrap">
                  <span className={paymentStatus.isPaid ? 'text-green-600' : 'text-amber-600'}>
                    Оплата: {paymentStatus.label}
                  </span>
                  {student.profiles?.telegram_username && (
                    <span className="text-muted-foreground">
                      @{student.profiles.telegram_username}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Вкладки */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="notes">Заметки</TabsTrigger>
            <TabsTrigger value="mockexams">Пробники</TabsTrigger>
            <TabsTrigger value="dialogs">AI-диалоги</TabsTrigger>
          </TabsList>
          
          {/* Вкладка: Обзор */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Прогресс</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold">{student.start_score || '—'}</p>
                    <p className="text-sm text-muted-foreground">Старт</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-primary">{student.current_score || '—'}</p>
                    <p className="text-sm text-muted-foreground">Текущий</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{student.target_score || '—'}</p>
                    <p className="text-sm text-muted-foreground">Цель</p>
                  </div>
                </div>
                
                {student.target_score && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>Прогресс к цели</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Контакты и занятия</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="parentContact">Контакт родителя</Label>
                    <Input
                      id="parentContact"
                      value={parentContact}
                      onChange={(e) => setParentContact(e.target.value)}
                      placeholder="+7 999 123-45-67 или @telegram"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastLessonAt">Последнее занятие</Label>
                    <Input
                      id="lastLessonAt"
                      type="date"
                      value={lastLessonAt}
                      onChange={(e) => setLastLessonAt(e.target.value)}
                    />
                  </div>
                </div>
                
                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={isSaving}>
                    <Save className="h-4 w-4 mr-2" />
                    {isSaving ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* Вкладка: Заметки */}
          <TabsContent value="notes">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Заметки репетитора</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ваши заметки об ученике..."
                  className="min-h-[200px]"
                />
                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={isSaving}>
                    <Save className="h-4 w-4 mr-2" />
                    {isSaving ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* Вкладка: Пробники */}
          <TabsContent value="mockexams" className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium">Результаты пробников</h3>
              <Button size="sm" onClick={() => setAddMockExamOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить
              </Button>
            </div>
            
            {mockExamsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : mockExams.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Пробники пока не добавлены
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {mockExams.map((exam) => (
                  <MockExamCard 
                    key={exam.id} 
                    exam={exam} 
                    onDelete={async () => {
                      await deleteMockExam(exam.id);
                      refetchMockExams();
                      toast.success('Пробник удалён');
                    }}
                  />
                ))}
              </div>
            )}
            
            {/* Диалог добавления пробника */}
            <AddMockExamDialog
              open={addMockExamOpen}
              onOpenChange={setAddMockExamOpen}
              tutorStudentId={tutorStudentId!}
              onSuccess={() => {
                refetchMockExams();
                toast.success('Пробник добавлен');
              }}
            />
          </TabsContent>
          
          {/* Вкладка: AI-диалоги */}
          <TabsContent value="dialogs" className="space-y-4">
            {chatsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : chats.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  У ученика пока нет диалогов с AI
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {chats.map((chat) => (
                  <Card 
                    key={chat.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => setSelectedChatId(chat.id)}
                  >
                    <CardContent className="py-3 flex items-center gap-3">
                      <MessageSquare className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {chat.title || getChatTypeLabel(chat.chat_type)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatRelativeTime(chat.last_message_at)}
                        </p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            
            {/* Диалог просмотра сообщений */}
            <ChatMessagesDialog
              chatId={selectedChatId}
              onClose={() => setSelectedChatId(null)}
            />
          </TabsContent>
        </Tabs>

        <Dialog open={deleteStudentOpen} onOpenChange={setDeleteStudentOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Удалить ученика?</DialogTitle>
              <DialogDescription>
                Ученик будет удалён из вашего списка. Аккаунт ученика останется в системе.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDeleteStudentOpen(false)}
                disabled={isDeletingStudent}
              >
                Отмена
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeleteStudent}
                disabled={isDeletingStudent}
              >
                {isDeletingStudent ? 'Удаление...' : 'Удалить'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editStudentOpen} onOpenChange={setEditStudentOpen}>
          <DialogContent className="max-w-2xl flex flex-col">
            <DialogHeader>
              <DialogTitle>Редактировать ученика</DialogTitle>
              <DialogDescription>
                Обновите данные ученика. Обязательные поля отмечены.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="h-[70vh] pr-4">
              <div className="space-y-6 py-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editName">Имя ученика</Label>
                    <Input
                      id="editName"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Например, Лера"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="editTelegram">Telegram username</Label>
                    <Input
                      id="editTelegram"
                      value={editTelegram}
                      onChange={(e) => setEditTelegram(e.target.value)}
                      placeholder="@username"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Цель занятий</Label>
                    <Select
                      value={editLearningGoalPreset || undefined}
                      onValueChange={(value) => setEditLearningGoalPreset(value)}
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

                  {editLearningGoalPreset === 'other' && (
                    <div className="space-y-2">
                      <Label htmlFor="editLearningGoalOther">Опишите цель</Label>
                      <Input
                        id="editLearningGoalOther"
                        value={editLearningGoalOther}
                        onChange={(e) => setEditLearningGoalOther(e.target.value)}
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
                          <Label htmlFor="editParentContact">Контакт родителя</Label>
                          <Input
                            id="editParentContact"
                            value={editParentContact}
                            onChange={(e) => setEditParentContact(e.target.value)}
                            placeholder="+7 999 123-45-67 или @telegram"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="editGrade">Класс</Label>
                          <Input
                            id="editGrade"
                            type="number"
                            min={1}
                            max={11}
                            value={editGrade}
                            onChange={(e) => setEditGrade(e.target.value)}
                            placeholder="Например, 10"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Экзамен</Label>
                          <Select
                            value={editExamType || undefined}
                            onValueChange={(value) => setEditExamType(value as 'ege' | 'oge' | '')}
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
                          <Label htmlFor="editSubject">Предмет</Label>
                          <Input
                            id="editSubject"
                            value={editSubject}
                            onChange={(e) => setEditSubject(e.target.value)}
                            placeholder="Математика"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="editStartScore">Стартовый балл</Label>
                          <Input
                            id="editStartScore"
                            type="number"
                            min={0}
                            max={100}
                            value={editStartScore}
                            onChange={(e) => setEditStartScore(e.target.value)}
                            placeholder="Например, 50"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="editTargetScore">Целевой балл</Label>
                          <Input
                            id="editTargetScore"
                            type="number"
                            min={0}
                            max={100}
                            value={editTargetScore}
                            onChange={(e) => setEditTargetScore(e.target.value)}
                            placeholder="Например, 85"
                          />
                        </div>
                      </div>

                      <div className="space-y-2 mt-4">
                        <Label htmlFor="editNotes">Заметки</Label>
                        <Textarea
                          id="editNotes"
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          placeholder="Дополнительные детали о ученике"
                          rows={3}
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setEditStudentOpen(false)}
                    disabled={isUpdatingStudent}
                  >
                    Отмена
                  </Button>
                  <Button type="button" onClick={handleUpdateStudent} disabled={isUpdatingStudent}>
                    {isUpdatingStudent ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </TutorLayout>
  );
}

// =============================================
// Вспомогательные компоненты
// =============================================

function MockExamCard({ exam, onDelete }: { exam: MockExam; onDelete: () => void }) {
  const [isDeleting, setIsDeleting] = useState(false);
  
  const handleDelete = async () => {
    setIsDeleting(true);
    await onDelete();
    setIsDeleting(false);
  };
  
  return (
    <Card>
      <CardContent className="py-3 flex items-center gap-4">
        <div className="flex-1">
          <p className="font-medium">
            {exam.score}{exam.max_score ? ` / ${exam.max_score}` : ''} баллов
          </p>
          <p className="text-sm text-muted-foreground">
            {new Date(exam.date).toLocaleDateString('ru-RU')}
            {exam.notes && ` • ${exam.notes}`}
          </p>
        </div>
        <Button 
          variant="ghost" 
          size="icon"
          disabled={isDeleting}
          onClick={handleDelete}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </CardContent>
    </Card>
  );
}

function AddMockExamDialog({ 
  open, 
  onOpenChange, 
  tutorStudentId,
  onSuccess 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  tutorStudentId: string;
  onSuccess: () => void;
}) {
  const [date, setDate] = useState('');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [examNotes, setExamNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  const handleSubmit = async () => {
    if (!date || !score) {
      toast.error('Укажите дату и балл');
      return;
    }
    
    setIsSaving(true);
    try {
      await createMockExam({
        tutor_student_id: tutorStudentId,
        date,
        score: parseInt(score, 10),
        max_score: maxScore ? parseInt(maxScore, 10) : undefined,
        notes: examNotes || undefined,
      });
      onSuccess();
      onOpenChange(false);
      // Reset form
      setDate('');
      setScore('');
      setMaxScore('');
      setExamNotes('');
    } catch (err) {
      console.error('Error creating mock exam:', err);
      toast.error('Ошибка сохранения');
    } finally {
      setIsSaving(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить результат пробника</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="examDate">Дата</Label>
            <Input
              id="examDate"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="examScore">Балл</Label>
              <Input
                id="examScore"
                type="number"
                min="0"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                placeholder="например, 75"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="examMaxScore">Макс. балл (опц.)</Label>
              <Input
                id="examMaxScore"
                type="number"
                min="0"
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
                placeholder="например, 100"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="examNotes">Заметка (опц.)</Label>
            <Input
              id="examNotes"
              value={examNotes}
              onChange={(e) => setExamNotes(e.target.value)}
              placeholder="например, вариант СтатГрад"
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Сохранение...' : 'Добавить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChatMessagesDialog({ 
  chatId, 
  onClose 
}: { 
  chatId: string | null; 
  onClose: () => void;
}) {
  const { messages, loading, hasMore, loadMore } = useStudentChatMessages(chatId || undefined);
  
  if (!chatId) return null;
  
  return (
    <Dialog open={!!chatId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>История диалога</DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="flex-1 pr-4">
          {loading && messages.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-12 w-2/3 ml-auto" />
              <Skeleton className="h-12 w-3/4" />
            </div>
          ) : (
            <div className="space-y-3">
              {hasMore && (
                <div className="text-center">
                  <Button variant="ghost" size="sm" onClick={loadMore}>
                    Загрузить ранее
                  </Button>
                </div>
              )}
              
              {messages.map((msg) => (
                <div 
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div 
                    className={`max-w-[80%] rounded-lg px-3 py-2 ${
                      msg.role === 'user' 
                        ? 'bg-primary text-primary-foreground' 
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-xs mt-1 ${
                      msg.role === 'user' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    }`}>
                      {new Date(msg.created_at).toLocaleString('ru-RU')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function getChatTypeLabel(chatType: string): string {
  switch (chatType) {
    case 'general': return 'Общий чат';
    case 'homework_task': return 'Чат по домашке';
    case 'custom': return 'Пользовательский чат';
    default: return 'Чат';
  }
}

// =============================================
// Экспорт с защитой
// =============================================

export default function TutorStudentProfile() {
  return (
    <TutorGuard>
      <TutorStudentProfileContent />
    </TutorGuard>
  );
}
