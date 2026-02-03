import { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Link2, Copy, Check, Plus, X, Clock, Bell, Settings, CalendarIcon, Trash2, CalendarDays } from 'lucide-react';
import { format, addMinutes, parseISO } from 'date-fns';
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
import { useTutor, useTutorWeeklySlots, useTutorLessons, useTutorStudents, useTutorReminderSettings, useTutorCalendarSettings, useTutorAvailabilityExceptions } from '@/hooks/useTutor';
import {
  createWeeklySlot,
  toggleSlotAvailability,
  deleteWeeklySlot,
  createLesson,
  cancelLesson,
  getBookingLink,
  upsertReminderSettings
} from '@/lib/tutors';
import {
  upsertCalendarSettings,
  createAvailabilityException,
  deleteAvailabilityException,
  rescheduleLesson,
  syncWorkHoursToSlots
} from '@/lib/tutorSchedule';
import type { TutorWeeklySlot, TutorLessonWithStudent, TutorStudentWithProfile, TutorReminderSettings, TutorCalendarSettings, TutorAvailabilityException } from '@/types/tutor';

// =============================================
// Constants & Utils
// =============================================

const DAYS_OF_WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const PIXELS_PER_MINUTE = 1;
const HOUR_HEIGHT = 60;

const SETTINGS_KEY = 'tutor-schedule-settings';

interface ScheduleSettings {
  workDayStart: number;
  workDayEnd: number;
  workDays: number[];
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

async function saveSettings(settings: ScheduleSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  // Sync to database for booking system
  await syncWorkHoursToSlots(
    settings.workDays,
    settings.workDayStart,
    settings.workDayEnd
  );
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
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

const LESSON_TYPES = [
  { value: 'regular', label: 'Обычный урок' },
  { value: 'trial', label: 'Пробное занятие' },
  { value: 'mock_exam', label: 'Пробный экзамен' },
  { value: 'consultation', label: 'Консультация' },
];

// =============================================
// LessonBlock
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
  const height = Math.max(lesson.duration_min * PIXELS_PER_MINUTE, 20);

  const studentName = lesson.tutor_students?.profiles?.username
    || lesson.profiles?.username
    || 'Ученик';

  const endDate = addMinutes(startDate, lesson.duration_min);
  const timeStr = `${format(startDate, 'HH:mm')} - ${format(endDate, 'HH:mm')}`;

  const lessonType = (lesson as any).lesson_type || 'regular';
  const typeColor = lessonType === 'trial' ? 'bg-amber-500'
    : lessonType === 'mock_exam' ? 'bg-purple-500'
    : lessonType === 'consultation' ? 'bg-teal-500'
    : 'bg-primary';

  return (
    <div
      className={cn(
        "absolute left-0.5 right-0.5 text-white rounded-md px-1.5 py-0.5 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden shadow-sm",
        typeColor
      )}
      style={{ top: `${top}px`, height: `${height}px`, minHeight: '20px' }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <div className="flex flex-col h-full justify-center">
        <span className="text-xs font-medium truncate leading-tight">{studentName}</span>
        {height >= 35 && (
          <span className="text-[10px] opacity-80 truncate leading-tight">{timeStr}</span>
        )}
        {height >= 50 && (lesson as any).subject && (
          <span className="text-[10px] opacity-70 truncate leading-tight">{(lesson as any).subject}</span>
        )}
      </div>
    </div>
  );
}

// =============================================
// WorkHoursSettings sidebar
// =============================================

interface WorkHoursSettingsProps {
  settings: ScheduleSettings;
  onChange: (settings: ScheduleSettings) => void;
}

function WorkHoursSettings({ settings, onChange }: WorkHoursSettingsProps) {
  const hours = Array.from({ length: 25 }, (_, i) => i);

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
// AddLessonDialog
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
  const [lessonType, setLessonType] = useState('regular');
  const [subject, setSubject] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(initialDate || new Date());
      setHour(initialHour?.toString() || new Date().getHours().toString());
      setMinute(initialMinute.toString().padStart(2, '0'));
      setStudentId('');
      setNotes('');
      setDuration('60');
      setLessonType('regular');
      setSubject('');
    }
  }, [open, initialDate, initialHour, initialMinute]);

  // Auto-fill subject from student profile
  useEffect(() => {
    if (studentId) {
      const student = students.find(s => s.student_id === studentId);
      if (student?.subject) {
        setSubject(student.subject);
      }
    }
  }, [studentId, students]);

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
          {/* Date and Time */}
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Длительность</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 мин</SelectItem>
                  <SelectItem value="45">45 мин</SelectItem>
                  <SelectItem value="60">60 мин</SelectItem>
                  <SelectItem value="90">90 мин</SelectItem>
                  <SelectItem value="120">120 мин</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Тип занятия</Label>
              <Select value={lessonType} onValueChange={setLessonType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LESSON_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Предмет</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Математика, Физика..."
            />
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
// LessonDetailsDialog (with reschedule)
// =============================================

interface LessonDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: TutorLessonWithStudent | null;
  onCancel: () => void;
  onReschedule: () => void;
}

