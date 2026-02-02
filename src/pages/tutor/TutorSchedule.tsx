import { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Link2, Copy, Check, Plus, X, Clock, Bell, Settings, CalendarIcon } from 'lucide-react';
import { format, addMinutes } from 'date-fns';
import { ru } from 'date-fns/locale';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
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
const PIXELS_PER_MINUTE = 1; // 1px = 1 minute
const HOUR_HEIGHT = 60; // 60px per hour

const SETTINGS_KEY = 'tutor-schedule-settings';

interface ScheduleSettings {
  workDayStart: number; // 0-23
  workDayEnd: number;   // 1-24
  workDays: number[];   // [0,1,2,3,4] = Mon-Fri
}

const defaultSettings: ScheduleSettings = {
  workDayStart: 9,
  workDayEnd: 21,
  workDays: [0, 1, 2, 3, 4]
};

function loadSettings(): ScheduleSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

function saveSettings(settings: ScheduleSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

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

function formatTime(hour: number, minute: number = 0): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function getDateForDayOfWeek(weekStart: Date, dayOfWeek: number): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + dayOfWeek);
  return d;
}

// =============================================
// Компонент блока занятия (абсолютное позиционирование)
// =============================================

interface LessonBlockProps {
  lesson: TutorLessonWithStudent;
  workDayStart: number;
  onClick: () => void;
}

function LessonBlock({ lesson, workDayStart, onClick }: LessonBlockProps) {
  const startDate = new Date(lesson.start_at);
  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  const offsetMinutes = startMinutes - (workDayStart * 60);
  
  const top = offsetMinutes * PIXELS_PER_MINUTE;
  const height = Math.max(lesson.duration_min * PIXELS_PER_MINUTE, 20); // Min 20px height
  
  const studentName = lesson.tutor_students?.profiles?.username 
    || lesson.profiles?.username 
    || 'Ученик';
  
  const endDate = addMinutes(startDate, lesson.duration_min);
  const timeStr = `${format(startDate, 'HH:mm')} - ${format(endDate, 'HH:mm')}`;
  
  return (
    <div 
      className="absolute left-0.5 right-0.5 bg-primary text-primary-foreground rounded-md px-1.5 py-0.5 cursor-pointer hover:bg-primary/90 transition-colors overflow-hidden shadow-sm"
      style={{ top: `${top}px`, height: `${height}px`, minHeight: '20px' }}
      onClick={onClick}
    >
      <div className="flex flex-col h-full justify-center">
        <span className="text-xs font-medium truncate leading-tight">{studentName}</span>
        {height >= 35 && (
          <span className="text-[10px] opacity-80 truncate leading-tight">{timeStr}</span>
        )}
      </div>
    </div>
  );
}

// =============================================
// Компонент настроек рабочих часов
// =============================================

interface WorkHoursSettingsProps {
  settings: ScheduleSettings;
  onChange: (settings: ScheduleSettings) => void;
}

