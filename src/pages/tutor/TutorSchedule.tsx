import { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Link2, Copy, Check, Plus, X, Clock, Bell, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { useTutor, useTutorWeeklySlots, useTutorLessons, useTutorStudents, useTutorReminderSettings } from '@/hooks/useTutor';
import { 
  createWeeklySlot, 
  toggleSlotAvailability, 
  deleteWeeklySlot,
  createLesson,
  cancelLesson,
  getBookingLink,
  upsertReminderSettings
} from '@/lib/tutors';
import type { TutorWeeklySlot, TutorLessonWithStudent, TutorStudentWithProfile, TutorReminderSettings } from '@/types/tutor';

// =============================================
// Константы и утилиты
// =============================================

const DAYS_OF_WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 08:00 - 21:00

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatTime(hour: number): string {
  return `${hour.toString().padStart(2, '0')}:00`;
}

function getDateForDayOfWeek(weekStart: Date, dayOfWeek: number): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + dayOfWeek);
  return d;
}

// =============================================
// Типы ячеек календаря
// =============================================

type CellStatus = 'unavailable' | 'available' | 'booked';

interface CalendarCell {
  dayOfWeek: number;
  hour: number;
  status: CellStatus;
  slot?: TutorWeeklySlot;
  lesson?: TutorLessonWithStudent;
  studentName?: string;
}

// =============================================
// Компонент ячейки
// =============================================

interface ScheduleCellProps {
  cell: CalendarCell;
  onClick: () => void;
}

function ScheduleCell({ cell, onClick }: ScheduleCellProps) {
  const { status, studentName } = cell;
  
  const baseClasses = 'h-14 border border-border/50 rounded-md flex items-center justify-center text-sm cursor-pointer transition-all hover:shadow-md';
  
  const statusClasses = {
    unavailable: 'bg-muted/50 text-muted-foreground hover:bg-muted',
    available: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50',
    booked: 'bg-primary/90 text-primary-foreground hover:bg-primary',
  };
  
  return (
    <div 
      className={`${baseClasses} ${statusClasses[status]}`}
      onClick={onClick}
    >
      {status === 'available' && <Check className="h-4 w-4" />}
      {status === 'unavailable' && <span className="text-xs">—</span>}
      {status === 'booked' && studentName && (
        <span className="truncate px-1 text-xs font-medium">{studentName}</span>
      )}
    </div>
  );
}

// =============================================
// Диалог добавления занятия
// =============================================

interface AddLessonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: TutorStudentWithProfile[];
  selectedDate: Date | null;
  selectedHour: number | null;
  onSuccess: () => void;
}