function LessonDetailsDialog({
  open,
  onOpenChange,
  lesson,
  onCancel,
  onReschedule
}: LessonDetailsDialogProps) {
  const [isCancelling, setIsCancelling] = useState(false);

  if (!lesson) return null;

  const studentName = lesson.tutor_students?.profiles?.username
    || lesson.profiles?.username
    || 'Без имени';

  const startDate = new Date(lesson.start_at);
  const endDate = addMinutes(startDate, lesson.duration_min);
  const dateStr = startDate.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  const timeStr = `${format(startDate, 'HH:mm')} — ${format(endDate, 'HH:mm')}`;

  const lessonType = (lesson as any).lesson_type || 'regular';
  const typeLabel = LESSON_TYPES.find(t => t.value === lessonType)?.label || 'Урок';

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
              <p className="font-medium capitalize">{dateStr}</p>
              <p className="text-sm text-muted-foreground">{timeStr} ({lesson.duration_min} мин)</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant={lesson.source === 'self_booking' ? 'secondary' : 'outline'}>
              {lesson.source === 'self_booking' ? 'Самозапись' : 'Вручную'}
            </Badge>
            <Badge variant={lesson.status === 'booked' ? 'default' : lesson.status === 'completed' ? 'secondary' : 'destructive'}>
              {lesson.status === 'booked' ? 'Запланировано' : lesson.status === 'completed' ? 'Проведено' : 'Отменено'}
            </Badge>
            <Badge variant="outline">{typeLabel}</Badge>
            {(lesson as any).subject && <Badge variant="outline">{(lesson as any).subject}</Badge>}
          </div>

          {lesson.notes && (
            <div className="bg-muted/50 p-3 rounded-md text-sm">
              {lesson.notes}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          {lesson.status === 'booked' && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onReschedule();
                }}
              >
                <CalendarDays className="h-4 w-4 mr-2" />
                Перенести
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancel}
                disabled={isCancelling}
              >
                {isCancelling ? 'Отмена...' : 'Отменить занятие'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================
// RescheduleDialog
// =============================================

interface RescheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: TutorLessonWithStudent | null;
  onSuccess: () => void;
}

function RescheduleDialog({ open, onOpenChange, lesson, onSuccess }: RescheduleDialogProps) {
  const [date, setDate] = useState<Date | undefined>();
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('00');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open && lesson) {
      const d = new Date(lesson.start_at);
      setDate(d);
      setHour(d.getHours().toString());
      setMinute(d.getMinutes().toString().padStart(2, '0'));
    }
  }, [open, lesson]);

  const handleSubmit = async () => {
    if (!date || !lesson) return;

    setIsSaving(true);
    try {
      const newStart = new Date(date);
      newStart.setHours(parseInt(hour), parseInt(minute), 0, 0);

      const result = await rescheduleLesson(lesson.id, newStart.toISOString());
      if (result) {
        toast.success('Занятие перенесено');
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error('Не удалось перенести');
      }
    } catch (err) {
      console.error(err);
      toast.error('Ошибка при переносе');
    } finally {
      setIsSaving(false);
    }
  };

  const studentName = lesson?.tutor_students?.profiles?.username
    || lesson?.profiles?.username
    || 'Ученик';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Перенести занятие</DialogTitle>
          <DialogDescription>
            Занятие с {studentName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Новая дата и время</Label>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Перенос...' : 'Перенести'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================
// CalendarSettingsDialog
// =============================================

interface CalendarSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: TutorCalendarSettings | null;
  exceptions: TutorAvailabilityException[];
  onSuccess: () => void;
  onExceptionsChange: () => void;
}