function WorkHoursSettings({ settings, onChange }: WorkHoursSettingsProps) {
  const hours = Array.from({ length: 25 }, (_, i) => i); // 0-24
  
  const handleStartChange = (value: string) => {
    const newStart = parseInt(value);
    if (newStart < settings.workDayEnd) {
      const newSettings = { ...settings, workDayStart: newStart };
      onChange(newSettings);
      saveSettings(newSettings);
    }
  };
  
  const handleEndChange = (value: string) => {
    const newEnd = parseInt(value);
    if (newEnd > settings.workDayStart) {
      const newSettings = { ...settings, workDayEnd: newEnd };
      onChange(newSettings);
      saveSettings(newSettings);
    }
  };
  
  const handleDayToggle = (dayIndex: number) => {
    const workDays = settings.workDays.includes(dayIndex)
      ? settings.workDays.filter(d => d !== dayIndex)
      : [...settings.workDays, dayIndex].sort();
    const newSettings = { ...settings, workDays };
    onChange(newSettings);
    saveSettings(newSettings);
  };
  
  return (
    <Card className="w-full lg:w-56 flex-shrink-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Настройки
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Рабочие часы</Label>
          <div className="flex items-center gap-2">
            <Select value={settings.workDayStart.toString()} onValueChange={handleStartChange}>
              <SelectTrigger className="w-20 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hours.slice(0, 24).map(h => (
                  <SelectItem key={h} value={h.toString()}>
                    {h.toString().padStart(2, '0')}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-sm">—</span>
            <Select value={settings.workDayEnd.toString()} onValueChange={handleEndChange}>
              <SelectTrigger className="w-20 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hours.slice(1).map(h => (
                  <SelectItem key={h} value={h.toString()}>
                    {h.toString().padStart(2, '0')}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Рабочие дни</Label>
          <div className="space-y-1">
            {DAYS_OF_WEEK.map((day, i) => (
              <div key={day} className="flex items-center gap-2">
                <Checkbox 
                  id={`day-${i}`} 
                  checked={settings.workDays.includes(i)}
                  onCheckedChange={() => handleDayToggle(i)}
                />
                <label htmlFor={`day-${i}`} className="text-sm cursor-pointer">
                  {day}
                </label>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================
// Диалог добавления занятия (с выбором даты и времени)
// =============================================

interface AddLessonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: TutorStudentWithProfile[];
  initialDate: Date | null;
  initialHour: number | null;
  initialMinute?: number;
  onSuccess: () => void;
}

function AddLessonDialog({ 
  open, 
  onOpenChange, 
  students, 
  initialDate, 
  initialHour,
  initialMinute = 0,
  onSuccess 
}: AddLessonDialogProps) {
  const [date, setDate] = useState<Date | undefined>(initialDate || new Date());
  const [hour, setHour] = useState(initialHour?.toString() || new Date().getHours().toString());
  const [minute, setMinute] = useState(initialMinute.toString().padStart(2, '0'));
  const [studentId, setStudentId] = useState('');
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('60');
  const [isSaving, setIsSaving] = useState(false);
  
  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setDate(initialDate || new Date());
      setHour(initialHour?.toString() || new Date().getHours().toString());
      setMinute(initialMinute.toString().padStart(2, '0'));
      setStudentId('');
      setNotes('');
      setDuration('60');
    }
  }, [open, initialDate, initialHour, initialMinute]);
  
  const handleSubmit = async () => {
    if (!date) {
      toast.error('Выберите дату');
      return;
    }
    
    if (!studentId) {
      toast.error('Выберите ученика');
      return;
    }
    
    setIsSaving(true);
    try {
      const startAt = new Date(date);
      startAt.setHours(parseInt(hour), parseInt(minute), 0, 0);
      
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
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить занятие</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Date and Time picker */}
          <div className="space-y-2">
            <Label>Дата и время *</Label>
            <div className="flex flex-wrap gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[160px] justify-start text-left font-normal",
                      !date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'dd.MM.yyyy') : 'Выберите дату'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    locale={ru}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              
              <div className="flex items-center gap-1">
                <Select value={hour} onValueChange={setHour}>
                  <SelectTrigger className="w-[70px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={i.toString()}>
                        {i.toString().padStart(2, '0')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select value={minute} onValueChange={setMinute}>
                  <SelectTrigger className="w-[70px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['00', '15', '30', '45'].map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          
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
  
  // Настройки отображения
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings>(loadSettings);
  
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
  const [selectedMinute, setSelectedMinute] = useState<number>(0);
  
  // Booking link
  const [copiedLink, setCopiedLink] = useState(false);
  
  const loading = slotsLoading || lessonsLoading;
  
  // Видимые часы на основе настроек
  const visibleHours = useMemo(() => {
    return Array.from(
      { length: scheduleSettings.workDayEnd - scheduleSettings.workDayStart },
      (_, i) => scheduleSettings.workDayStart + i
    );
  }, [scheduleSettings]);
  
  const gridHeight = visibleHours.length * HOUR_HEIGHT;
  
  // Группировать занятия по дням недели
  const lessonsByDay = useMemo(() => {
    const byDay: Record<number, TutorLessonWithStudent[]> = {};
    for (let i = 0; i < 7; i++) byDay[i] = [];
    
    for (const lesson of lessons) {
      if (lesson.status !== 'booked') continue;
      
      const startDate = new Date(lesson.start_at);
      const dayOfWeek = (startDate.getDay() + 6) % 7; // Convert to Mon=0
      const lessonHour = startDate.getHours();
      
      // Only show lessons within visible hours
      if (lessonHour >= scheduleSettings.workDayStart && lessonHour < scheduleSettings.workDayEnd) {
        byDay[dayOfWeek].push(lesson);
      }
    }
    
    return byDay;
  }, [lessons, scheduleSettings]);
  
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
  
  // Клик по пустой области для добавления занятия
  const handleGridClick = useCallback((dayOfWeek: number, clickY: number) => {
    const minutesFromStart = Math.floor(clickY / PIXELS_PER_MINUTE);
    const totalMinutes = scheduleSettings.workDayStart * 60 + minutesFromStart;
    const hour = Math.floor(totalMinutes / 60);
    const minute = Math.round((totalMinutes % 60) / 15) * 15; // Round to 15 min
    
    const date = getDateForDayOfWeek(weekStart, dayOfWeek);
    setSelectedDate(date);
    setSelectedHour(hour);
    setSelectedMinute(minute >= 60 ? 0 : minute);
    setAddLessonOpen(true);
  }, [weekStart, scheduleSettings.workDayStart]);
  
  // Клик по занятию
  const handleLessonClick = useCallback((lesson: TutorLessonWithStudent) => {
    setSelectedLesson(lesson);
    setLessonDetailsOpen(true);
  }, []);
  
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
              Нажмите на сетку, чтобы добавить занятие
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
            <div className="w-4 h-4 rounded bg-primary" />
            <span>Занятие</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-muted border border-border" />
            <span>Свободно</span>
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
        
        {/* Main layout: Settings sidebar + Calendar */}
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Settings sidebar */}
          <WorkHoursSettings 
            settings={scheduleSettings} 
            onChange={setScheduleSettings} 
          />
          
          {/* Calendar grid */}
          <Card className="flex-1 overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <div className="min-w-[700px]">
                  {/* Header row */}
                  <div className="grid grid-cols-8 border-b bg-muted/30">
                    <div className="p-2 text-sm font-medium text-muted-foreground border-r">
                      Время
                    </div>
                    {DAYS_OF_WEEK.map((day, i) => {
                      const date = getDateForDayOfWeek(weekStart, i);
                      const isToday = date.toDateString() === new Date().toDateString();
                      const isWorkDay = scheduleSettings.workDays.includes(i);
                      return (
                        <div 
                          key={day} 
                          className={cn(
                            "text-center p-2 border-r last:border-r-0",
                            isToday && "bg-primary/10",
                            !isWorkDay && "bg-muted/50"
                          )}
                        >
                          <div className={cn("text-sm font-medium", isToday && "text-primary")}>{day}</div>
                          <div className="text-xs text-muted-foreground">{formatDate(date)}</div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Time grid */}
                  <div className="relative">
                    <div className="grid grid-cols-8">
                      {/* Time column */}
                      <div className="border-r">
                        {visibleHours.map(hour => (
                          <div 
                            key={hour} 
                            className="border-b last:border-b-0 text-xs text-muted-foreground pr-2 text-right"
                            style={{ height: `${HOUR_HEIGHT}px` }}
                          >
                            <span className="relative -top-2">{formatTime(hour)}</span>
                          </div>
                        ))}
                      </div>
                      
                      {/* Day columns */}
                      {DAYS_OF_WEEK.map((_, dayIndex) => {
                        const isWorkDay = scheduleSettings.workDays.includes(dayIndex);
                        const dayLessons = lessonsByDay[dayIndex] || [];
                        
                        return (
                          <div 
                            key={dayIndex}
                            className={cn(
                              "relative border-r last:border-r-0",
                              !isWorkDay && "bg-muted/30"
                            )}
                            style={{ height: `${gridHeight}px` }}
                            onClick={(e) => {
                              if (isWorkDay) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const clickY = e.clientY - rect.top;
                                handleGridClick(dayIndex, clickY);
                              }
                            }}
                          >
                            {/* Hour lines */}
                            {visibleHours.map((_, hourIdx) => (
                              <div 
                                key={hourIdx}
                                className="absolute left-0 right-0 border-b border-border/50"
                                style={{ top: `${(hourIdx + 1) * HOUR_HEIGHT}px` }}
                              />
                            ))}
                            
                            {/* Half-hour lines */}
                            {visibleHours.map((_, hourIdx) => (
                              <div 
                                key={`half-${hourIdx}`}
                                className="absolute left-0 right-0 border-b border-border/20"
                                style={{ top: `${hourIdx * HOUR_HEIGHT + 30}px` }}
                              />
                            ))}
                            
                            {/* Lessons */}
                            {dayLessons.map(lesson => (
                              <LessonBlock
                                key={lesson.id}
                                lesson={lesson}
                                workDayStart={scheduleSettings.workDayStart}
                                onClick={() => handleLessonClick(lesson)}
                              />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Quick add button */}
        <div className="flex justify-center">
          <Button 
            variant="outline" 
            onClick={() => {
              setSelectedDate(new Date());
              setSelectedHour(new Date().getHours());
              setSelectedMinute(0);
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
          initialDate={selectedDate}
          initialHour={selectedHour}
          initialMinute={selectedMinute}
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
