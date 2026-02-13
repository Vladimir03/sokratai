import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Link2, Copy, Check, Plus, X, Clock, Bell, Settings, CalendarIcon, Trash2, CalendarDays, MessageCircle, Repeat, Download, Unplug } from 'lucide-react';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { format, addMinutes, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { supabase } from '@/lib/supabaseClient';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
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
  syncWorkHoursToSlots,
  createLessonSeries,
  updateLesson,
  updateLessonSeries,
  cancelLessonSeries,
  getGoogleCalendarStatus,
  getGoogleCalendarAuthUrl,
  disconnectGoogleCalendar,
  importGoogleCalendarEvents
} from '@/lib/tutorSchedule';
import type { TutorWeeklySlot, TutorLessonWithStudent, TutorStudentWithProfile, TutorReminderSettings, TutorCalendarSettings, TutorAvailabilityException, LessonType } from '@/types/tutor';

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

interface DragPreviewState {
  dayIndex: number;
  topPx: number;
  durationMin: number;
  visible: boolean;
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

const LESSON_TYPES: { value: LessonType; label: string; shortLabel: string; color: string }[] = [
  { value: 'regular', label: 'Обычный урок', shortLabel: 'Урок', color: 'bg-primary' },
  { value: 'trial', label: 'Пробное занятие', shortLabel: 'Пробное', color: 'bg-amber-500' },
  { value: 'mock_exam', label: 'Пробный экзамен', shortLabel: 'Пробник', color: 'bg-purple-500' },
  { value: 'consultation', label: 'Консультация', shortLabel: 'Консультация', color: 'bg-teal-500' },
];

function getLessonTypeColor(type: LessonType | string): string {
  return LESSON_TYPES.find(t => t.value === type)?.color || 'bg-primary';
}

function getLessonTypeLabel(type: LessonType | string): string {
  return LESSON_TYPES.find(t => t.value === type)?.label || 'Урок';
}

// =============================================
// LessonBlock
// =============================================

interface LessonBlockProps {
  lesson: TutorLessonWithStudent;
  workDayStart: number;
  onClick: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

function LessonBlock({ lesson, workDayStart, onClick, onDragStart, onDragEnd }: LessonBlockProps) {
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

  const lessonType = lesson.lesson_type || 'regular';
  const typeColor = getLessonTypeColor(lessonType);

  return (
    <div
      className={cn(
        "absolute left-0.5 right-0.5 text-white rounded-md px-1.5 py-0.5 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden shadow-sm",
        typeColor
      )}
      style={{ top: `${top}px`, height: `${height}px`, minHeight: '20px' }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <div className="flex flex-col h-full justify-center">
        <span className="text-xs font-medium truncate leading-tight">{studentName}</span>
        {height >= 35 && (
          <span className="text-[10px] opacity-80 truncate leading-tight">{timeStr}</span>
        )}
        {height >= 50 && lesson.subject && (
          <span className="text-[10px] opacity-70 truncate leading-tight">{lesson.subject}</span>
        )}
      </div>
    </div>
  );
}

// =============================================
// WorkHoursSettings sidebar (kept for reference, not used in UI)
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
  const [lessonType, setLessonType] = useState<LessonType>('regular');
  const [subject, setSubject] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [repeatUntil, setRepeatUntil] = useState<Date | undefined>();
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
      setIsRecurring(false);
      setRepeatUntil(undefined);
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
    if (isRecurring && !repeatUntil) {
      toast.error('Выберите дату окончания повторений');
      return;
    }

    setIsSaving(true);
    try {
      const startAt = new Date(date);
      startAt.setHours(parseInt(hour), parseInt(minute), 0, 0);

      const tutorStudent = students.find(s => s.student_id === studentId);

      if (isRecurring && repeatUntil) {
        const { root, count } = await createLessonSeries(
          {
            tutor_student_id: tutorStudent?.id,
            student_id: studentId,
            start_at: startAt.toISOString(),
            duration_min: parseInt(duration),
            lesson_type: lessonType,
            subject: subject || undefined,
            notes: notes || undefined,
          },
          repeatUntil.toISOString()
        );

        if (root) {
          toast.success(`Создано ${count} занятий (еженедельно)`);
          onSuccess();
          onOpenChange(false);
        } else {
          toast.error('Не удалось создать серию занятий');
        }
      } else {
        const result = await createLesson({
          tutor_student_id: tutorStudent?.id,
          student_id: studentId,
          start_at: startAt.toISOString(),
          duration_min: parseInt(duration),
          lesson_type: lessonType,
          subject: subject || undefined,
          notes: notes || undefined
        });

        if (result) {
          toast.success('Занятие создано');
          onSuccess();
          onOpenChange(false);
        } else {
          toast.error('Не удалось создать занятие');
        }
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

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
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
              <Select value={lessonType} onValueChange={(v) => setLessonType(v as LessonType)}>
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

          {/* Recurring lesson */}
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Повторять еженедельно</Label>
                <p className="text-xs text-muted-foreground">Создать серию занятий каждую неделю</p>
              </div>
              <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
            </div>

            {isRecurring && (
              <div className="space-y-2">
                <Label>Повторять до *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !repeatUntil && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {repeatUntil ? format(repeatUntil, 'dd.MM.yyyy') : 'Выберите дату окончания'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={repeatUntil}
                      onSelect={setRepeatUntil}
                      locale={ru}
                      disabled={(d) => d < (date || new Date())}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                {repeatUntil && date && (
                  <p className="text-xs text-muted-foreground">
                    Будет создано ~{Math.min(60, Math.floor((repeatUntil.getTime() - date.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1)} занятий
                  </p>
                )}
              </div>
            )}
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
            {isSaving ? 'Сохранение...' : isRecurring ? 'Создать серию' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================
// LessonDetailsDialog (edit metadata + date/time)
// =============================================

interface LessonDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: TutorLessonWithStudent | null;
  students: TutorStudentWithProfile[];
  onCancel: () => void;
  onUpdate: () => void;
}

function LessonDetailsDialog({
  open,
  onOpenChange,
  lesson,
  students,
  onCancel,
  onUpdate
}: LessonDetailsDialogProps) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editStudentId, setEditStudentId] = useState<string>('');
  const [editLessonType, setEditLessonType] = useState<LessonType>('regular');
  const [editSubject, setEditSubject] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState<Date | undefined>();
  const [editHour, setEditHour] = useState('');
  const [editMinute, setEditMinute] = useState('00');
  // Series confirmation state
  const [seriesAction, setSeriesAction] = useState<'save' | 'cancel' | null>(null);

  // Reset edit state when dialog opens with a new lesson
  useEffect(() => {
    if (open && lesson) {
      const lessonStart = new Date(lesson.start_at);
      setIsEditing(false);
      setEditStudentId(lesson.student_id || '__none__');
      setEditLessonType((lesson.lesson_type as LessonType) || 'regular');
      setEditSubject(lesson.subject || '');
      setEditNotes(lesson.notes || '');
      setEditDate(lessonStart);
      setEditHour(lessonStart.getHours().toString());
      setEditMinute(lessonStart.getMinutes().toString().padStart(2, '0'));
    }
  }, [open, lesson]);

  if (!lesson) return null;

  const studentName = lesson.tutor_students?.profiles?.username
    || lesson.profiles?.username
    || 'Без ученика';

  const startDate = new Date(lesson.start_at);
  const endDate = addMinutes(startDate, lesson.duration_min);
  const dateStr = startDate.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  const timeStr = `${format(startDate, 'HH:mm')} — ${format(endDate, 'HH:mm')}`;

  const lessonType = lesson.lesson_type || 'regular';
  const typeLabel = getLessonTypeLabel(lessonType);

  const isSeriesLesson = !!lesson.is_recurring;

  const handleCancelClick = () => {
    if (isSeriesLesson) {
      setSeriesAction('cancel');
    } else {
      doCancel(false);
    }
  };

  const handleSaveClick = () => {
    if (!editDate) {
      toast.error('Выберите дату');
      return;
    }
    const hourValue = Number.parseInt(editHour, 10);
    const minuteValue = Number.parseInt(editMinute, 10);
    if (Number.isNaN(hourValue) || Number.isNaN(minuteValue)) {
      toast.error('Выберите время');
      return;
    }
    if (isSeriesLesson) {
      setSeriesAction('save');
    } else {
      doSave(false);
    }
  };

  const doCancel = async (wholeSeries: boolean) => {
    setIsCancelling(true);
    try {
      let result: boolean;
      if (wholeSeries) {
        result = await cancelLessonSeries(lesson);
      } else {
        result = !!(await cancelLesson(lesson.id));
      }
      if (result) {
        toast.success(wholeSeries ? 'Серия занятий отменена' : 'Занятие отменено');
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
      setSeriesAction(null);
    }
  };

  const doSave = async (wholeSeries: boolean) => {
    setIsSaving(true);
    try {
      const newStart = new Date(editDate!);
      newStart.setHours(Number.parseInt(editHour, 10), Number.parseInt(editMinute, 10), 0, 0);

      const actualStudentId = editStudentId === '__none__' ? '' : editStudentId;
      const tutorStudent = actualStudentId
        ? students.find(s => s.student_id === actualStudentId)
        : null;

      if (wholeSeries) {
        // For series: update metadata only (not time), applied to all lessons
        const result = await updateLessonSeries(lesson, {
          student_id: actualStudentId || undefined,
          tutor_student_id: tutorStudent?.id || undefined,
          lesson_type: editLessonType,
          subject: editSubject || undefined,
          notes: editNotes || undefined,
        });
        if (result) {
          toast.success('Серия занятий обновлена');
          setIsEditing(false);
          onUpdate();
        } else {
          toast.error('Не удалось обновить серию');
        }
      } else {
        const result = await updateLesson(lesson.id, {
          start_at: newStart.toISOString(),
          student_id: actualStudentId || undefined,
          tutor_student_id: tutorStudent?.id || undefined,
          lesson_type: editLessonType,
          subject: editSubject || undefined,
          notes: editNotes || undefined,
        });
        if (result) {
          toast.success('Занятие обновлено');
          setIsEditing(false);
          onUpdate();
        } else {
          toast.error('Не удалось обновить');
        }
      }
    } catch (err) {
      console.error(err);
      toast.error('Ошибка при обновлении');
    } finally {
      setIsSaving(false);
      setSeriesAction(null);
    }
  };

  return (
    <>
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

          {!isEditing ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant={lesson.source === 'self_booking' ? 'secondary' : 'outline'}>
                  {lesson.source === 'self_booking' ? 'Самозапись' : lesson.external_source === 'google_calendar' ? 'Google' : 'Вручную'}
                </Badge>
                <Badge variant={lesson.status === 'booked' ? 'default' : lesson.status === 'completed' ? 'secondary' : 'destructive'}>
                  {lesson.status === 'booked' ? 'Запланировано' : lesson.status === 'completed' ? 'Проведено' : 'Отменено'}
                </Badge>
                <Badge variant="outline">{typeLabel}</Badge>
                {lesson.subject && <Badge variant="outline">{lesson.subject}</Badge>}
                {lesson.is_recurring && <Badge variant="outline"><Repeat className="h-3 w-3 mr-1" />Серия</Badge>}
              </div>

              {lesson.notes && (
                <div className="bg-muted/50 p-3 rounded-md text-sm">
                  {lesson.notes}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Дата и время</Label>
                <div className="flex flex-wrap gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-[160px] justify-start text-left font-normal",
                          !editDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {editDate ? format(editDate, 'dd.MM.yyyy') : 'Выберите дату'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={editDate}
                        onSelect={setEditDate}
                        locale={ru}
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>

                  <div className="flex items-center gap-1">
                    <Select value={editHour} onValueChange={setEditHour}>
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
                    <Select value={editMinute} onValueChange={setEditMinute}>
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

              <div className="space-y-1.5">
                <Label className="text-xs">Ученик</Label>
                <Select value={editStudentId} onValueChange={setEditStudentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите ученика" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Без ученика</SelectItem>
                    {students.map(s => (
                      <SelectItem key={s.student_id} value={s.student_id}>
                        {s.profiles?.username || s.profiles?.telegram_username || 'Ученик'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Тип занятия</Label>
                <Select value={editLessonType} onValueChange={v => setEditLessonType(v as LessonType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LESSON_TYPES.map(lt => (
                      <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Предмет</Label>
                <Input
                  value={editSubject}
                  onChange={e => setEditSubject(e.target.value)}
                  placeholder="Предмет"
                  className="text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Заметки</Label>
                <Textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="Заметки"
                  rows={2}
                  className="text-base"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={() => setIsEditing(false)}>Отмена</Button>
              <Button onClick={handleSaveClick} disabled={isSaving}>
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </>
          ) : (
            lesson.status === 'booked' && (
              <>
                <Button variant="outline" onClick={() => setIsEditing(true)}>
                  Редактировать
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleCancelClick}
                  disabled={isCancelling}
                >
                  {isCancelling ? 'Отмена...' : 'Отменить занятие'}
                </Button>
              </>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Series confirmation AlertDialog */}
    <AlertDialog open={seriesAction !== null} onOpenChange={(open) => { if (!open) setSeriesAction(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {seriesAction === 'cancel' ? 'Отменить занятие' : 'Сохранить изменения'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {seriesAction === 'cancel'
              ? 'Это занятие — часть серии. Отменить только это занятие или всю серию?'
              : 'Это занятие — часть серии. Применить изменения только к этому занятию или ко всей серии?'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={() => setSeriesAction(null)}>Назад</AlertDialogCancel>
          <Button
            variant={seriesAction === 'cancel' ? 'destructive' : 'default'}
            onClick={() => seriesAction === 'cancel' ? doCancel(false) : doSave(false)}
            disabled={isCancelling || isSaving}
          >
            Только это занятие
          </Button>
          <Button
            variant={seriesAction === 'cancel' ? 'destructive' : 'default'}
            onClick={() => seriesAction === 'cancel' ? doCancel(true) : doSave(true)}
            disabled={isCancelling || isSaving}
          >
            Вся серия
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
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
  // Payment reminder settings
  const [paymentReminderEnabled, setPaymentReminderEnabled] = useState(settings?.payment_reminder_enabled ?? false);
  const [paymentReminderDelay, setPaymentReminderDelay] = useState(settings?.payment_reminder_delay_minutes?.toString() || '0');
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
      setPaymentReminderEnabled(settings.payment_reminder_enabled ?? false);
      setPaymentReminderDelay((settings.payment_reminder_delay_minutes ?? 0).toString());
    }
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { data, error } = await upsertCalendarSettings({
        default_duration: parseInt(defaultDuration),
        buffer_minutes: parseInt(bufferMinutes),
        min_notice_hours: parseInt(minNoticeHours),
        max_advance_days: parseInt(maxAdvanceDays),
        auto_confirm: autoConfirm,
        allow_student_cancel: allowStudentCancel,
        cancel_notice_hours: parseInt(cancelNoticeHours),
        payment_reminder_enabled: paymentReminderEnabled,
        payment_reminder_delay_minutes: parseInt(paymentReminderDelay),
      });

      if (data) {
        toast.success('Настройки сохранены');
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error(error ? `Не удалось сохранить: ${error}` : 'Не удалось сохранить');
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

          {/* Payment Reminders */}
          <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-medium flex items-center gap-2">
              💰 Напоминания об оплате
            </Label>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Напоминать об оплате в Telegram</Label>
                <p className="text-xs text-muted-foreground">После завершения занятия</p>
              </div>
              <Switch checked={paymentReminderEnabled} onCheckedChange={setPaymentReminderEnabled} />
            </div>
            {paymentReminderEnabled && (
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Когда напоминать</Label>
                <Select value={paymentReminderDelay} onValueChange={setPaymentReminderDelay}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Сразу после занятия</SelectItem>
                    <SelectItem value="5">Через 5 минут</SelectItem>
                    <SelectItem value="15">Через 15 минут</SelectItem>
                    <SelectItem value="30">Через 30 минут</SelectItem>
                    <SelectItem value="60">Через 1 час</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
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
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !newExceptionDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
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
                placeholder="Причина"
                value={newExceptionReason}
                onChange={(e) => setNewExceptionReason(e.target.value)}
                className="flex-1"
              />
              <Button size="sm" onClick={handleAddException} disabled={!newExceptionDate}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
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
// Payment Onboarding Dialog
// =============================================

interface PaymentOnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnablePaymentReminders: () => void;
}

function PaymentOnboardingDialog({ open, onOpenChange, onEnablePaymentReminders }: PaymentOnboardingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            💰 Отслеживание оплаты
          </DialogTitle>
          <DialogDescription>
            Новая функция для фиксации оплаты занятий
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
              1
            </div>
            <div>
              <p className="font-medium text-sm">Занятие завершилось</p>
              <p className="text-sm text-muted-foreground">Бот спросит в Telegram о статусе оплаты</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
              2
            </div>
            <div>
              <p className="font-medium text-sm">Выберите статус</p>
              <p className="text-sm text-muted-foreground">Оплачено, оплачено ранее или оплатит позже</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
              3
            </div>
            <div>
              <p className="font-medium text-sm">История сохраняется</p>
              <p className="text-sm text-muted-foreground">Вся информация доступна в карточке занятия</p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Позже
          </Button>
          <Button onClick={onEnablePaymentReminders} className="w-full sm:w-auto">
            Включить напоминания
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
    error: studentsError,
    refetch: refetchStudents,
    isFetching: studentsIsFetching,
    isRecovering: studentsIsRecovering,
    failureCount: studentsFailureCount,
  } = useTutorStudents();
  const {
    slots,
    loading: slotsLoading,
    error: slotsError,
    refetch: refetchSlots,
    isFetching: slotsIsFetching,
    isRecovering: slotsIsRecovering,
    failureCount: slotsFailureCount,
  } = useTutorWeeklySlots();
  const {
    settings: reminderSettings,
    error: reminderError,
    refetch: refetchReminderSettings,
    isFetching: reminderIsFetching,
    isRecovering: reminderIsRecovering,
    failureCount: reminderFailureCount,
  } = useTutorReminderSettings();
  const {
    settings: calendarSettings,
    error: calendarError,
    refetch: refetchCalendarSettings,
    isFetching: calendarIsFetching,
    isRecovering: calendarIsRecovering,
    failureCount: calendarFailureCount,
  } = useTutorCalendarSettings();
  const {
    exceptions,
    error: exceptionsError,
    refetch: refetchExceptions,
    isFetching: exceptionsIsFetching,
    isRecovering: exceptionsIsRecovering,
    failureCount: exceptionsFailureCount,
  } = useTutorAvailabilityExceptions();

  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings>(loadSettings);

  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const {
    lessons,
    loading: lessonsLoading,
    error: lessonsError,
    refetch: refetchLessons,
    isFetching: lessonsIsFetching,
    isRecovering: lessonsIsRecovering,
    failureCount: lessonsFailureCount,
  } = useTutorLessons(weekStart);

  // Dialogs
  const [addLessonOpen, setAddLessonOpen] = useState(false);
  const [lessonDetailsOpen, setLessonDetailsOpen] = useState(false);
  const [reminderSettingsOpen, setReminderSettingsOpen] = useState(false);
  const [calendarSettingsOpen, setCalendarSettingsOpen] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<TutorLessonWithStudent | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number>(0);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [optimisticStartsByLessonId, setOptimisticStartsByLessonId] = useState<Record<string, string>>({});
  const draggedLessonIdRef = useRef<string | null>(null);
  const draggedLessonDurationRef = useRef<number>(60);
  const isLessonDragInProgressRef = useRef(false);
  const suppressNextGridClickRef = useRef(false);

  const [copiedLink, setCopiedLink] = useState(false);

  // Payment onboarding
  const [paymentOnboardingOpen, setPaymentOnboardingOpen] = useState(false);

  // Google Calendar
  const [gcalConnected, setGcalConnected] = useState(false);
  const [gcalEmail, setGcalEmail] = useState<string | null>(null);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalImporting, setGcalImporting] = useState(false);
  const gcalChecked = useRef(false);

  // Check if payment onboarding should be shown (once per tutor)
  useEffect(() => {
    if (tutor && calendarSettings !== null) {
      const onboardingKey = `payment_onboarding_shown_${tutor.id}`;
      const hasShown = localStorage.getItem(onboardingKey);
      // Show onboarding only if not shown before and payment reminders are not yet enabled
      if (!hasShown && !calendarSettings?.payment_reminder_enabled) {
        setPaymentOnboardingOpen(true);
        localStorage.setItem(onboardingKey, 'true');
      }
    }
  }, [tutor, calendarSettings]);

  // Check Google Calendar connection status + handle ?gcal=connected param
  useEffect(() => {
    if (gcalChecked.current) return;
    gcalChecked.current = true;

    const params = new URLSearchParams(window.location.search);
    if (params.get('gcal') === 'connected') {
      toast.success('Google Calendar подключён');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('gcal') === 'error') {
      const reason = params.get('reason') || 'unknown';
      toast.error(`Ошибка подключения Google Calendar: ${reason}`);
      window.history.replaceState({}, '', window.location.pathname);
    }

    getGoogleCalendarStatus().then(status => {
      if (status) {
        setGcalConnected(status.connected);
        setGcalEmail(status.google_email || null);
      }
    });
  }, []);

  const handleConnectGoogle = useCallback(async () => {
    setGcalLoading(true);
    try {
      const result = await getGoogleCalendarAuthUrl();
      if (result.url) {
        window.location.href = result.url;
      } else {
        const detail = result.error ? `: ${result.error}` : '';
        toast.error(`Не удалось получить ссылку авторизации Google${detail}`);
      }
    } catch {
      toast.error('Ошибка подключения Google Calendar');
    } finally {
      setGcalLoading(false);
    }
  }, []);

  const handleDisconnectGoogle = useCallback(async () => {
    setGcalLoading(true);
    try {
      const ok = await disconnectGoogleCalendar();
      if (ok) {
        setGcalConnected(false);
        setGcalEmail(null);
        toast.success('Google Calendar отключён');
      } else {
        toast.error('Не удалось отключить');
      }
    } catch {
      toast.error('Ошибка отключения Google Calendar');
    } finally {
      setGcalLoading(false);
    }
  }, []);

  const handleImportGoogle = useCallback(async () => {
    setGcalImporting(true);
    try {
      // Import current week + next 4 weeks
      const start = new Date(weekStart);
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 35);

      const result = await importGoogleCalendarEvents(
        start.toISOString(),
        end.toISOString()
      );

      if (result) {
        const parts: string[] = [];
        if (result.imported > 0) parts.push(`импортировано: ${result.imported}`);
        if (result.updated > 0) parts.push(`обновлено: ${result.updated}`);
        if (result.cancelled > 0) parts.push(`отменено: ${result.cancelled}`);
        if (result.skipped > 0) parts.push(`пропущено: ${result.skipped}`);
        toast.success(parts.length > 0 ? parts.join(', ') : 'Нет новых событий');
        refetchLessons();
      } else {
        toast.error('Ошибка импорта из Google Calendar');
      }
    } catch {
      toast.error('Ошибка импорта');
    } finally {
      setGcalImporting(false);
    }
  }, [weekStart, refetchLessons]);

  const handleEnablePaymentReminders = useCallback(async () => {
    const { error } = await upsertCalendarSettings({ payment_reminder_enabled: true, payment_reminder_delay_minutes: 0 });
    if (error) {
      toast.error(error ? `Не удалось включить напоминания: ${error}` : 'Не удалось включить напоминания');
      return;
    }
    refetchCalendarSettings();
    setPaymentOnboardingOpen(false);
    toast.success('Напоминания об оплате включены!');
  }, [refetchCalendarSettings]);

  // Telegram linking
  const [linkingTelegram, setLinkingTelegram] = useState(false);

  const handleLinkTelegram = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Необходимо войти в систему');
        return;
      }

      setLinkingTelegram(true);

      // Get link token
      const response = await supabase.functions.invoke('telegram-login-token', {
        body: { action: 'link', user_id: user.id }
      });

      if (response.error) {
        throw response.error;
      }

      const { token } = response.data;

      // Open Telegram bot with link token
      window.open(`https://t.me/sokratai_ru_bot?start=link_${token}`, '_blank');

      toast.info('Подтвердите связку в Telegram боте');

      // Simple timeout to reset state (user will see update on next page load)
      setTimeout(() => {
        setLinkingTelegram(false);
      }, 5000);
    } catch (error) {
      console.error('Error linking Telegram:', error);
      toast.error('Ошибка при связывании Telegram');
      setLinkingTelegram(false);
    }
  }, []);

  // Sync settings to DB on initial load
  useEffect(() => {
    syncWorkHoursToSlots(
      scheduleSettings.workDays,
      scheduleSettings.workDayStart,
      scheduleSettings.workDayEnd
    );
  }, []); // Only on mount

  const loading = slotsLoading || lessonsLoading;
  const hasScheduleData = slots.length > 0 || lessons.length > 0;
  const hasCriticalError = Boolean(slotsError || lessonsError);
  const showInitialSkeleton = loading && !hasScheduleData && !hasCriticalError;
  const pageError = slotsError || lessonsError || tutorError || studentsError || reminderError || calendarError || exceptionsError;
  const pageIsFetching =
    tutorIsFetching ||
    studentsIsFetching ||
    slotsIsFetching ||
    lessonsIsFetching ||
    reminderIsFetching ||
    calendarIsFetching ||
    exceptionsIsFetching;
  const pageIsRecovering =
    tutorIsRecovering ||
    studentsIsRecovering ||
    slotsIsRecovering ||
    lessonsIsRecovering ||
    reminderIsRecovering ||
    calendarIsRecovering ||
    exceptionsIsRecovering;
  const pageFailureCount = Math.max(
    tutorFailureCount,
    studentsFailureCount,
    slotsFailureCount,
    lessonsFailureCount,
    reminderFailureCount,
    calendarFailureCount,
    exceptionsFailureCount,
  );

  const handleRetryAll = useCallback(() => {
    refetchTutor();
    refetchStudents();
    refetchSlots();
    refetchLessons();
    refetchReminderSettings();
    refetchCalendarSettings();
    refetchExceptions();
  }, [
    refetchCalendarSettings,
    refetchExceptions,
    refetchLessons,
    refetchReminderSettings,
    refetchSlots,
    refetchStudents,
    refetchTutor,
  ]);

  const visibleHours = useMemo(() => {
    return Array.from(
      { length: scheduleSettings.workDayEnd - scheduleSettings.workDayStart },
      (_, i) => scheduleSettings.workDayStart + i
    );
  }, [scheduleSettings]);

  const gridHeight = visibleHours.length * HOUR_HEIGHT;

  const effectiveLessons = useMemo(() => {
    if (Object.keys(optimisticStartsByLessonId).length === 0) return lessons;
    return lessons.map(lesson => (
      optimisticStartsByLessonId[lesson.id]
        ? { ...lesson, start_at: optimisticStartsByLessonId[lesson.id] }
        : lesson
    ));
  }, [lessons, optimisticStartsByLessonId]);

  useEffect(() => {
    setOptimisticStartsByLessonId({});
    setDragPreview(null);
    draggedLessonIdRef.current = null;
    draggedLessonDurationRef.current = 60;
    isLessonDragInProgressRef.current = false;
  }, [weekStart]);

  const lessonsByDay = useMemo(() => {
    const byDay: Record<number, TutorLessonWithStudent[]> = {};
    for (let i = 0; i < 7; i++) byDay[i] = [];

    for (const lesson of effectiveLessons) {
      if (lesson.status !== 'booked') continue;

      const startDate = new Date(lesson.start_at);
      const dayOfWeek = (startDate.getDay() + 6) % 7;
      const lessonHour = startDate.getHours();

      if (lessonHour >= scheduleSettings.workDayStart && lessonHour < scheduleSettings.workDayEnd) {
        byDay[dayOfWeek].push(lesson);
      }
    }

    return byDay;
  }, [effectiveLessons, scheduleSettings]);

  // Stats
  const todayLessons = useMemo(() => {
    const today = new Date();
    return effectiveLessons.filter(l => {
      const d = new Date(l.start_at);
      return l.status === 'booked' && d.toDateString() === today.toDateString();
    }).length;
  }, [effectiveLessons]);

  const weekLessons = useMemo(() => {
    return effectiveLessons.filter(l => l.status === 'booked').length;
  }, [effectiveLessons]);

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

  const getSnappedTimeFromPosition = useCallback((positionY: number, durationMin: number = 0) => {
    const workStartMinutes = scheduleSettings.workDayStart * 60;
    const workEndMinutes = scheduleSettings.workDayEnd * 60;
    const minutesFromStart = Math.floor(positionY / PIXELS_PER_MINUTE);
    const rawTotalMinutes = workStartMinutes + minutesFromStart;
    const roundedTotalMinutes = Math.round(rawTotalMinutes / 15) * 15;
    const latestAllowedStart = Math.max(workStartMinutes, workEndMinutes - durationMin);
    const clampedTotalMinutes = Math.max(
      workStartMinutes,
      Math.min(roundedTotalMinutes, latestAllowedStart)
    );

    return {
      hour: Math.floor(clampedTotalMinutes / 60),
      minute: clampedTotalMinutes % 60
    };
  }, [scheduleSettings.workDayStart, scheduleSettings.workDayEnd]);

  const handleGridClick = useCallback((dayOfWeek: number, clickY: number) => {
    const { hour, minute } = getSnappedTimeFromPosition(clickY);

    const date = getDateForDayOfWeek(weekStart, dayOfWeek);
    setSelectedDate(date);
    setSelectedHour(hour);
    setSelectedMinute(minute);
    setAddLessonOpen(true);
  }, [getSnappedTimeFromPosition, weekStart]);

  const handleLessonClick = useCallback((lesson: TutorLessonWithStudent) => {
    if (isLessonDragInProgressRef.current) return;
    setSelectedLesson(lesson);
    setLessonDetailsOpen(true);
  }, []);

  const handleLessonDragStart = useCallback((lessonId: string, durationMin: number, event: React.DragEvent<HTMLDivElement>) => {
    isLessonDragInProgressRef.current = true;
    draggedLessonIdRef.current = lessonId;
    draggedLessonDurationRef.current = durationMin;
    setDragPreview(null);
    event.dataTransfer.setData('text/plain', lessonId);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleLessonDragEnd = useCallback(() => {
    setDragPreview(null);
    draggedLessonDurationRef.current = 60;
    // Reset immediately so click handler is not blocked
    isLessonDragInProgressRef.current = false;
    draggedLessonIdRef.current = null;
    suppressNextGridClickRef.current = true;
  }, []);

  const handleDayDragOver = useCallback((dayIndex: number, isWorkDay: boolean, event: React.DragEvent<HTMLDivElement>) => {
    if (!isWorkDay) {
      setDragPreview(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const draggedLessonId = event.dataTransfer.getData('text/plain') || draggedLessonIdRef.current;
    if (!draggedLessonId) return;

    const draggedLesson = effectiveLessons.find(l => l.id === draggedLessonId && l.status === 'booked');
    const durationMin = draggedLesson?.duration_min || draggedLessonDurationRef.current;

    const rect = event.currentTarget.getBoundingClientRect();
    const positionY = Math.max(0, Math.min(event.clientY - rect.top, gridHeight));
    const { hour, minute } = getSnappedTimeFromPosition(positionY, durationMin);
    const topPx = ((hour * 60) + minute - (scheduleSettings.workDayStart * 60)) * PIXELS_PER_MINUTE;

    setDragPreview((prev) => {
      if (
        prev &&
        prev.visible &&
        prev.dayIndex === dayIndex &&
        prev.topPx === topPx &&
        prev.durationMin === durationMin
      ) {
        return prev;
      }

      return {
        dayIndex,
        topPx,
        durationMin,
        visible: true
      };
    });
  }, [effectiveLessons, getSnappedTimeFromPosition, gridHeight, scheduleSettings.workDayStart]);

  const handleLessonDrop = useCallback(async (dayIndex: number, isWorkDay: boolean, event: React.DragEvent<HTMLDivElement>) => {
    if (!isWorkDay) {
      setDragPreview(null);
      return;
    }

    event.preventDefault();
    setDragPreview(null);

    const draggedLessonId = event.dataTransfer.getData('text/plain') || draggedLessonIdRef.current;
    if (!draggedLessonId) return;

    const draggedLesson = effectiveLessons.find(l => l.id === draggedLessonId && l.status === 'booked');
    if (!draggedLesson) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const positionY = Math.max(0, Math.min(event.clientY - rect.top, gridHeight));
    const { hour, minute } = getSnappedTimeFromPosition(positionY, draggedLesson.duration_min);
    const newStart = getDateForDayOfWeek(weekStart, dayIndex);
    newStart.setHours(hour, minute, 0, 0);

    if (newStart.getTime() === new Date(draggedLesson.start_at).getTime()) {
      suppressNextGridClickRef.current = true;
      return;
    }

    suppressNextGridClickRef.current = true;
    const optimisticStartIso = newStart.toISOString();
    setOptimisticStartsByLessonId((prev) => ({
      ...prev,
      [draggedLesson.id]: optimisticStartIso
    }));

    try {
      const result = await updateLesson(draggedLesson.id, {
        start_at: optimisticStartIso
      });

      if (result) {
        setOptimisticStartsByLessonId((prev) => {
          const { [draggedLesson.id]: _removed, ...rest } = prev;
          return rest;
        });
        toast.success('Занятие перенесено');
        refetchLessons();
      } else {
        setOptimisticStartsByLessonId((prev) => {
          const { [draggedLesson.id]: _removed, ...rest } = prev;
          return rest;
        });
        toast.error('Не удалось перенести');
      }
    } catch (error) {
      console.error(error);
      setOptimisticStartsByLessonId((prev) => {
        const { [draggedLesson.id]: _removed, ...rest } = prev;
        return rest;
      });
      toast.error('Ошибка при переносе');
    }
  }, [effectiveLessons, getSnappedTimeFromPosition, gridHeight, refetchLessons, weekStart]);

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

  const weekTitle = useMemo(() => {
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 6);
    return `${formatDate(weekStart)} — ${formatDate(endDate)}`;
  }, [weekStart]);

  if (showInitialSkeleton) {
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
        <TutorDataStatus
          error={pageError}
          isFetching={pageIsFetching}
          isRecovering={pageIsRecovering}
          failureCount={pageFailureCount}
          onRetry={handleRetryAll}
        />

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

            {/* Google Calendar */}
            {gcalConnected ? (
              <>
                <Button
                  onClick={handleImportGoogle}
                  variant="outline"
                  size="sm"
                  disabled={gcalImporting}
                  title={gcalEmail ? `Google: ${gcalEmail}` : 'Импорт из Google'}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {gcalImporting ? 'Импорт...' : 'Импорт из Google'}
                </Button>
                <Button
                  onClick={handleDisconnectGoogle}
                  variant="ghost"
                  size="icon"
                  disabled={gcalLoading}
                  title="Отключить Google Calendar"
                >
                  <Unplug className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button
                onClick={handleConnectGoogle}
                variant="outline"
                size="sm"
                disabled={gcalLoading}
              >
                <CalendarIcon className="h-4 w-4 mr-2" />
                {gcalLoading ? 'Подключение...' : 'Google Calendar'}
              </Button>
            )}
          </div>
        </div>

        {/* Telegram status */}
        {tutor && (
          tutor.telegram_username ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MessageCircle className="h-4 w-4 text-blue-500" />
              <span>Telegram: <span className="text-blue-600 font-medium">@{tutor.telegram_username}</span></span>
            </div>
          ) : (
            <Alert className="bg-blue-50 border-blue-200">
              <MessageCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="flex items-center justify-between">
                <span className="text-blue-800">
                  Подключите Telegram, чтобы получать уведомления о новых записях учеников
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-4 border-blue-300 text-blue-700 hover:bg-blue-100"
                  onClick={handleLinkTelegram}
                  disabled={linkingTelegram}
                >
                  <MessageCircle className="h-4 w-4 mr-2" />
                  {linkingTelegram ? 'Открываем...' : 'Подключить'}
                </Button>
              </AlertDescription>
            </Alert>
          )
        )}

        {/* Stats bar */}
        <div className="flex flex-wrap gap-4 text-sm">
          {LESSON_TYPES.map(t => (
            <div key={t.value} className="flex items-center gap-2">
              <div className={cn("w-3 h-3 rounded", t.color)} />
              <span>{t.shortLabel}</span>
            </div>
          ))}
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

        {/* Calendar grid - full width, no internal vertical scroll */}
        <Card animate={false}>
          <CardContent className="p-0 overflow-visible">
            <div className="overflow-x-auto overflow-y-hidden max-h-none">
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
                          onDragOver={(e) => handleDayDragOver(dayIndex, isWorkDay, e)}
                          onDrop={(e) => handleLessonDrop(dayIndex, isWorkDay, e)}
                          onClick={(e) => {
                            if (suppressNextGridClickRef.current) {
                              suppressNextGridClickRef.current = false;
                              return;
                            }
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

                          {/* Drag preview */}
                          {dragPreview?.visible && dragPreview.dayIndex === dayIndex && (
                            <>
                              <div
                                className="absolute left-0.5 right-0.5 rounded-md border border-primary/40 bg-primary/15 pointer-events-none z-20"
                                style={{
                                  top: `${dragPreview.topPx}px`,
                                  height: `${Math.max(4, dragPreview.durationMin * PIXELS_PER_MINUTE)}px`
                                }}
                              />
                              <div
                                className="absolute left-0 right-0 h-0.5 bg-primary pointer-events-none z-30"
                                style={{ top: `${dragPreview.topPx}px` }}
                              />
                            </>
                          )}

                          {/* Lessons */}
                          {dayLessons.map(lesson => (
                            <LessonBlock
                              key={lesson.id}
                              lesson={lesson}
                              workDayStart={scheduleSettings.workDayStart}
                              onClick={() => handleLessonClick(lesson)}
                              onDragStart={(event) => handleLessonDragStart(lesson.id, lesson.duration_min, event)}
                              onDragEnd={handleLessonDragEnd}
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
          students={students}
          onCancel={() => refetchLessons()}
          onUpdate={() => refetchLessons()}
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

        <PaymentOnboardingDialog
          open={paymentOnboardingOpen}
          onOpenChange={setPaymentOnboardingOpen}
          onEnablePaymentReminders={handleEnablePaymentReminders}
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