function AddLessonDialog({ 
  open, 
  onOpenChange, 
  students, 
  selectedDate, 
  selectedHour,
  onSuccess 
}: AddLessonDialogProps) {
  const [studentId, setStudentId] = useState('');
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('60');
  const [isSaving, setIsSaving] = useState(false);
  
  const handleSubmit = async () => {
    if (!selectedDate || selectedHour === null) return;
    
    if (!studentId) {
      toast.error('Выберите ученика');
      return;
    }
    
    setIsSaving(true);
    try {
      const startAt = new Date(selectedDate);
      startAt.setHours(selectedHour, 0, 0, 0);
      
      // Find tutor_student_id
      const tutorStudent = students.find(s => s.student_id === studentId);
      
      const result = await createLesson({
        tutor_student_id: tutorStudent?.id,
        student_id: studentId,
        start_at: startAt.toISOString(),
        duration_min: parseInt(duration),
        notes: notes || undefined
      });
      
      if (result) {
        toast.success('Занятие создано');
        onSuccess();
        onOpenChange(false);
        setStudentId('');
        setNotes('');
        setDuration('60');
      } else {
        toast.error('Не удалось создать занятие');
      }
    } catch (err) {
      console.error(err);
      toast.error('Ошибка при создании');
    } finally {
      setIsSaving(false);
    }
  };
  
  const dateStr = selectedDate ? selectedDate.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }) : '';
  const timeStr = selectedHour !== null ? formatTime(selectedHour) : '';
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить занятие</DialogTitle>
          <DialogDescription>
            {dateStr} в {timeStr}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Ученик *</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите ученика" />
              </SelectTrigger>
              <SelectContent>
                {students.map(s => (
                  <SelectItem key={s.student_id} value={s.student_id}>
                    {s.profiles?.username || 'Без имени'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>Длительность</Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 минут</SelectItem>
                <SelectItem value="45">45 минут</SelectItem>
                <SelectItem value="60">60 минут</SelectItem>
                <SelectItem value="90">90 минут</SelectItem>
                <SelectItem value="120">120 минут</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>Заметка (опц.)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Примечание к занятию..."
              rows={2}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Сохранение...' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================
// Диалог деталей занятия
// =============================================

interface LessonDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: TutorLessonWithStudent | null;
  onCancel: () => void;
}

function LessonDetailsDialog({ 
  open, 
  onOpenChange, 
  lesson,
  onCancel 
}: LessonDetailsDialogProps) {
  const [isCancelling, setIsCancelling] = useState(false);
  
  if (!lesson) return null;
  
  const studentName = lesson.tutor_students?.profiles?.username 
    || lesson.profiles?.username 
    || 'Без имени';
  
  const startDate = new Date(lesson.start_at);
  const dateStr = startDate.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  const timeStr = startDate.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  });
  
  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      const result = await cancelLesson(lesson.id);
      if (result) {
        toast.success('Занятие отменено');
        onCancel();
        onOpenChange(false);
      } else {
        toast.error('Не удалось отменить');
      }
    } catch (err) {
      console.error(err);
      toast.error('Ошибка при отмене');
    } finally {
      setIsCancelling(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Занятие с {studentName}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">{dateStr}</p>
              <p className="text-sm text-muted-foreground">{timeStr} • {lesson.duration_min} мин</p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Badge variant={lesson.source === 'self_booking' ? 'secondary' : 'outline'}>
              {lesson.source === 'self_booking' ? 'Самозапись' : 'Вручную'}
            </Badge>
            <Badge variant={lesson.status === 'booked' ? 'default' : 'destructive'}>
              {lesson.status === 'booked' ? 'Запланировано' : 'Отменено'}
            </Badge>
          </div>
          
          {lesson.notes && (
            <div className="bg-muted/50 p-3 rounded-md text-sm">
              {lesson.notes}
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          {lesson.status === 'booked' && (
            <Button 
              variant="destructive" 
              onClick={handleCancel}
              disabled={isCancelling}
            >
              {isCancelling ? 'Отмена...' : 'Отменить занятие'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================
// Диалог настроек напоминаний
// =============================================

const DEFAULT_TEMPLATE_STUDENT = "Привет! Напоминаю о занятии {{date}} в {{time}}. До встречи!";
const DEFAULT_TEMPLATE_TUTOR = "Занятие с {{student_name}} {{date}} в {{time}}.";

interface ReminderSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: TutorReminderSettings | null;
  onSuccess: () => void;
}

function ReminderSettingsDialog({ 
  open, 
  onOpenChange,
  settings,
  onSuccess
}: ReminderSettingsDialogProps) {
  const [enabled, setEnabled] = useState(settings?.enabled ?? true);
  const [remind24h, setRemind24h] = useState(
    settings?.remind_before_minutes?.includes(1440) ?? true
  );
  const [remind1h, setRemind1h] = useState(
    settings?.remind_before_minutes?.includes(60) ?? true
  );
  const [templateStudent, setTemplateStudent] = useState(
    settings?.template_student || DEFAULT_TEMPLATE_STUDENT
  );
  const [templateTutor, setTemplateTutor] = useState(
    settings?.template_tutor || DEFAULT_TEMPLATE_TUTOR
  );
  const [isSaving, setIsSaving] = useState(false);
  
  // Update state when settings change
  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setRemind24h(settings.remind_before_minutes.includes(1440));
      setRemind1h(settings.remind_before_minutes.includes(60));
      setTemplateStudent(settings.template_student);
      setTemplateTutor(settings.template_tutor);
    }
  }, [settings]);
  
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const remindBeforeMinutes: number[] = [];
      if (remind24h) remindBeforeMinutes.push(1440);
      if (remind1h) remindBeforeMinutes.push(60);
      
      const result = await upsertReminderSettings({
        enabled,
        remind_before_minutes: remindBeforeMinutes,
        template_student: templateStudent,
        template_tutor: templateTutor
      });
      
      if (result) {
        toast.success('Настройки сохранены');
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error('Не удалось сохранить');
      }
    } catch (err) {
      console.error(err);
      toast.error('Ошибка сохранения');
    } finally {
      setIsSaving(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Настройки напоминаний
          </DialogTitle>
          <DialogDescription>
            Автоматические напоминания о занятиях для вас и учеников
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Напоминания включены</Label>
              <p className="text-sm text-muted-foreground">
                Отправлять уведомления в Telegram
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          
          {enabled && (
            <>
              {/* Timing */}
              <div className="space-y-3">
                <Label>Когда отправлять</Label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="remind24h" 
                      checked={remind24h} 
                      onCheckedChange={(c) => setRemind24h(!!c)}
                    />
                    <label htmlFor="remind24h" className="text-sm cursor-pointer">
                      За 24 часа до занятия
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="remind1h" 
                      checked={remind1h} 
                      onCheckedChange={(c) => setRemind1h(!!c)}
                    />
                    <label htmlFor="remind1h" className="text-sm cursor-pointer">
                      За 1 час до занятия
                    </label>
                  </div>
                </div>
              </div>
              
              {/* Student template */}
              <div className="space-y-2">
                <Label htmlFor="templateStudent">Сообщение ученику</Label>
                <Textarea
                  id="templateStudent"
                  value={templateStudent}
                  onChange={(e) => setTemplateStudent(e.target.value)}
                  rows={3}
                  placeholder="Текст напоминания для ученика..."
                />
                <p className="text-xs text-muted-foreground">
                  Переменные: {'{{date}}'}, {'{{time}}'}, {'{{tutor_name}}'}
                </p>
              </div>
              
              {/* Tutor template */}
              <div className="space-y-2">
                <Label htmlFor="templateTutor">Сообщение вам</Label>
                <Textarea
                  id="templateTutor"
                  value={templateTutor}
                  onChange={(e) => setTemplateTutor(e.target.value)}
                  rows={3}
                  placeholder="Текст напоминания для вас..."
                />
                <p className="text-xs text-muted-foreground">
                  Переменные: {'{{date}}'}, {'{{time}}'}, {'{{student_name}}'}
                </p>
              </div>
            </>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================
// Основной компонент расписания
// =============================================

function TutorScheduleContent() {
  const { tutor } = useTutor();
  const { students } = useTutorStudents();
  const { slots, loading: slotsLoading, refetch: refetchSlots } = useTutorWeeklySlots();
  const { settings: reminderSettings, refetch: refetchReminderSettings } = useTutorReminderSettings();
  
  // Неделя
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const { lessons, loading: lessonsLoading, refetch: refetchLessons } = useTutorLessons(weekStart);
  
  // Dialogs
  const [addLessonOpen, setAddLessonOpen] = useState(false);
  const [lessonDetailsOpen, setLessonDetailsOpen] = useState(false);
  const [reminderSettingsOpen, setReminderSettingsOpen] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<TutorLessonWithStudent | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  
  // Booking link
  const [copiedLink, setCopiedLink] = useState(false);
  
  const loading = slotsLoading || lessonsLoading;
  
  // Построить матрицу ячеек
  const calendarCells = useMemo<CalendarCell[][]>(() => {
    const matrix: CalendarCell[][] = HOURS.map(hour => 
      DAYS_OF_WEEK.map((_, dayOfWeek) => ({
        dayOfWeek,
        hour,
        status: 'unavailable' as CellStatus
      }))
    );
    
    // Заполнить слоты
    for (const slot of slots) {
      const hour = parseInt(slot.start_time.split(':')[0]);
      const hourIndex = hour - 8;
      if (hourIndex >= 0 && hourIndex < HOURS.length) {
        const cell = matrix[hourIndex][slot.day_of_week];
        cell.status = slot.is_available ? 'available' : 'unavailable';
        cell.slot = slot;
      }
    }
    
    // Заполнить занятия
    for (const lesson of lessons) {
      if (lesson.status !== 'booked') continue;
      
      const startDate = new Date(lesson.start_at);
      // Adjust for timezone - convert to local
      const dayOfWeek = (startDate.getDay() + 6) % 7; // Convert to Mon=0
      const hour = startDate.getHours();
      const hourIndex = hour - 8;
      
      if (hourIndex >= 0 && hourIndex < HOURS.length && dayOfWeek >= 0 && dayOfWeek < 7) {
        const cell = matrix[hourIndex][dayOfWeek];
        cell.status = 'booked';
        cell.lesson = lesson;
        cell.studentName = lesson.tutor_students?.profiles?.username 
          || lesson.profiles?.username 
          || 'Ученик';
      }
    }
    
    return matrix;
  }, [slots, lessons]);
  
  // Навигация по неделям
  const goToPrevWeek = useCallback(() => {
    setWeekStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  }, []);
  
  const goToNextWeek = useCallback(() => {
    setWeekStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  }, []);
  
  const goToCurrentWeek = useCallback(() => {
    setWeekStart(getWeekStart(new Date()));
  }, []);
  
  // Обработка клика по ячейке
  const handleCellClick = useCallback(async (cell: CalendarCell) => {
    const date = getDateForDayOfWeek(weekStart, cell.dayOfWeek);
    
    if (cell.status === 'booked' && cell.lesson) {
      // Показать детали занятия
      setSelectedLesson(cell.lesson);
      setLessonDetailsOpen(true);
    } else if (cell.status === 'available') {
      // Открыть диалог добавления занятия или сделать unavailable
      setSelectedDate(date);
      setSelectedHour(cell.hour);
      setAddLessonOpen(true);
    } else if (cell.status === 'unavailable') {
      // Создать или сделать available
      if (cell.slot) {
        // Toggle to available
        await toggleSlotAvailability(cell.slot.id, true);
        refetchSlots();
      } else {
        // Create new slot
        await createWeeklySlot({
          day_of_week: cell.dayOfWeek,
          start_time: formatTime(cell.hour),
          is_available: true
        });
        refetchSlots();
      }
    }
  }, [weekStart, refetchSlots]);
  
  // Сделать слот недоступным (правый клик / долгое нажатие)
  const handleMakeUnavailable = useCallback(async (cell: CalendarCell) => {
    if (cell.slot && cell.status === 'available') {
      await toggleSlotAvailability(cell.slot.id, false);
      refetchSlots();
    }
  }, [refetchSlots]);
  
  // Копировать ссылку
  const handleCopyBookingLink = useCallback(async () => {
    const link = await getBookingLink();
    if (link) {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      toast.success('Ссылка скопирована');
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      toast.error('Не удалось получить ссылку');
    }
  }, []);
  
  // Заголовок недели
  const weekTitle = useMemo(() => {
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 6);
    return `${formatDate(weekStart)} — ${formatDate(endDate)}`;
  }, [weekStart]);
  
  if (loading && slots.length === 0) {
    return (
      <TutorLayout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-[500px] w-full" />
        </div>
      </TutorLayout>
    );
  }
  
  return (
    <TutorLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <span>📅</span> Расписание
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Нажмите на ячейку, чтобы изменить доступность или добавить занятие
            </p>
          </div>
          
          <div className="flex gap-2">
            <Button onClick={handleCopyBookingLink} variant="outline">
              {copiedLink ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Скопировано
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4 mr-2" />
                  Ссылка для записи
                </>
              )}
            </Button>
            
            <Button 
              onClick={() => setReminderSettingsOpen(true)} 
              variant="outline"
              size="icon"
              title="Настройки напоминаний"
            >
              <Bell className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-green-100 dark:bg-green-900/30 border" />
            <span>Свободно</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-primary" />
            <span>Занято</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-muted/50 border" />
            <span>Недоступно</span>
          </div>
        </div>
        
        {/* Week navigation */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={goToPrevWeek}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Назад
          </Button>
          
          <div className="flex items-center gap-2">
            <span className="font-medium">{weekTitle}</span>
            <Button variant="ghost" size="sm" onClick={goToCurrentWeek}>
              Сегодня
            </Button>
          </div>
          
          <Button variant="ghost" size="sm" onClick={goToNextWeek}>
            Вперёд
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
        
        {/* Calendar grid */}
        <Card>
          <CardContent className="p-4 overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Header row */}
              <div className="grid grid-cols-8 gap-1 mb-2">
                <div className="text-sm font-medium text-muted-foreground p-2">
                  Время
                </div>
                {DAYS_OF_WEEK.map((day, i) => {
                  const date = getDateForDayOfWeek(weekStart, i);
                  const isToday = date.toDateString() === new Date().toDateString();
                  return (
                    <div 
                      key={day} 
                      className={`text-center p-2 rounded ${isToday ? 'bg-primary/10 font-semibold' : ''}`}
                    >
                      <div className="text-sm font-medium">{day}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(date)}</div>
                    </div>
                  );
                })}
              </div>
              
              {/* Time slots */}
              {calendarCells.map((row, hourIndex) => (
                <div key={HOURS[hourIndex]} className="grid grid-cols-8 gap-1 mb-1">
                  <div className="text-sm text-muted-foreground p-2 flex items-center">
                    {formatTime(HOURS[hourIndex])}
                  </div>
                  {row.map((cell, dayIndex) => (
                    <ScheduleCell
                      key={`${hourIndex}-${dayIndex}`}
                      cell={cell}
                      onClick={() => handleCellClick(cell)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        {/* Quick add button */}
        <div className="flex justify-center">
          <Button 
            variant="outline" 
            onClick={() => {
              setSelectedDate(new Date());
              setSelectedHour(new Date().getHours());
              setAddLessonOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Добавить занятие
          </Button>
        </div>
        
        {/* Dialogs */}
        <AddLessonDialog
          open={addLessonOpen}
          onOpenChange={setAddLessonOpen}
          students={students}
          selectedDate={selectedDate}
          selectedHour={selectedHour}
          onSuccess={() => refetchLessons()}
        />
        
        <LessonDetailsDialog
          open={lessonDetailsOpen}
          onOpenChange={setLessonDetailsOpen}
          lesson={selectedLesson}
          onCancel={() => refetchLessons()}
        />
        
        <ReminderSettingsDialog
          open={reminderSettingsOpen}
          onOpenChange={setReminderSettingsOpen}
          settings={reminderSettings}
          onSuccess={() => refetchReminderSettings()}
        />
      </div>
    </TutorLayout>
  );
}

// =============================================
// Экспорт с защитой
// =============================================

export default function TutorSchedule() {
  return (
    <TutorGuard>
      <TutorScheduleContent />
    </TutorGuard>
  );
}