function CalendarSettingsDialog({
  open,
  onOpenChange,
  settings,
  exceptions,
  onSuccess,
  onExceptionsChange
}: CalendarSettingsDialogProps) {
  const [defaultDuration, setDefaultDuration] = useState(settings?.default_duration?.toString() || '60');
  const [bufferMinutes, setBufferMinutes] = useState(settings?.buffer_minutes?.toString() || '15');
  const [minNoticeHours, setMinNoticeHours] = useState(settings?.min_notice_hours?.toString() || '24');
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(settings?.max_advance_days?.toString() || '30');
  const [autoConfirm, setAutoConfirm] = useState(settings?.auto_confirm ?? true);
  const [allowStudentCancel, setAllowStudentCancel] = useState(settings?.allow_student_cancel ?? true);
  const [cancelNoticeHours, setCancelNoticeHours] = useState(settings?.cancel_notice_hours?.toString() || '24');
  const [isSaving, setIsSaving] = useState(false);

  // Exception form
  const [newExceptionDate, setNewExceptionDate] = useState<Date | undefined>();
  const [newExceptionReason, setNewExceptionReason] = useState('');

  useEffect(() => {
    if (settings) {
      setDefaultDuration(settings.default_duration.toString());
      setBufferMinutes(settings.buffer_minutes.toString());
      setMinNoticeHours(settings.min_notice_hours.toString());
      setMaxAdvanceDays(settings.max_advance_days.toString());
      setAutoConfirm(settings.auto_confirm);
      setAllowStudentCancel(settings.allow_student_cancel);
      setCancelNoticeHours(settings.cancel_notice_hours.toString());
    }
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await upsertCalendarSettings({
        default_duration: parseInt(defaultDuration),
        buffer_minutes: parseInt(bufferMinutes),
        min_notice_hours: parseInt(minNoticeHours),
        max_advance_days: parseInt(maxAdvanceDays),
        auto_confirm: autoConfirm,
        allow_student_cancel: allowStudentCancel,
        cancel_notice_hours: parseInt(cancelNoticeHours),
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

  const handleAddException = async () => {
    if (!newExceptionDate) return;

    const dateStr = format(newExceptionDate, 'yyyy-MM-dd');
    const result = await createAvailabilityException(dateStr, newExceptionReason || undefined);
    if (result) {
      toast.success('Исключение добавлено');
      setNewExceptionDate(undefined);
      setNewExceptionReason('');
      onExceptionsChange();
    } else {
      toast.error('Ошибка');
    }
  };

  const handleDeleteException = async (id: string) => {
    const ok = await deleteAvailabilityException(id);
    if (ok) {
      toast.success('Исключение удалено');
      onExceptionsChange();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Настройки календаря
          </DialogTitle>
          <DialogDescription>
            Параметры записи и доступности
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Duration & Buffer */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm">Длительность по умолчанию</Label>
              <Select value={defaultDuration} onValueChange={setDefaultDuration}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="45">45 мин</SelectItem>
                  <SelectItem value="60">60 мин</SelectItem>
                  <SelectItem value="90">90 мин</SelectItem>
                  <SelectItem value="120">120 мин</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Перерыв между занятиями</Label>
              <Select value={bufferMinutes} onValueChange={setBufferMinutes}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Без перерыва</SelectItem>
                  <SelectItem value="5">5 мин</SelectItem>
                  <SelectItem value="10">10 мин</SelectItem>
                  <SelectItem value="15">15 мин</SelectItem>
                  <SelectItem value="30">30 мин</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Booking limits */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm">Мин. время до записи</Label>
              <Select value={minNoticeHours} onValueChange={setMinNoticeHours}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 час</SelectItem>
                  <SelectItem value="2">2 часа</SelectItem>
                  <SelectItem value="6">6 часов</SelectItem>
                  <SelectItem value="12">12 часов</SelectItem>
                  <SelectItem value="24">24 часа</SelectItem>
                  <SelectItem value="48">48 часов</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Макс. дней вперёд</Label>
              <Select value={maxAdvanceDays} onValueChange={setMaxAdvanceDays}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 дней</SelectItem>
                  <SelectItem value="14">14 дней</SelectItem>
                  <SelectItem value="30">30 дней</SelectItem>
                  <SelectItem value="60">60 дней</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Автоподтверждение записи</Label>
                <p className="text-xs text-muted-foreground">Записи подтверждаются автоматически</p>
              </div>
              <Switch checked={autoConfirm} onCheckedChange={setAutoConfirm} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Ученик может отменить</Label>
                <p className="text-xs text-muted-foreground">За {cancelNoticeHours}ч до занятия</p>
              </div>
              <Switch checked={allowStudentCancel} onCheckedChange={setAllowStudentCancel} />
            </div>
          </div>

          {/* Exceptions */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Исключения (отпуск, болезнь)</Label>

            {exceptions.length > 0 && (
              <div className="space-y-1">
                {exceptions.map(exc => (
                  <div key={exc.id} className="flex items-center justify-between py-1.5 px-2 bg-muted/50 rounded text-sm">
                    <span>
                      {format(parseISO(exc.exception_date), 'd MMMM yyyy', { locale: ru })}
                      {exc.reason && <span className="text-muted-foreground ml-2">— {exc.reason}</span>}
                    </span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDeleteException(exc.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-3 w-3" />
                      {newExceptionDate ? format(newExceptionDate, 'dd.MM.yyyy') : 'Дата'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={newExceptionDate}
                      onSelect={setNewExceptionDate}
                      locale={ru}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <Input
                value={newExceptionReason}
                onChange={(e) => setNewExceptionReason(e.target.value)}
                placeholder="Причина"
                className="flex-1 h-8 text-sm"
              />
              <Button size="sm" variant="outline" onClick={handleAddException} disabled={!newExceptionDate}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================
// ReminderSettingsDialog
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
// Main Schedule Component
// =============================================

function TutorScheduleContent() {
  const { tutor } = useTutor();
  const { students } = useTutorStudents();
  const { slots, loading: slotsLoading, refetch: refetchSlots } = useTutorWeeklySlots();
  const { settings: reminderSettings, refetch: refetchReminderSettings } = useTutorReminderSettings();
  const { settings: calendarSettings, refetch: refetchCalendarSettings } = useTutorCalendarSettings();
  const { exceptions, refetch: refetchExceptions } = useTutorAvailabilityExceptions();

  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings>(loadSettings);

  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const { lessons, loading: lessonsLoading, refetch: refetchLessons } = useTutorLessons(weekStart);

  // Dialogs
  const [addLessonOpen, setAddLessonOpen] = useState(false);
  const [lessonDetailsOpen, setLessonDetailsOpen] = useState(false);
  const [reminderSettingsOpen, setReminderSettingsOpen] = useState(false);
  const [calendarSettingsOpen, setCalendarSettingsOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<TutorLessonWithStudent | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number>(0);

  const [copiedLink, setCopiedLink] = useState(false);

  // Sync settings to DB on initial load
  useEffect(() => {
    syncWorkHoursToSlots(
      scheduleSettings.workDays,
      scheduleSettings.workDayStart,
      scheduleSettings.workDayEnd
    );
  }, []); // Only on mount

  const loading = slotsLoading || lessonsLoading;

  const visibleHours = useMemo(() => {
    return Array.from(
      { length: scheduleSettings.workDayEnd - scheduleSettings.workDayStart },
      (_, i) => scheduleSettings.workDayStart + i
    );
  }, [scheduleSettings]);

  const gridHeight = visibleHours.length * HOUR_HEIGHT;

  const lessonsByDay = useMemo(() => {
    const byDay: Record<number, TutorLessonWithStudent[]> = {};
    for (let i = 0; i < 7; i++) byDay[i] = [];

    for (const lesson of lessons) {
      if (lesson.status !== 'booked') continue;

      const startDate = new Date(lesson.start_at);
      const dayOfWeek = (startDate.getDay() + 6) % 7;
      const lessonHour = startDate.getHours();

      if (lessonHour >= scheduleSettings.workDayStart && lessonHour < scheduleSettings.workDayEnd) {
        byDay[dayOfWeek].push(lesson);
      }
    }

    return byDay;
  }, [lessons, scheduleSettings]);

  // Stats
  const todayLessons = useMemo(() => {
    const today = new Date();
    return lessons.filter(l => {
      const d = new Date(l.start_at);
      return l.status === 'booked' && d.toDateString() === today.toDateString();
    }).length;
  }, [lessons]);

  const weekLessons = useMemo(() => {
    return lessons.filter(l => l.status === 'booked').length;
  }, [lessons]);

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

  const handleGridClick = useCallback((dayOfWeek: number, clickY: number) => {
    const minutesFromStart = Math.floor(clickY / PIXELS_PER_MINUTE);
    const totalMinutes = scheduleSettings.workDayStart * 60 + minutesFromStart;
    const hour = Math.floor(totalMinutes / 60);
    const minute = Math.round((totalMinutes % 60) / 15) * 15;

    const date = getDateForDayOfWeek(weekStart, dayOfWeek);
    setSelectedDate(date);
    setSelectedHour(hour);
    setSelectedMinute(minute >= 60 ? 0 : minute);
    setAddLessonOpen(true);
  }, [weekStart, scheduleSettings.workDayStart]);

  const handleLessonClick = useCallback((lesson: TutorLessonWithStudent) => {
    setSelectedLesson(lesson);
    setLessonDetailsOpen(true);
  }, []);

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

  const handleReschedule = useCallback(() => {
    setRescheduleOpen(true);
  }, []);

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

          <div className="flex gap-2 flex-wrap">
            <Button onClick={handleCopyBookingLink} variant="outline" size="sm">
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

            {/* Work Hours Settings Popover */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" title="Настройки расписания">
                  <Settings className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64" align="end">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground font-medium">Рабочие часы</Label>
                    <div className="flex items-center gap-2">
                      <Select 
                        value={scheduleSettings.workDayStart.toString()} 
                        onValueChange={(value) => {
                          const newStart = parseInt(value);
                          if (newStart < scheduleSettings.workDayEnd) {
                            const newSettings = { ...scheduleSettings, workDayStart: newStart };
                            setScheduleSettings(newSettings);
                            saveSettings(newSettings);
                          }
                        }}
                      >
                        <SelectTrigger className="w-20 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, i) => (
                            <SelectItem key={i} value={i.toString()}>
                              {i.toString().padStart(2, '0')}:00
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground text-sm">—</span>
                      <Select 
                        value={scheduleSettings.workDayEnd.toString()} 
                        onValueChange={(value) => {
                          const newEnd = parseInt(value);
                          if (newEnd > scheduleSettings.workDayStart) {
                            const newSettings = { ...scheduleSettings, workDayEnd: newEnd };
                            setScheduleSettings(newSettings);
                            saveSettings(newSettings);
                          }
                        }}
                      >
                        <SelectTrigger className="w-20 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, i) => i + 1).map(h => (
                            <SelectItem key={h} value={h.toString()}>
                              {h.toString().padStart(2, '0')}:00
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground font-medium">Рабочие дни</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {DAYS_OF_WEEK.map((day, i) => (
                        <div key={day} className="flex items-center gap-1.5">
                          <Checkbox
                            id={`popover-day-${i}`}
                            checked={scheduleSettings.workDays.includes(i)}
                            onCheckedChange={() => {
                              const workDays = scheduleSettings.workDays.includes(i)
                                ? scheduleSettings.workDays.filter(d => d !== i)
                                : [...scheduleSettings.workDays, i].sort();
                              const newSettings = { ...scheduleSettings, workDays };
                              setScheduleSettings(newSettings);
                              saveSettings(newSettings);
                            }}
                          />
                          <label htmlFor={`popover-day-${i}`} className="text-xs cursor-pointer">
                            {day}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              onClick={() => setCalendarSettingsOpen(true)}
              variant="outline"
              size="icon"
              title="Настройки календаря"
            >
              <CalendarDays className="h-4 w-4" />
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

        {/* Stats bar */}
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-primary" />
            <span>Урок</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-amber-500" />
            <span>Пробное</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-purple-500" />
            <span>Пробник</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-teal-500" />
            <span>Консультация</span>
          </div>
          <span className="text-muted-foreground ml-auto">
            Сегодня: {todayLessons} | Неделя: {weekLessons}
          </span>
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

        {/* Main layout */}
        <div className="flex flex-col lg:flex-row gap-4">
          <WorkHoursSettings
            settings={scheduleSettings}
            onChange={setScheduleSettings}
          />

          {/* Calendar grid */}
          <Card className="flex-1">
            <CardContent className="p-0">
              <div className="overflow-x-auto overflow-y-visible">
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
          onReschedule={handleReschedule}
        />

        <RescheduleDialog
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          lesson={selectedLesson}
          onSuccess={() => refetchLessons()}
        />

        <ReminderSettingsDialog
          open={reminderSettingsOpen}
          onOpenChange={setReminderSettingsOpen}
          settings={reminderSettings}
          onSuccess={() => refetchReminderSettings()}
        />

        <CalendarSettingsDialog
          open={calendarSettingsOpen}
          onOpenChange={setCalendarSettingsOpen}
          settings={calendarSettings}
          exceptions={exceptions}
          onSuccess={() => refetchCalendarSettings()}
          onExceptionsChange={() => refetchExceptions()}
        />
      </div>
    </TutorLayout>
  );
}

// =============================================
// Export with guard
// =============================================

export default function TutorSchedule() {
  return (
    <TutorGuard>
      <TutorScheduleContent />
    </TutorGuard>
  );
}
