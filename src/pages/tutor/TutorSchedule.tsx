import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Link2, Copy, Check, Plus, X, Clock, Bell, Settings, CalendarIcon, Trash2, CalendarDays, MessageCircle, Repeat, FileText, ClipboardCheck, Wallet, Ban, PenLine } from 'lucide-react';
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
import { DateTimeField } from '@/components/ui/date-time-field';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/formatters';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import ConfettiBurst from '@/components/ConfettiBurst';
import { useTutor, useTutorWeeklySlots, useTutorLessons, useTutorCalendarEvents, useTutorStudents, useTutorReminderSettings, useTutorCalendarSettings, useTutorAvailabilityExceptions, useTutorGroups, weekRangeISO } from '@/hooks/useTutor';
import { getBookingLink } from '@/lib/tutors';
import {
  syncMyDueDebits,
  setLessonCost,
  setParticipantCost,
  setLessonCostSeries,
  setParticipantCostSeries,
  moveLesson,
  cancelLessonWithCharge,
  type CostSeriesScope,
} from '@/lib/tutorBalanceApi';
import { calculateLessonPaymentAmount } from '@/lib/paymentAmount';
import {
  createCalendarEvent,
  createCalendarEventSeries,
  updateCalendarEvent,
  updateCalendarEventSeries,
  deleteCalendarEventsScoped,
  getTutorCalendarEvents,
  type DeleteCalendarEventScope,
} from '@/lib/tutorCalendarEvents';
import { TUTOR_STALE_TIME_MS } from '@/hooks/tutorQueryOptions';
import {
  createWeeklySlot,
  toggleSlotAvailability,
  deleteWeeklySlot,
  getTutorLessons,
  cancelLesson,
  upsertReminderSettings,
  upsertCalendarSettings,
  createAvailabilityException,
  deleteAvailabilityException,
  syncWorkHoursToSlots,
  updateLesson,
  completeLessonAndCreatePayment,
  getLessonSeriesCount,
  updateLessonSeries,
  cancelLessonSeries,
  deleteLessonsScoped,
  type DeleteLessonScope
} from '@/lib/tutorSchedule';
import {
  getLessonParticipants,
  addLessonParticipant,
  removeLessonParticipant,
  addStudentToGroupFutureLessons,
  type MiniGroupCreateResult,
} from '@/lib/tutorScheduleGroupCreate';
import {
  runCancelGroupAction,
  runCompleteGroupAction,
  runMoveGroupAction,
  runMoveGroupLesson,
  runCancelGroupLesson,
  runCompleteGroupLesson,
  type GroupActionSummary,
} from '@/lib/tutorScheduleGroupActions';
import type {
  LessonType,
  TutorAvailabilityException,
  TutorCalendarEvent,
  TutorCalendarSettings,
  TutorGroup,
  TutorGroupMembership,
  TutorLessonParticipantWithStudent,
  TutorLessonWithStudent,
  TutorReminderSettings,
  TutorStudentWithProfile,
  TutorWeeklySlot,
} from '@/types/tutor';
import MonthIncomeStrip from '@/components/tutor/schedule/MonthIncomeStrip';
import {
  LessonBlock,
  GroupLessonBlock,
  CalendarEventBlock,
  DragPreviewLayer,
  getLessonStudentName,
  PIXELS_PER_MINUTE,
  HOUR_HEIGHT,
  type DragPreviewHandle,
  type GroupLessonBucket,
  type GroupLessonStatusCounts,
  type DayLessonRenderItem,
} from '@/components/tutor/schedule/LessonBlocks';
import { LESSON_TYPES, getLessonTypeLabel } from '@/components/tutor/schedule/scheduleColors';
import { useLessonMaterialFlags } from '@/hooks/useLessonMaterialFlags';
import { QuickAddMenu, type QuickAddMenuState } from '@/components/tutor/schedule/QuickAddMenu';
import TopupDialog, { type TopupStudentOption } from '@/components/tutor/students/TopupDialog';

// schedule-materials: drawer to attach recording/PDF/homework to a lesson.
// Lazy — keeps this large page's chunk lean (performance.md); only loads on first open.
const LessonMaterialsDrawer = lazy(() =>
  import('@/components/tutor/schedule/LessonMaterialsDrawer').then((m) => ({
    default: m.LessonMaterialsDrawer,
  })),
);

const PostLessonSheet = lazy(() =>
  import('@/components/tutor/schedule/PostLessonSheet').then((m) => ({
    default: m.PostLessonSheet,
  })),
);

// Форма создания занятия — извлечена из монолита (Волна 1, rule 10), lazy:
// грузится при первом открытии, основной чанк страницы худеет.
const AddLessonDialog = lazy(() =>
  import('@/components/tutor/schedule/AddLessonDialog').then((m) => ({
    default: m.AddLessonDialog,
  })),
);

// =============================================
// Constants & Utils
// =============================================

const DAYS_OF_WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

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

function getLessonStatusLabel(status: TutorLessonWithStudent['status']): string {
  switch (status) {
    case 'booked':
      return 'Запланировано';
    case 'completed':
      return 'Проведено';
    case 'cancelled':
      return 'Отменено';
    default:
      return 'Статус неизвестен';
  }
}

// generateGroupSessionId переехал в @/lib/tutorScheduleGroupCreate (Волна 1,
// вместе с извлечением AddLessonDialog).

function toDateTimeLocalValue(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

interface GroupDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bucket: GroupLessonBucket | null;
  onActionApplied?: () => void;
  onParticipantPaymentUpdated?: () => void;
  onOpenMaterials?: (lesson: TutorLessonWithStudent) => void;
  students?: TutorStudentWithProfile[];
}

function GroupDetailsDialog({
  open,
  onOpenChange,
  bucket,
  onActionApplied,
  onParticipantPaymentUpdated,
  onOpenMaterials,
  students = [],
}: GroupDetailsDialogProps) {
  // См. комментарий у LessonDetailsDialog: доска открывается маршрутом-резолвером.
  const navigate = useNavigate();
  const [moveDateTimeValue, setMoveDateTimeValue] = useState('');
  const [isActionSaving, setIsActionSaving] = useState(false);
  const [actionSummary, setActionSummary] = useState<GroupActionSummary | null>(null);
  const [confirmAction, setConfirmAction] = useState<'cancel' | 'complete' | null>(null);
  const [showGroupDelete, setShowGroupDelete] = useState(false);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [isMutatingParticipants, setIsMutatingParticipants] = useState(false);
  const [addParticipantId, setAddParticipantId] = useState('');
  // Охват добавления участника: только это занятие / все будущие занятия группы.
  const [addScope, setAddScope] = useState<'this' | 'future'>('this');
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [editGroupSubject, setEditGroupSubject] = useState('');
  const [editGroupTopic, setEditGroupTopic] = useState('');
  const [editGroupNotes, setEditGroupNotes] = useState('');
  // Волна 2: введённая цена участника серийной группы ждёт выбора scope.
  const [participantCostScope, setParticipantCostScope] = useState<{
    participantRowId: string;
    tutorStudentId: string;
    amount: number;
  } | null>(null);
  const [groupSeriesAction, setGroupSeriesAction] = useState<'save' | 'cancel' | null>(null);
  const [groupMoveScopeOpen, setGroupMoveScopeOpen] = useState(false);
  const [isGroupSaving, setIsGroupSaving] = useState(false);
  const [participants, setParticipants] = useState<TutorLessonParticipantWithStudent[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [isParticipantPaymentSaving, setIsParticipantPaymentSaving] = useState(false);
  const [participantPaymentError, setParticipantPaymentError] = useState<string | null>(null);
  // Phase 2b: per-participant cost editor (cost-driven списание; заменяет paid/pending тумблер)
  const [participantCostText, setParticipantCostText] = useState('');
  const [, setLastParticipantActionStatus] = useState<string | null>(null);

  // Detect unified group lesson (single lesson row with group_session_id)
  const isUnifiedGroupLesson = !!(bucket?.groupSessionId && bucket.lessons.length === 1 && !bucket.lessons[0].tutor_student_id);

  const startDate = bucket ? new Date(bucket.startAt) : null;
  const endDate = startDate ? addMinutes(startDate, bucket.durationMin) : null;

  // Load participants for unified group lessons
  useEffect(() => {
    // Сбрасываем выбор добавления при смене занятия/группы — иначе scope
    // «Все будущие занятия группы» залипал бы и молча создавал обязательства
    // на следующей открытой группе (review P1).
    setAddScope('this');
    setAddParticipantId('');
    if (!open || !bucket || !isUnifiedGroupLesson) {
      setParticipants([]);
      return;
    }
    const lessonId = bucket.lessons[0].id;
    setParticipantsLoading(true);
    getLessonParticipants(lessonId)
      .then((data) => {
        setParticipants(data);
      })
      .catch((error) => {
        console.error('Failed to load lesson participants:', error);
        setParticipants([]);
      })
      .finally(() => {
        setParticipantsLoading(false);
      });
  }, [open, bucket?.key, isUnifiedGroupLesson]);

  // Legacy per-lesson action items
  const groupActionLessons = useMemo(() => {
    if (!bucket || isUnifiedGroupLesson) return [];
    return bucket.lessons.map((lesson) => ({
      lessonId: lesson.id,
      tutorStudentId: lesson.tutor_student_id,
      studentName: getLessonStudentName(lesson),
      status: lesson.status,
      startAt: lesson.start_at,
      durationMin: lesson.duration_min,
      hourlyRateCents: lesson.tutor_students?.hourly_rate_cents ?? null,
    }));
  }, [bucket, isUnifiedGroupLesson]);

  const mainLesson = bucket?.lessons[0] ?? null;
  const lessonStatus = mainLesson?.status ?? 'booked';
  const selectedParticipant = useMemo(
    () => participants.find((participant) => participant.id === selectedParticipantId) ?? null,
    [participants, selectedParticipantId],
  );

  const getParticipantName = useCallback((participant: TutorLessonParticipantWithStudent) => {
    return participant.tutor_students?.profiles?.username ?? 'Ученик';
  }, []);

  const bookedCount = useMemo(() => {
    if (isUnifiedGroupLesson) return lessonStatus === 'booked' ? 1 : 0;
    return groupActionLessons.filter((l) => l.status === 'booked').length;
  }, [isUnifiedGroupLesson, lessonStatus, groupActionLessons]);

  const completeEligibleCount = useMemo(() => {
    if (isUnifiedGroupLesson) {
      if (lessonStatus !== 'booked' || !mainLesson) return 0;
      const lessonEnd = addMinutes(new Date(mainLesson.start_at), mainLesson.duration_min);
      return lessonEnd.getTime() < Date.now() ? 1 : 0;
    }
    return groupActionLessons.filter((lesson) => {
      if (lesson.status !== 'booked') return false;
      const lessonEnd = addMinutes(new Date(lesson.startAt), lesson.durationMin);
      return lessonEnd.getTime() < Date.now();
    }).length;
  }, [isUnifiedGroupLesson, lessonStatus, mainLesson, groupActionLessons]);

  const retryableFailedItems = useMemo(
    () => (actionSummary?.results ?? []).filter((result) => !result.ok && !result.skipped),
    [actionSummary]
  );

  useEffect(() => {
    if (!open || !bucket) {
      setMoveDateTimeValue('');
      setActionSummary(null);
      setConfirmAction(null);
      setSelectedParticipantId(null);
      setParticipantPaymentError(null);
      setLastParticipantActionStatus(null);
      return;
    }
    setMoveDateTimeValue(toDateTimeLocalValue(bucket.startAt));
    setActionSummary(null);
    setConfirmAction(null);
    setSelectedParticipantId(null);
    setParticipantPaymentError(null);
    setLastParticipantActionStatus(null);
    const ml = bucket.lessons[0];
    setEditGroupSubject(ml?.subject || '');
    setEditGroupTopic(ml?.topic || '');
    setEditGroupNotes(ml?.notes || '');
    setShowGroupEdit(false);
    setGroupSeriesAction(null);
  }, [open, bucket?.key, bucket?.startAt]);

  const runAction = useCallback(async (
    action: 'move' | 'cancel' | 'complete',
    targetLessonIds?: string[],
  ) => {
    if (!bucket) return;
    if (isActionSaving) return;

    setIsActionSaving(true);
    try {
      let summary: GroupActionSummary;

      if (isUnifiedGroupLesson && mainLesson) {
        // Unified: single lesson actions
        const participantNames = participants.map((participant) => getParticipantName(participant));
        const lessonInfo = {
          lessonId: mainLesson.id,
          status: mainLesson.status as 'booked' | 'completed' | 'cancelled',
          startAt: mainLesson.start_at,
          durationMin: mainLesson.duration_min,
          participantNames,
        };

        if (action === 'move') {
          const newStartAt = fromDateTimeLocalValue(moveDateTimeValue);
          if (!newStartAt) {
            toast.error('Выберите корректную дату и время переноса');
            return;
          }
          summary = await runMoveGroupLesson(lessonInfo, newStartAt);
        } else if (action === 'cancel') {
          summary = await runCancelGroupLesson(lessonInfo);
        } else {
          summary = await runCompleteGroupLesson(lessonInfo);
        }
      } else {
        // Legacy: per-lesson actions
        if (action === 'move') {
          const newStartAt = fromDateTimeLocalValue(moveDateTimeValue);
          if (!newStartAt) {
            toast.error('Выберите корректную дату и время переноса');
            return;
          }
          summary = await runMoveGroupAction({
            lessons: groupActionLessons,
            targetLessonIds,
            newStartAt,
          });
        } else if (action === 'cancel') {
          summary = await runCancelGroupAction({
            lessons: groupActionLessons,
            targetLessonIds,
          });
        } else {
          summary = await runCompleteGroupAction({
            lessons: groupActionLessons,
            targetLessonIds,
          });
        }
      }

      setActionSummary(summary);

      if (summary.successCount > 0) {
        onActionApplied?.();
      }

      if (summary.failedCount === 0) {
        const skippedSuffix = summary.skippedCount > 0
          ? `, пропущено ${summary.skippedCount}`
          : '';
        if (summary.action === 'move') {
          toast.success(`Перенесено ${summary.successCount}${skippedSuffix}`);
        } else if (summary.action === 'cancel') {
          toast.success(`Отменено ${summary.successCount}${skippedSuffix}`);
        } else {
          toast.success(`Отмечено проведенным ${summary.successCount}${skippedSuffix}`);
        }
      } else {
        toast.info(
          `Успешно ${summary.successCount}, ошибок ${summary.failedCount}, пропущено ${summary.skippedCount}`,
        );
      }
    } catch (error) {
      console.error(error);
      toast.error('Не удалось выполнить групповое действие');
    } finally {
      setIsActionSaving(false);
      setConfirmAction(null);
    }
  }, [bucket, getParticipantName, isActionSaving, moveDateTimeValue, groupActionLessons, onActionApplied, isUnifiedGroupLesson, mainLesson, participants]);

  const retryFailed = useCallback(async () => {
    if (!actionSummary || retryableFailedItems.length === 0) return;
    await runAction(
      actionSummary.action,
      retryableFailedItems.map((item) => item.lessonId),
    );
  }, [actionSummary, retryableFailedItems, runAction]);

  const groupIsRecurring = !!mainLesson?.is_recurring;

  // Перенос группы со scope (паритет с одиночным переносом + drag, request 3.1).
  // 'this' → существующий одиночный перенос; following/all → updateLessonSeries (shift всей серии).
  const doMoveGroup = useCallback(async (scope: DeleteLessonScope) => {
    setGroupMoveScopeOpen(false);
    if (scope === 'this') {
      await runAction('move');
      return;
    }
    if (!mainLesson) return;
    const newStartAt = fromDateTimeLocalValue(moveDateTimeValue);
    if (!newStartAt) {
      toast.error('Выберите корректную дату и время переноса');
      return;
    }
    const shiftMinutes = Math.round(
      (new Date(newStartAt).getTime() - new Date(mainLesson.start_at).getTime()) / 60000,
    );
    if (shiftMinutes === 0) return;
    setIsActionSaving(true);
    try {
      // 'all' клампим к now — не двигаем прошедшие занятия серии (висящий debit, review #5).
      const fromStartAtOverride = scope === 'all' ? new Date().toISOString() : undefined;
      const res = await updateLessonSeries(mainLesson, { applyTimeShift: true, shiftMinutes, scope, fromStartAtOverride });
      if (res.ok) {
        toast.success(
          scope === 'all'
            ? `Перенесена вся серия (${res.updatedCount})`
            : `Перенесено занятий: ${res.updatedCount}`,
        );
        onActionApplied?.();
        onOpenChange(false);
      } else {
        toast.error('Не удалось перенести серию');
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка при переносе серии');
    } finally {
      setIsActionSaving(false);
    }
  }, [mainLesson, moveDateTimeValue, runAction, onActionApplied, onOpenChange]);

  const doDeleteGroup = useCallback(async (scope: DeleteLessonScope) => {
    if (!mainLesson) return;
    setIsDeletingGroup(true);
    try {
      const res = await deleteLessonsScoped(mainLesson.id, scope);
      if (res.ok) {
        toast.success(
          scope === 'all'
            ? 'Серия групповых занятий удалена'
            : scope === 'this_and_following'
              ? 'Групповые занятия удалены'
              : 'Групповое занятие удалено',
        );
        onActionApplied?.();
        onOpenChange(false);
      } else {
        toast.error(res.error || 'Не удалось удалить занятие');
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка при удалении');
    } finally {
      setIsDeletingGroup(false);
      setShowGroupDelete(false);
    }
  }, [mainLesson, onActionApplied, onOpenChange]);

  const reloadParticipants = useCallback(async () => {
    if (!mainLesson) return;
    const data = await getLessonParticipants(mainLesson.id);
    setParticipants(data);
  }, [mainLesson]);

  const handleAddParticipant = useCallback(async () => {
    if (!mainLesson || !addParticipantId || isMutatingParticipants) return;
    const groupSourceId = bucket?.groupSourceTutorGroupId ?? null;
    // «Все будущие» доступно только для занятий с группой-источником (не legacy).
    const useFuture = addScope === 'future' && !!groupSourceId;
    setIsMutatingParticipants(true);
    try {
      if (useFuture && groupSourceId) {
        const res = await addStudentToGroupFutureLessons(groupSourceId, addParticipantId);
        if (res.ok) {
          toast.success(`Добавлен в ${res.addedCount ?? 0} будущих занятий группы`);
          setAddParticipantId('');
          await reloadParticipants();
          onActionApplied?.(); // parent: refetchLessons() + invalidateBalanceCaches() (rule 60)
        } else {
          toast.error(res.error || 'Не удалось добавить ученика');
        }
      } else {
        const res = await addLessonParticipant(mainLesson.id, addParticipantId);
        if (res.ok) {
          toast.success('Ученик добавлен в занятие');
          setAddParticipantId('');
          await reloadParticipants();
          onActionApplied?.();
        } else {
          toast.error(res.error || 'Не удалось добавить ученика');
        }
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка при добавлении ученика');
    } finally {
      setIsMutatingParticipants(false);
    }
  }, [mainLesson, addParticipantId, isMutatingParticipants, reloadParticipants, onActionApplied, addScope, bucket]);

  const handleRemoveParticipant = useCallback(async (tutorStudentId: string) => {
    if (!mainLesson || isMutatingParticipants) return;
    setIsMutatingParticipants(true);
    try {
      const res = await removeLessonParticipant(mainLesson.id, tutorStudentId);
      if (res.ok) {
        toast.success('Ученик убран из занятия');
        await reloadParticipants();
        onActionApplied?.();
      } else {
        toast.error(res.error || 'Не удалось убрать ученика');
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка при удалении ученика');
    } finally {
      setIsMutatingParticipants(false);
    }
  }, [mainLesson, isMutatingParticipants, reloadParticipants, onActionApplied]);

  // Students of this tutor not already in the group (for the add picker).
  const availableStudentsToAdd = useMemo(() => {
    const present = new Set(participants.map((p) => p.tutor_student_id));
    return students.filter((s) => !present.has(s.id));
  }, [students, participants]);

  const doSaveGroupEdit = useCallback(async (scope: DeleteLessonScope) => {
    if (!mainLesson) return;
    setIsGroupSaving(true);
    try {
      if (scope === 'this') {
        const result = await updateLesson(mainLesson.id, {
          subject: editGroupSubject || undefined,
          topic: editGroupTopic.trim() || null,
          notes: editGroupNotes || undefined,
        });
        if (result) {
          toast.success('Занятие обновлено');
          setShowGroupEdit(false);
          onActionApplied?.();
          onOpenChange(false);
        } else {
          toast.error('Не удалось обновить');
        }
      } else {
        const result = await updateLessonSeries(mainLesson, {
          subject: editGroupSubject || undefined,
          notes: editGroupNotes || undefined,
          scope,
        });
        // Тема — у КОНКРЕТНОГО занятия (в серию намеренно не копируется; RPC её не знает).
        // Зеркало individual-диалога (ревью 5.6 P1 #2: у группы темы было не исправить вовсе).
        if (result.ok && (editGroupTopic.trim() || '') !== (mainLesson.topic ?? '')) {
          await updateLesson(mainLesson.id, { topic: editGroupTopic.trim() || null });
        }
        if (result.ok) {
          toast.success(`Серия обновлена (${result.updatedCount})`);
          setShowGroupEdit(false);
          onActionApplied?.();
          onOpenChange(false);
        } else {
          toast.error(result.error || 'Не удалось обновить серию');
        }
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка при обновлении');
    } finally {
      setIsGroupSaving(false);
      setGroupSeriesAction(null);
    }
  }, [mainLesson, editGroupSubject, editGroupTopic, editGroupNotes, onActionApplied, onOpenChange]);

  const handleGroupEditSaveClick = useCallback(() => {
    if (groupIsRecurring) {
      setGroupSeriesAction('save');
    } else {
      doSaveGroupEdit('this');
    }
  }, [groupIsRecurring, doSaveGroupEdit]);

  const doCancelGroupSeries = useCallback(async (scope: 'this_and_following' | 'all') => {
    if (!mainLesson) return;
    setIsActionSaving(true);
    try {
      const ok = await cancelLessonSeries(mainLesson, scope);
      if (ok) {
        toast.success(scope === 'all' ? 'Серия занятий отменена' : 'Занятия отменены');
        onActionApplied?.();
        onOpenChange(false);
      } else {
        toast.error('Не удалось отменить');
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка при отмене');
    } finally {
      setIsActionSaving(false);
      setConfirmAction(null);
    }
  }, [mainLesson, onActionApplied, onOpenChange]);

  // Phase 2b: эффективная стоимость участника = override ∥ derived (rate × длительность группы).
  const getParticipantCost = useCallback((participant: TutorLessonParticipantWithStudent): number => {
    if (participant.payment_amount != null) return participant.payment_amount;
    return calculateLessonPaymentAmount(
      mainLesson?.duration_min ?? bucket?.durationMin ?? 0,
      participant.tutor_students?.hourly_rate_cents ?? null,
    );
  }, [mainLesson, bucket]);

  const openParticipantPaymentDialog = useCallback((participant: TutorLessonParticipantWithStudent) => {
    if (!participant.tutor_student_id) return;
    if (isParticipantPaymentSaving) return;
    setSelectedParticipantId(participant.id);
    setParticipantPaymentError(null);
    const cost = getParticipantCost(participant);
    setParticipantCostText(cost > 0 ? String(cost) : '0');
  }, [isParticipantPaymentSaving, getParticipantCost]);

  const closeParticipantPaymentDialog = useCallback((openParticipantDialog: boolean) => {
    if (openParticipantDialog) return;
    if (isParticipantPaymentSaving) return;
    setSelectedParticipantId(null);
    setParticipantPaymentError(null);
  }, [isParticipantPaymentSaving]);

  // Волна 2: применить стоимость участника с выбранным scope. 'this' — прежний
  // setParticipantCost; серия — series-RPC (остальные участники не тронуты, rule 60).
  const applyParticipantCost = useCallback(async (
    participantRowId: string,
    tutorStudentId: string,
    amount: number,
    scope: 'this' | CostSeriesScope,
  ) => {
    if (!mainLesson) return;
    setParticipantPaymentError(null);
    setIsParticipantPaymentSaving(true);
    try {
      const result = scope === 'this'
        ? await setParticipantCost(mainLesson.id, tutorStudentId, amount)
        : await setParticipantCostSeries(mainLesson.id, tutorStudentId, amount, scope);
      if (!result.ok) {
        setParticipantPaymentError(result.code ?? 'UPDATE_FAILED');
        toast.error(result.error || 'Не удалось изменить стоимость');
        return;
      }
      setParticipants((prev) => prev.map((participant) => (
        participant.id === participantRowId
          ? { ...participant, payment_amount: amount }
          : participant
      )));
      if (scope === 'this') {
        toast.success(amount > 0 ? `Стоимость: ${amount} ₽` : 'Списание отключено');
      } else {
        const updated = 'updated' in result ? result.updated ?? 0 : 0;
        toast.success(`Стоимость обновлена в ${updated} занятиях`);
      }
      setSelectedParticipantId(null);
      onParticipantPaymentUpdated?.();
    } catch (error) {
      console.error(error);
      setParticipantPaymentError('NETWORK_ERROR');
      toast.error('Ошибка сети при сохранении стоимости');
    } finally {
      setIsParticipantPaymentSaving(false);
      setParticipantCostScope(null);
    }
  }, [mainLesson, onParticipantPaymentUpdated]);

  // Phase 2b: сохранить стоимость занятия для участника (0 = не списывать). Прошедшее → сразу пересчёт.
  const handleSaveParticipantCost = useCallback(async () => {
    if (!mainLesson || !selectedParticipant) return;
    if (!selectedParticipant.tutor_student_id) {
      toast.error('Не удалось определить ученика');
      return;
    }
    if (isParticipantPaymentSaving) return;

    const parsed = Number.parseInt((participantCostText || '').replace(/[^\d]/g, ''), 10);
    const amount = Number.isFinite(parsed) ? parsed : 0;
    if (amount < 0) { toast.error('Стоимость должна быть 0 или больше'); return; }

    // Серийная группа → спросить «только это / это и далее / вся серия» (Волна 2,
    // запрос репетитора: «применить ко всем занятиям серии или только к одному»).
    if (groupIsRecurring) {
      setParticipantCostScope({
        participantRowId: selectedParticipant.id,
        tutorStudentId: selectedParticipant.tutor_student_id,
        amount,
      });
      return;
    }
    await applyParticipantCost(selectedParticipant.id, selectedParticipant.tutor_student_id, amount, 'this');
  }, [isParticipantPaymentSaving, mainLesson, participantCostText, selectedParticipant, groupIsRecurring, applyParticipantCost]);

  const renderPaymentIndicator = useCallback((lesson: TutorLessonWithStudent) => {
    if (lesson.status !== 'completed') {
      return <span className="text-xs text-muted-foreground">Оплата: после завершения</span>;
    }

    if (lesson.payment_status === 'paid') {
      return <span className="text-xs text-emerald-600">Оплата: оплачено</span>;
    }
    if (lesson.payment_status === 'pending') {
      return <span className="text-xs text-amber-600">Оплата: ожидается</span>;
    }
    return <span className="text-xs text-muted-foreground">Оплата: статус не указан</span>;
  }, []);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{bucket?.groupName || 'Мини-группа'}</DialogTitle>
          <DialogDescription>
            {startDate && endDate
              ? `${format(startDate, 'd MMMM, HH:mm', { locale: ru })} - ${format(endDate, 'HH:mm', { locale: ru })}`
              : 'Детали группового занятия'}
          </DialogDescription>
        </DialogHeader>

        {!bucket ? (
          <p className="text-sm text-muted-foreground">Нет данных для отображения.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {isUnifiedGroupLesson
                  ? `${participants.length || bucket.groupSizeSnapshot || '?'} участников`
                  : `${bucket.groupSizeSnapshot ?? bucket.lessons.length} участников`}
              </Badge>
              {isUnifiedGroupLesson ? (
                <Badge variant="outline">
                  {getLessonStatusLabel(lessonStatus)}
                </Badge>
              ) : (
                <Badge variant="outline">
                  {bucket.statusCounts.booked} запл. / {bucket.statusCounts.completed} провед. / {bucket.statusCounts.cancelled} отмен.
                </Badge>
              )}
              {bucket.isLegacyFallback && (
                <Badge variant="outline">Legacy grouping</Badge>
              )}
            </div>

            {/* Unified group lesson: show participants from junction table */}
            {isUnifiedGroupLesson ? (
              <div className="max-h-[45vh] overflow-y-auto space-y-2 pr-1">
                {participantsLoading ? (
                  <p className="text-sm text-muted-foreground">Загрузка участников...</p>
                ) : participants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Нет участников</p>
                ) : (
                  participants.map((participant) => {
                    const isActionable = Boolean(participant.tutor_student_id);
                    const participantCost = getParticipantCost(participant);
                    return (
                    <div
                      key={participant.id}
                      className={cn(
                        "rounded-md border p-2 space-y-1 transition-colors",
                        isActionable ? "cursor-pointer hover:bg-muted/40" : "cursor-default",
                        selectedParticipantId === participant.id && "ring-2 ring-primary/40",
                      )}
                      role={isActionable ? "button" : undefined}
                      tabIndex={isActionable ? 0 : undefined}
                      onClick={() => openParticipantPaymentDialog(participant)}
                      onKeyDown={(event) => {
                        if (!isActionable) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openParticipantPaymentDialog(participant);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium truncate">
                          {getParticipantName(participant)}
                        </p>
                        <Badge variant="outline">
                          {participantCost > 0 ? `${participantCost} ₽` : 'Не списывается'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {participant.tutor_students?.hourly_rate_cents != null ? (
                          <span className="text-xs text-muted-foreground">
                            Ставка: {participant.tutor_students.hourly_rate_cents / 100} ₽/ч
                          </span>
                        ) : (
                          <span className="text-xs text-amber-600">Ставка не указана</span>
                        )}
                      </div>
                      {isActionable && (
                        <p className="text-[11px] text-muted-foreground">
                          Нажмите, чтобы изменить стоимость для ученика
                        </p>
                      )}
                    </div>
                  )})
                )}
              </div>
            ) : (
              /* Legacy per-lesson display */
              <div className="max-h-[45vh] overflow-y-auto space-y-2 pr-1">
                {bucket.lessons.map((lesson) => (
                  <div key={lesson.id} className="rounded-md border p-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">{getLessonStudentName(lesson)}</p>
                      <Badge
                        variant={lesson.status === 'cancelled'
                          ? 'destructive'
                          : lesson.status === 'completed'
                            ? 'secondary'
                            : 'default'}
                      >
                        {getLessonStatusLabel(lesson.status)}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {lesson.tutor_students?.hourly_rate_cents != null ? (
                        <span className="text-xs text-muted-foreground">
                          Ставка: {lesson.tutor_students.hourly_rate_cents / 100} ₽/ч
                        </span>
                      ) : (
                        <span className="text-xs text-amber-600">Ставка не указана</span>
                      )}
                      {renderPaymentIndicator(lesson)}
                    </div>
                    {lesson.subject && (
                      <p className="text-xs text-muted-foreground truncate">{lesson.subject}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Действия для группы</p>
              <div className="space-y-2">
                <Label htmlFor="group-move-datetime" className="text-xs">Перенести группу на дату и время</Label>
                <DateTimeField
                  id="group-move-datetime"
                  value={moveDateTimeValue}
                  onChange={setMoveDateTimeValue}
                  disabled={isActionSaving}
                />
                <p className="text-xs text-muted-foreground">
                  {isUnifiedGroupLesson
                    ? `Статус занятия: ${getLessonStatusLabel(lessonStatus)}`
                    : `Будет попытка переноса только запланированных уроков: ${bookedCount}`}
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={isActionSaving || bookedCount === 0 || !moveDateTimeValue}
                  onClick={() => {
                    // Прошедшую группу не переносим (review #5: висящий debit на участниках).
                    if (mainLesson) {
                      const endMs = new Date(mainLesson.start_at).getTime() + (mainLesson.duration_min ?? 60) * 60000;
                      if (endMs < Date.now()) {
                        toast.error('Прошедшее занятие нельзя перенести');
                        return;
                      }
                    }
                    if (groupIsRecurring && isUnifiedGroupLesson) {
                      setGroupMoveScopeOpen(true);
                    } else {
                      void runAction('move');
                    }
                  }}
                >
                  {isActionSaving ? 'Перенос...' : 'Перенести группу'}
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button
                  variant="destructive"
                  disabled={isActionSaving || bookedCount === 0}
                  onClick={() => setConfirmAction('cancel')}
                >
                  Отменить группу
                </Button>
                <Button
                  variant="secondary"
                  disabled={isActionSaving || completeEligibleCount === 0}
                  onClick={() => setConfirmAction('complete')}
                >
                  Отметить проведено
                </Button>
              </div>
              {isUnifiedGroupLesson && mainLesson && lessonStatus === 'booked' && (
                <div className="space-y-2 rounded-md border border-socrat-border p-3">
                  <p className="text-sm font-medium text-slate-900">Состав группы</p>
                  <div className="space-y-1.5">
                    {participantsLoading ? (
                      <p className="text-xs text-muted-foreground">Загрузка…</p>
                    ) : participants.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Пока нет участников</p>
                    ) : (
                      participants.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2">
                          <span className="text-sm truncate">{getParticipantName(p)}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                            style={{ touchAction: 'manipulation' }}
                            disabled={isMutatingParticipants || participants.length <= 1}
                            onClick={() => p.tutor_student_id && handleRemoveParticipant(p.tutor_student_id)}
                            aria-label="Убрать ученика"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                  {availableStudentsToAdd.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {bucket?.groupSourceTutorGroupId && (
                        <Select value={addScope} onValueChange={(v) => setAddScope(v as 'this' | 'future')}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="this">Только это занятие</SelectItem>
                            <SelectItem value="future">Все будущие занятия группы</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      <div className="flex items-center gap-2">
                        <Select value={addParticipantId} onValueChange={setAddParticipantId}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Добавить ученика" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableStudentsToAdd.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.profiles?.username || s.profiles?.telegram_username || 'Ученик'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          style={{ touchAction: 'manipulation' }}
                          disabled={!addParticipantId || isMutatingParticipants}
                          onClick={handleAddParticipant}
                        >
                          Добавить
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isUnifiedGroupLesson && mainLesson && lessonStatus === 'booked' && (
                showGroupEdit ? (
                  <div className="space-y-3 rounded-md border border-socrat-border p-3">
                    <p className="text-sm font-medium text-slate-900">Изменить детали</p>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Предмет</Label>
                      <Input
                        value={editGroupSubject}
                        onChange={(e) => setEditGroupSubject(e.target.value)}
                        placeholder="Предмет"
                        className="text-base"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Тема занятия</Label>
                      <Input
                        value={editGroupTopic}
                        onChange={(e) => setEditGroupTopic(e.target.value)}
                        placeholder="Тема (видна на ячейке и ученикам)"
                        className="text-base"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Заметки</Label>
                      <Textarea
                        value={editGroupNotes}
                        onChange={(e) => setEditGroupNotes(e.target.value)}
                        placeholder="Заметки"
                        rows={2}
                        className="text-base"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setShowGroupEdit(false)} disabled={isGroupSaving}>
                        Отмена
                      </Button>
                      <Button className="flex-1" onClick={handleGroupEditSaveClick} disabled={isGroupSaving}>
                        {isGroupSaving ? 'Сохранение...' : 'Сохранить'}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Время — через «Перенести группу» выше. Длительность группы задаётся при создании.</p>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    style={{ touchAction: 'manipulation' }}
                    onClick={() => setShowGroupEdit(true)}
                  >
                    Изменить детали
                  </Button>
                )
              )}
              {isUnifiedGroupLesson && mainLesson && (
                <Button
                  variant="outline"
                  className="w-full"
                  style={{ touchAction: 'manipulation' }}
                  onClick={() => onOpenMaterials?.(mainLesson)}
                >
                  <FileText className="mr-1.5 h-4 w-4" />
                  Материалы
                </Button>
              )}
              {isUnifiedGroupLesson && mainLesson && (
                <Button
                  variant="outline"
                  className="w-full"
                  style={{ touchAction: 'manipulation' }}
                  onClick={() => navigate(`/tutor/board/lesson/${mainLesson.id}`)}
                >
                  <PenLine className="mr-1.5 h-4 w-4" />
                  Доска
                </Button>
              )}
              {isUnifiedGroupLesson && (
                <Button
                  variant="ghost"
                  className="w-full text-red-600 hover:text-red-700 hover:bg-red-50"
                  style={{ touchAction: 'manipulation' }}
                  disabled={isActionSaving || isDeletingGroup}
                  onClick={() => setShowGroupDelete(true)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {isDeletingGroup ? 'Удаление...' : 'Удалить занятие'}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                {isUnifiedGroupLesson
                  ? (completeEligibleCount > 0 ? 'Занятие завершилось по времени, можно отметить проведенным' : 'Занятие еще не завершилось по времени')
                  : `Для завершения доступны только уже завершившиеся по времени уроки: ${completeEligibleCount}`}
              </p>
            </div>

            {actionSummary && (
              <Alert variant={actionSummary.failedCount > 0 ? 'destructive' : 'default'}>
                <AlertDescription className="space-y-2">
                  <p>
                    Результат: успешно {actionSummary.successCount}, ошибок {actionSummary.failedCount}, пропущено {actionSummary.skippedCount}.
                  </p>
                  {retryableFailedItems.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs">
                        Ошибка: {retryableFailedItems.map((item) => item.reason || item.studentName).join(', ')}
                      </p>
                    </div>
                  )}
                  {actionSummary.skippedCount > 0 && (
                    <p className="text-xs">
                      Пропущено: {actionSummary.results.filter((result) => result.skipped).map((result) => result.reason || result.studentName).join(', ')}
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog
      open={Boolean(selectedParticipantId && selectedParticipant)}
      onOpenChange={closeParticipantPaymentDialog}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {selectedParticipant ? `Занятие с ${getParticipantName(selectedParticipant)}` : 'Оплата ученика'}
          </DialogTitle>
          <DialogDescription>
            {startDate && endDate
              ? `${format(startDate, 'EEEE, d MMMM', { locale: ru })} • ${format(startDate, 'HH:mm')} — ${format(endDate, 'HH:mm')} (${bucket?.durationMin ?? 0} мин)`
              : 'Индивидуальные действия оплаты в мини-группе'}
          </DialogDescription>
        </DialogHeader>

        {selectedParticipant ? (
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-1">
              <p className="text-sm font-medium">
                {selectedParticipant.tutor_students?.hourly_rate_cents != null
                  ? `${selectedParticipant.tutor_students.hourly_rate_cents / 100} ₽/ч`
                  : 'Ставка не указана'}
              </p>
              <p className="text-xs text-muted-foreground">Ставка ученика</p>
            </div>

            {participantPaymentError && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p>Не удалось изменить стоимость ({participantPaymentError}).</p>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label className="text-xs">Стоимость занятия для ученика, ₽</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={participantCostText}
                onChange={(e) => setParticipantCostText(e.target.value)}
                className="text-base"
                placeholder="0"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                0 — не списывать с баланса (например, ученик не был).
                {' '}Спишется после занятия; прошедшее — сразу.
              </p>
              <Button
                className="w-full"
                disabled={isParticipantPaymentSaving || !selectedParticipant.tutor_student_id}
                onClick={() => void handleSaveParticipantCost()}
                style={{ touchAction: 'manipulation' }}
              >
                {isParticipantPaymentSaving ? 'Сохранение...' : 'Сохранить стоимость'}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirmAction === 'cancel' ? 'Отменить занятие группы?' : 'Отметить занятие проведенным?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmAction === 'cancel'
              ? (isUnifiedGroupLesson
                  ? 'Групповое занятие будет отменено для всех участников.'
                  : `Будет попытка отмены запланированных уроков: ${bookedCount}. Завершенные и уже отмененные уроки будут пропущены.`)
              : (isUnifiedGroupLesson
                  ? 'Групповое занятие будет отмечено как проведенное. Стоимость спишется с баланса каждого участника по его цене (0 — не спишется).'
                  : `Будет попытка завершить уроки, которые уже завершились по времени: ${completeEligibleCount}. Остальные уроки будут пропущены.`)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel disabled={isActionSaving}>Назад</AlertDialogCancel>
          {confirmAction === 'cancel' && groupIsRecurring ? (
            <>
              <Button variant="destructive" disabled={isActionSaving} onClick={() => void runAction('cancel')}>
                Только это
              </Button>
              <Button variant="destructive" disabled={isActionSaving} onClick={() => void doCancelGroupSeries('this_and_following')}>
                Это и последующие
              </Button>
              <Button variant="destructive" disabled={isActionSaving} onClick={() => void doCancelGroupSeries('all')}>
                Всю серию
              </Button>
            </>
          ) : (
            <AlertDialogAction
              disabled={isActionSaving}
              onClick={(event) => {
                event.preventDefault();
                if (!confirmAction) return;
                void runAction(confirmAction);
              }}
            >
              {isActionSaving ? 'Выполняем...' : 'Подтвердить'}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Group delete — 3-way for a recurring series, simple for a single occurrence */}
    <AlertDialog open={showGroupDelete} onOpenChange={(open) => { if (!open) setShowGroupDelete(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить групповое занятие?</AlertDialogTitle>
          <AlertDialogDescription>
            {groupIsRecurring
              ? 'Это занятие — часть серии. Что удалить? Действие необратимо.'
              : 'Занятие будет удалено для всех участников без возможности восстановления.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={() => setShowGroupDelete(false)}>Назад</AlertDialogCancel>
          {groupIsRecurring ? (
            <>
              <Button variant="destructive" onClick={() => doDeleteGroup('this')} disabled={isDeletingGroup}>
                Только это
              </Button>
              <Button variant="destructive" onClick={() => doDeleteGroup('this_and_following')} disabled={isDeletingGroup}>
                Это и последующие
              </Button>
              <Button variant="destructive" onClick={() => doDeleteGroup('all')} disabled={isDeletingGroup}>
                Всю серию
              </Button>
            </>
          ) : (
            <Button variant="destructive" onClick={() => doDeleteGroup('this')} disabled={isDeletingGroup}>
              {isDeletingGroup ? 'Удаление...' : 'Удалить'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Group edit — series 3-way save */}
    <AlertDialog open={groupSeriesAction === 'save'} onOpenChange={(open) => { if (!open) setGroupSeriesAction(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Сохранить изменения</AlertDialogTitle>
          <AlertDialogDescription>
            Это занятие — часть серии. Применить только к этому занятию, к этому и последующим, или ко всей серии?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={() => setGroupSeriesAction(null)}>Назад</AlertDialogCancel>
          <Button onClick={() => doSaveGroupEdit('this')} disabled={isGroupSaving}>Только это</Button>
          <Button onClick={() => doSaveGroupEdit('this_and_following')} disabled={isGroupSaving}>Это и последующие</Button>
          <Button onClick={() => doSaveGroupEdit('all')} disabled={isGroupSaving}>Вся серия</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Волна 2: цена участника серийной группы — «только это / это и далее / вся серия».
        «Вся серия» пересчитывает и ПРОШЕДШИЕ занятия участника (списания изменятся). */}
    <AlertDialog open={participantCostScope !== null} onOpenChange={(open) => { if (!open) setParticipantCostScope(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Применить стоимость к серии?</AlertDialogTitle>
          <AlertDialogDescription>
            Занятие входит в серию. {participantCostScope != null && participantCostScope.amount > 0
              ? `Новая стоимость участника: ${participantCostScope.amount} ₽.`
              : 'Стоимость 0 — занятия участника не будут списываться.'}{' '}
            Остальные участники не затронуты. «Вся серия» пересчитает и уже прошедшие занятия.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel disabled={isParticipantPaymentSaving}>Назад</AlertDialogCancel>
          <Button
            disabled={isParticipantPaymentSaving}
            onClick={() => participantCostScope && void applyParticipantCost(
              participantCostScope.participantRowId, participantCostScope.tutorStudentId, participantCostScope.amount, 'this')}
          >
            Только это
          </Button>
          <Button
            disabled={isParticipantPaymentSaving}
            onClick={() => participantCostScope && void applyParticipantCost(
              participantCostScope.participantRowId, participantCostScope.tutorStudentId, participantCostScope.amount, 'this_and_following')}
          >
            Это и последующие
          </Button>
          <Button
            disabled={isParticipantPaymentSaving}
            onClick={() => participantCostScope && void applyParticipantCost(
              participantCostScope.participantRowId, participantCostScope.tutorStudentId, participantCostScope.amount, 'all')}
          >
            Всю серию
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Group move — series 3-way (паритет с одиночным переносом и drag) */}
    <AlertDialog open={groupMoveScopeOpen} onOpenChange={(open) => { if (!open) setGroupMoveScopeOpen(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Перенести группу</AlertDialogTitle>
          <AlertDialogDescription>
            Это групповое занятие входит в серию. Перенести только это, это и последующие, или всю серию?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={() => setGroupMoveScopeOpen(false)} disabled={isActionSaving}>Назад</AlertDialogCancel>
          <Button variant="outline" onClick={() => doMoveGroup('this')} disabled={isActionSaving}>Только это</Button>
          <Button variant="outline" onClick={() => doMoveGroup('this_and_following')} disabled={isActionSaving}>Это и последующие</Button>
          <Button onClick={() => doMoveGroup('all')} disabled={isActionSaving}>Вся серия</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
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
// AddEventDialog — создание личного дела
// =============================================

interface AddEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate: Date | null;
  initialHour: number | null;
  initialMinute?: number;
  onSuccess: () => void;
}

function AddEventDialog({ open, onOpenChange, initialDate, initialHour, initialMinute = 0, onSuccess }: AddEventDialogProps) {
  const [date, setDate] = useState<Date | undefined>(initialDate || new Date());
  const [hour, setHour] = useState(initialHour?.toString() || new Date().getHours().toString());
  const [minute, setMinute] = useState(initialMinute.toString().padStart(2, '0'));
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('60');
  const [isRecurring, setIsRecurring] = useState(false);
  const [repeatUntil, setRepeatUntil] = useState<Date | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(initialDate || new Date());
      setHour(initialHour?.toString() || new Date().getHours().toString());
      setMinute(initialMinute.toString().padStart(2, '0'));
      setTitle('');
      setNotes('');
      setDuration('60');
      setIsRecurring(false);
      setRepeatUntil(undefined);
    }
  }, [open, initialDate, initialHour, initialMinute]);

  const handleSubmit = async () => {
    if (!date) { toast.error('Выберите дату'); return; }
    if (!title.trim()) { toast.error('Введите название'); return; }
    if (isRecurring && !repeatUntil) { toast.error('Выберите дату окончания повторений'); return; }

    const startAt = new Date(date);
    startAt.setHours(parseInt(hour), parseInt(minute), 0, 0);
    const input = {
      start_at: startAt.toISOString(),
      duration_min: parseInt(duration),
      title: title.trim(),
      notes: notes.trim() ? notes.trim() : null,
    };

    setIsSaving(true);
    try {
      if (isRecurring && repeatUntil) {
        const { root, count } = await createCalendarEventSeries(input, repeatUntil.toISOString());
        if (root) {
          toast.success(`Создано ${count} дел (еженедельно)`);
          onSuccess();
          onOpenChange(false);
        } else {
          toast.error('Не удалось создать серию');
        }
      } else {
        const res = await createCalendarEvent(input);
        if (res) {
          toast.success('Личное дело добавлено');
          onSuccess();
          onOpenChange(false);
        } else {
          toast.error('Не удалось создать');
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
          <DialogTitle>Личное дело</DialogTitle>
          <DialogDescription>
            Это время будет занято: новые занятия на него не поставятся, а ученик не сможет записаться.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Название *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Спорт, врач, дела..."
              className="text-base"
            />
          </div>

          <div className="space-y-2">
            <Label>Дата и время *</Label>
            <div className="flex flex-wrap gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal", !date && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'dd.MM.yyyy') : 'Выберите дату'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={setDate} locale={ru} className="pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <div className="flex items-center gap-1">
                <Select value={hour} onValueChange={setHour}>
                  <SelectTrigger className="w-[70px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={i.toString()}>{i.toString().padStart(2, '0')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select value={minute} onValueChange={setMinute}>
                  <SelectTrigger className="w-[70px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['00', '15', '30', '45'].map(m => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Длительность</Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 мин</SelectItem>
                <SelectItem value="45">45 мин</SelectItem>
                <SelectItem value="60">60 мин</SelectItem>
                <SelectItem value="90">90 мин</SelectItem>
                <SelectItem value="120">120 мин</SelectItem>
                <SelectItem value="180">3 часа</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Повторять еженедельно</Label>
                <p className="text-xs text-muted-foreground">Создать серию дел каждую неделю</p>
              </div>
              <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
            </div>
            {isRecurring && (
              <div className="space-y-2">
                <Label>Повторять до *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !repeatUntil && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {repeatUntil ? format(repeatUntil, 'dd.MM.yyyy') : 'Выберите дату окончания'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={repeatUntil} onSelect={setRepeatUntil} locale={ru} disabled={(d) => d < (date || new Date())} className="pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Комментарий (опц.)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Заметка для себя..." rows={2} className="text-base" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !title.trim()}>
            {isSaving ? 'Сохранение...' : (isRecurring ? 'Создать серию' : 'Создать')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================
// EventDetailsDialog — правка / удаление личного дела (со scope для серий)
// =============================================

interface EventDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: TutorCalendarEvent | null;
  onUpdated: () => void;
}

function EventDetailsDialog({ open, onOpenChange, event, onUpdated }: EventDetailsDialogProps) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [hour, setHour] = useState('0');
  const [minute, setMinute] = useState('00');
  const [duration, setDuration] = useState('60');
  const [isSaving, setIsSaving] = useState(false);
  const [seriesAction, setSeriesAction] = useState<'save' | 'delete' | null>(null);

  const isSeries = !!event && (event.is_recurring || event.parent_event_id != null);

  useEffect(() => {
    if (event) {
      const d = new Date(event.start_at);
      setTitle(event.title);
      setNotes(event.notes ?? '');
      setDate(d);
      setHour(d.getHours().toString());
      setMinute(d.getMinutes().toString().padStart(2, '0'));
      setDuration(String(event.duration_min));
      setSeriesAction(null);
    }
  }, [event]);

  if (!event) return null;

  const buildStartIso = () => {
    const d = new Date(date || new Date(event.start_at));
    d.setHours(parseInt(hour), parseInt(minute), 0, 0);
    return d.toISOString();
  };

  const doSave = async (scope: 'single' | 'this_and_following' | 'all') => {
    setIsSaving(true);
    try {
      const newStartIso = buildStartIso();
      const durationMin = parseInt(duration);
      if (scope === 'single' || !isSeries) {
        const res = await updateCalendarEvent(event.id, {
          title: title.trim() || event.title,
          notes: notes.trim() ? notes.trim() : null,
          start_at: newStartIso,
          duration_min: durationMin,
        });
        if (res) { toast.success('Сохранено'); onUpdated(); onOpenChange(false); }
        else toast.error('Не удалось сохранить');
      } else {
        const shiftMinutes = Math.round((new Date(newStartIso).getTime() - new Date(event.start_at).getTime()) / 60000);
        const res = await updateCalendarEventSeries(event, {
          title: title.trim() || undefined,
          notes: notes.trim() ? notes.trim() : '',
          duration_min: durationMin,
          applyTimeShift: shiftMinutes !== 0,
          shiftMinutes,
          scope,
        });
        if (res.ok) {
          toast.success(scope === 'all' ? `Обновлена вся серия (${res.updatedCount})` : `Обновлено: ${res.updatedCount}`);
          onUpdated();
          onOpenChange(false);
        } else {
          toast.error('Не удалось сохранить серию');
        }
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка при сохранении');
    } finally {
      setIsSaving(false);
      setSeriesAction(null);
    }
  };

  const doDelete = async (scope: DeleteCalendarEventScope) => {
    setIsSaving(true);
    try {
      const res = await deleteCalendarEventsScoped(event.id, scope);
      if (res.ok) { toast.success('Удалено'); onUpdated(); onOpenChange(false); }
      else toast.error('Не удалось удалить');
    } catch (e) {
      console.error(e);
      toast.error('Ошибка при удалении');
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
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4" /> Личное дело
            {isSeries && <Badge variant="outline"><Repeat className="h-3 w-3 mr-1" />Серия</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Название</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="text-base" />
          </div>

          <div className="space-y-2">
            <Label>Дата и время</Label>
            <div className="flex flex-wrap gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal", !date && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'dd.MM.yyyy') : 'Выберите дату'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={setDate} locale={ru} className="pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <div className="flex items-center gap-1">
                <Select value={hour} onValueChange={setHour}>
                  <SelectTrigger className="w-[70px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={i.toString()}>{i.toString().padStart(2, '0')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select value={minute} onValueChange={setMinute}>
                  <SelectTrigger className="w-[70px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['00', '15', '30', '45'].map(m => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Длительность</Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 мин</SelectItem>
                <SelectItem value="45">45 мин</SelectItem>
                <SelectItem value="60">60 мин</SelectItem>
                <SelectItem value="90">90 мин</SelectItem>
                <SelectItem value="120">120 мин</SelectItem>
                <SelectItem value="180">3 часа</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Комментарий</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-base" />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="destructive"
            disabled={isSaving}
            onClick={() => { if (isSeries) setSeriesAction('delete'); else doDelete('this'); }}
          >
            <Trash2 className="h-4 w-4 mr-2" />Удалить
          </Button>
          <Button
            disabled={isSaving}
            onClick={() => { if (isSeries) setSeriesAction('save'); else doSave('single'); }}
          >
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={seriesAction === 'save'} onOpenChange={(o) => { if (!o) setSeriesAction(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Сохранить изменения</AlertDialogTitle>
          <AlertDialogDescription>
            Это дело — часть серии. Применить только к этому, к этому и последующим, или ко всей серии?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={() => setSeriesAction(null)}>Назад</AlertDialogCancel>
          <Button variant="outline" onClick={() => doSave('single')} disabled={isSaving}>Только это</Button>
          <Button variant="outline" onClick={() => doSave('this_and_following')} disabled={isSaving}>Это и последующие</Button>
          <Button onClick={() => doSave('all')} disabled={isSaving}>Вся серия</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={seriesAction === 'delete'} onOpenChange={(o) => { if (!o) setSeriesAction(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить дело</AlertDialogTitle>
          <AlertDialogDescription>
            Это дело — часть серии. Удалить только это, это и последующие, или всю серию?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={() => setSeriesAction(null)}>Назад</AlertDialogCancel>
          <Button variant="outline" onClick={() => doDelete('this')} disabled={isSaving}>Только это</Button>
          <Button variant="outline" onClick={() => doDelete('this_and_following')} disabled={isSaving}>Это и последующие</Button>
          <Button variant="destructive" onClick={() => doDelete('all')} disabled={isSaving}>Всю серию</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
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
  isCompleting?: boolean;
  onOpenMaterials?: () => void;
  /** Open the guided post-lesson Sheet (past booked individual lessons). */
  onOpenPostLesson?: () => void;
}

function LessonDetailsDialog({
  open,
  onOpenChange,
  lesson,
  students,
  onCancel,
  onUpdate,
  isCompleting = false,
  onOpenMaterials,
  onOpenPostLesson,
}: LessonDetailsDialogProps) {
  // Доска открывается по маршруту-резолверу /board/lesson/:id — она сама
  // найдёт-или-создаст доску занятия. Так в этом high-risk файле остаётся
  // чистая навигация, без async-логики и обработки ошибок.
  const navigate = useNavigate();
  const [isCancelling, setIsCancelling] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editStudentId, setEditStudentId] = useState<string>('');
  const [editLessonType, setEditLessonType] = useState<LessonType>('regular');
  const [editSubject, setEditSubject] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState<Date | undefined>();
  const [editHour, setEditHour] = useState('');
  const [editMinute, setEditMinute] = useState('00');
  const [editDuration, setEditDuration] = useState('60');
  // Series confirmation state
  const [seriesAction, setSeriesAction] = useState<'save' | 'cancel' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Phase 2b cost-driven billing: editable cost + cancel-with-charge
  const [isEditingCost, setIsEditingCost] = useState(false);
  const [costText, setCostText] = useState('');
  const [isSavingCost, setIsSavingCost] = useState(false);
  // Волна 2: серийное занятие → введённая цена ждёт выбора scope (это / далее / вся серия).
  const [costScopeAmount, setCostScopeAmount] = useState<number | null>(null);
  const [showCancelCharge, setShowCancelCharge] = useState(false);
  const [cancelChargeText, setCancelChargeText] = useState('');

  // Reset edit state when dialog opens with a new lesson
  useEffect(() => {
    if (open && lesson) {
      const lessonStart = new Date(lesson.start_at);
      setIsEditing(false);
      setEditStudentId(lesson.student_id || '__none__');
      setEditLessonType((lesson.lesson_type as LessonType) || 'regular');
      setEditSubject(lesson.subject || '');
      setEditTopic(lesson.topic || '');
      setEditNotes(lesson.notes || '');
      setEditDate(lessonStart);
      setEditHour(lessonStart.getHours().toString());
      setEditMinute(lessonStart.getMinutes().toString().padStart(2, '0'));
      setEditDuration((lesson.duration_min ?? 60).toString());
      setSeriesAction(null);
      setIsEditingCost(false);
      setShowCancelCharge(false);
    }
  }, [open, lesson]);

  // Проверка «это правда серия» — кэшируемый useQuery вместо запроса на КАЖДОЕ
  // открытие карточки (Волна 1, перф). refetchOnWindowFocus:false — write-форма
  // (smoke §8). Инвалидация ключа — после удаления части серии (doDelete).
  const seriesQueryClient = useQueryClient();
  const seriesCheckEnabled = open && !!lesson?.is_recurring;
  const seriesRootId = lesson ? (lesson.parent_lesson_id || lesson.id) : null;
  const { data: seriesCount, isLoading: isSeriesCheckLoading } = useQuery({
    queryKey: ['tutor', 'lesson-series-count', seriesRootId],
    enabled: seriesCheckEnabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: () => getLessonSeriesCount(lesson!),
  });
  const isActualSeries = seriesCheckEnabled && (seriesCount ?? 0) > 1;

  useEffect(() => {
    if (!isActualSeries && seriesAction !== null) {
      setSeriesAction(null);
    }
  }, [isActualSeries, seriesAction]);

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

  const isPast = endDate.getTime() < Date.now();

  // Phase 2b: эффективная стоимость = override (payment_amount) ∥ derived (rate×duration). 0 = не списывать.
  const hourlyRateCents = lesson.tutor_students?.hourly_rate_cents ?? null;
  const effectiveCost = lesson.payment_amount ?? calculateLessonPaymentAmount(lesson.duration_min, hourlyRateCents);

  // Волна 2: применить цену с выбранным scope. 'this' — прежний setLessonCost;
  // серия — series-RPC (пересчёт списаний прошедших под advisory-lock, rule 60).
  const applyCost = async (amount: number, scope: 'this' | CostSeriesScope) => {
    setIsSavingCost(true);
    try {
      if (scope === 'this') {
        const res = await setLessonCost(lesson.id, amount);
        if (res.ok) {
          toast.success(amount > 0 ? `Стоимость: ${amount} ₽` : 'Списание отключено');
          setIsEditingCost(false);
          onUpdate();
        } else {
          toast.error(res.error || 'Не удалось сохранить стоимость');
        }
      } else {
        const res = await setLessonCostSeries(lesson.id, amount, scope);
        if (res.ok) {
          toast.success(`Стоимость обновлена в ${res.updated ?? 0} занятиях`);
          setIsEditingCost(false);
          onUpdate();
        } else {
          toast.error(res.error || 'Не удалось сохранить стоимость');
        }
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка при сохранении стоимости');
    } finally {
      setIsSavingCost(false);
      setCostScopeAmount(null);
    }
  };

  const handleSaveCost = async () => {
    const parsed = Number.parseInt((costText || '').replace(/[^\d]/g, ''), 10);
    const amount = Number.isFinite(parsed) ? parsed : 0;
    if (amount < 0) { toast.error('Стоимость должна быть 0 или больше'); return; }
    // Серийное занятие → спросить «только это / это и далее / вся серия» (Волна 2).
    if (isActualSeries) {
      setCostScopeAmount(amount);
      return;
    }
    await applyCost(amount, 'this');
  };

  const handleConfirmCancelCharge = async () => {
    const parsed = Number.parseInt((cancelChargeText || '').replace(/[^\d]/g, ''), 10);
    const amount = Number.isFinite(parsed) ? parsed : 0;
    if (amount < 0) { toast.error('Сумма должна быть 0 или больше'); return; }
    setIsCancelling(true);
    try {
      const res = await cancelLessonWithCharge(lesson.id, amount);
      if (res.ok) {
        toast.success(amount > 0 ? `Занятие отменено · списано ${amount} ₽` : 'Занятие отменено');
        setShowCancelCharge(false);
        onCancel();
        onOpenChange(false);
      } else {
        toast.error(res.error || 'Не удалось отменить');
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка при отмене');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleCancelClick = () => {
    if (isSeriesCheckLoading) {
      toast.info('Проверяем серию занятий...');
      return;
    }
    if (isActualSeries) {
      setSeriesAction('cancel');
    } else {
      // Одиночное занятие — отмена с суммой списания (rule 2b: репетитор вводит сумму).
      setCancelChargeText(effectiveCost != null && effectiveCost > 0 ? String(effectiveCost) : '0');
      setShowCancelCharge(true);
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
    if (isSeriesCheckLoading) {
      toast.info('Проверяем серию занятий...');
      return;
    }
    if (isActualSeries) {
      setSeriesAction('save');
    } else {
      doSave('this');
    }
  };

  const handleDeleteClick = () => {
    if (isSeriesCheckLoading) {
      toast.info('Проверяем серию занятий...');
      return;
    }
    setShowDeleteConfirm(true);
  };

  const doCancel = async (scope: DeleteLessonScope) => {
    setIsCancelling(true);
    try {
      let result: boolean;
      if (scope === 'this') {
        result = !!(await cancelLesson(lesson.id));
      } else {
        result = await cancelLessonSeries(lesson, scope);
      }
      if (result) {
        toast.success(
          scope === 'this'
            ? 'Занятие отменено'
            : scope === 'all'
              ? 'Серия занятий отменена'
              : 'Занятия отменены',
        );
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

  const doSave = async (scope: DeleteLessonScope) => {
    setIsSaving(true);
    try {
      const newStart = new Date(editDate!);
      newStart.setHours(Number.parseInt(editHour, 10), Number.parseInt(editMinute, 10), 0, 0);

      const actualStudentId = editStudentId === '__none__' ? '' : editStudentId;
      const tutorStudent = actualStudentId
        ? students.find(s => s.student_id === actualStudentId)
        : null;

      if (scope !== 'this') {
        const oldStart = new Date(lesson.start_at);
        const shiftMinutes = Math.round((newStart.getTime() - oldStart.getTime()) / 60000);
        const applyTimeShift = shiftMinutes !== 0;

        // Волна 2: series-shift не money-aware (update_lesson_series), сдвиг В ПРОШЛОЕ
        // заблокирован и DB-триггером — не даём упереться в него молча.
        if (applyTimeShift && newStart.getTime() <= Date.now()) {
          toast.error('Перенос серии в прошлое недоступен — прошедшие занятия переносятся по одному');
          return;
        }

        const result = await updateLessonSeries(lesson, {
          student_id: actualStudentId || undefined,
          tutor_student_id: tutorStudent?.id || undefined,
          lesson_type: editLessonType,
          subject: editSubject || undefined,
          notes: editNotes || undefined,
          duration_min: Number.parseInt(editDuration, 10),
          applyTimeShift,
          shiftMinutes,
          scope,
        });
        // Тема — у КОНКРЕТНОГО занятия (в серию намеренно не копируется; RPC её не знает).
        if (result.ok && (editTopic.trim() || '') !== (lesson.topic ?? '')) {
          await updateLesson(lesson.id, { topic: editTopic.trim() || null });
        }
        if (result.ok) {
          toast.success(`Серия обновлена (${result.updatedCount})`);
          setIsEditing(false);
          onUpdate();
          onOpenChange(false);
        } else {
          if (result.updatedCount === 0) {
            toast.error('Серия не обновлена: нет подходящих занятий');
          } else {
            toast.error(result.error || 'Не удалось обновить серию');
          }
        }
      } else {
        // Волна 2: смена ВРЕМЕНИ — money-операция, только через tutor_move_lesson
        // (rule 60 §13; прямой UPDATE start_at опасных случаев блокирует DB-триггер).
        const startChanged = new Date(lesson.start_at).getTime() !== newStart.getTime();
        if (startChanged) {
          const moved = await moveLesson(lesson.id, newStart.toISOString());
          if (!moved.ok) {
            toast.error(moved.error || 'Не удалось перенести занятие');
            return;
          }
        }
        const result = await updateLesson(lesson.id, {
          duration_min: Number.parseInt(editDuration, 10),
          student_id: actualStudentId || undefined,
          tutor_student_id: tutorStudent?.id || undefined,
          lesson_type: editLessonType,
          subject: editSubject || undefined,
          topic: editTopic.trim() || null,
          notes: editNotes || undefined,
        });
        if (result) {
          toast.success('Занятие обновлено');
          setIsEditing(false);
          onUpdate();
          onOpenChange(false);
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

  const doDelete = async (scope: DeleteLessonScope) => {
    setIsDeleting(true);
    try {
      const res = await deleteLessonsScoped(lesson.id, scope);
      if (res.ok) {
        toast.success(
          scope === 'all'
            ? 'Серия занятий удалена'
            : scope === 'this_and_following'
              ? 'Занятия удалены'
              : 'Занятие удалено',
        );
        // Состав серии изменился — кэш «это правда серия» больше не валиден.
        void seriesQueryClient.invalidateQueries({ queryKey: ['tutor', 'lesson-series-count'] });
        onCancel();
        onOpenChange(false);
      } else {
        toast.error(res.error || 'Не удалось удалить занятие');
      }
    } catch (err) {
      console.error(err);
      toast.error('Ошибка при удалении');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
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
          
          {lesson.tutor_students?.hourly_rate_cents != null && (
            <div className="flex items-center gap-3">
              <span className="h-5 w-5 flex items-center justify-center text-muted-foreground">💰</span>
              <div>
                <p className="font-medium">{lesson.tutor_students.hourly_rate_cents / 100} ₽/ч</p>
                <p className="text-sm text-muted-foreground">Ставка ученика</p>
              </div>
            </div>
          )}

          {/* Phase 2b: стоимость занятия — единственный денежный контрол (cost-driven списание) */}
          {!isEditing && lesson.status !== 'cancelled' && (
            <div className="flex items-start gap-3">
              <Wallet className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 min-w-0">
                {!isEditingCost ? (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">
                        {effectiveCost != null && effectiveCost > 0 ? `${effectiveCost} ₽` : 'Не списывается'}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        style={{ touchAction: 'manipulation' }}
                        onClick={() => {
                          setCostText(effectiveCost != null ? String(effectiveCost) : '0');
                          setIsEditingCost(true);
                        }}
                      >
                        Изменить
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {isPast ? 'Списано с баланса ученика' : 'Спишется после занятия'}
                    </p>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-xs">Стоимость занятия, ₽</Label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={costText}
                        onChange={(e) => setCostText(e.target.value)}
                        className="text-base w-28"
                        placeholder="0"
                        autoFocus
                      />
                      <Button size="sm" onClick={handleSaveCost} disabled={isSavingCost}>
                        {isSavingCost ? '...' : 'Сохранить'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setIsEditingCost(false)} disabled={isSavingCost}>
                        Отмена
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">0 — не списывать с баланса ученика</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {!isEditing ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant={lesson.source === 'self_booking' ? 'secondary' : 'outline'}>
                  {lesson.source === 'self_booking' ? 'Самозапись' : 'Вручную'}
                </Badge>
                <Badge variant={lesson.status === 'booked' ? 'default' : lesson.status === 'completed' ? 'secondary' : 'destructive'}>
                  {lesson.status === 'booked' ? 'Запланировано' : lesson.status === 'completed' ? 'Проведено' : 'Отменено'}
                </Badge>
                <Badge variant="outline">{typeLabel}</Badge>
                {lesson.subject && <Badge variant="outline">{lesson.subject}</Badge>}
                {isActualSeries && <Badge variant="outline"><Repeat className="h-3 w-3 mr-1" />Серия</Badge>}
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
                <Label className="text-xs">Длительность</Label>
                <Select value={editDuration} onValueChange={setEditDuration}>
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
                <Label className="text-xs">Тема занятия</Label>
                <Input
                  value={editTopic}
                  onChange={e => setEditTopic(e.target.value)}
                  placeholder="Тема (видна на ячейке и ученику)"
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
              <Button onClick={handleSaveClick} disabled={isSaving || isSeriesCheckLoading}>
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                style={{ touchAction: 'manipulation' }}
                onClick={() => onOpenMaterials?.()}
              >
                <FileText className="mr-1.5 h-4 w-4" />
                Материалы
              </Button>
              <Button
                variant="outline"
                style={{ touchAction: 'manipulation' }}
                onClick={() => navigate(`/tutor/board/lesson/${lesson.id}`)}
              >
                <PenLine className="mr-1.5 h-4 w-4" />
                Доска
              </Button>
              <Button
                variant="ghost"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                style={{ touchAction: 'manipulation' }}
                onClick={handleDeleteClick}
                disabled={isDeleting || isSeriesCheckLoading}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                {isDeleting ? 'Удаление...' : 'Удалить'}
              </Button>
              {lesson.status === 'booked' && (
              isPast ? (
                /* Phase 2b: занятие уже авто-списано (cost-driven) — кнопка ведёт к материалам,
                   а не «провести+оплата». Стоимость/отмена — в карточке (Редактировать). */
                <Button
                  className="w-full"
                  style={{ touchAction: 'manipulation' }}
                  onClick={() => onOpenPostLesson?.()}
                  disabled={isCompleting || isCancelling}
                >
                  <ClipboardCheck className="mr-1.5 h-4 w-4" />
                  Материалы занятия
                </Button>
              ) : (
                /* Future booked lesson — edit / cancel */
                <>
                  <Button variant="outline" onClick={() => setIsEditing(true)}>
                    Редактировать
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleCancelClick}
                    disabled={isCancelling || isSeriesCheckLoading}
                  >
                    {isCancelling ? 'Отмена...' : 'Отменить занятие'}
                  </Button>
                </>
              )
            )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Series confirmation AlertDialog */}
    <AlertDialog open={seriesAction !== null && isActualSeries} onOpenChange={(open) => { if (!open) setSeriesAction(null); }}>
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
            onClick={() => seriesAction === 'cancel' ? doCancel('this') : doSave('this')}
            disabled={isCancelling || isSaving}
          >
            Только это
          </Button>
          <Button
            variant={seriesAction === 'cancel' ? 'destructive' : 'default'}
            onClick={() => seriesAction === 'cancel' ? doCancel('this_and_following') : doSave('this_and_following')}
            disabled={isCancelling || isSaving}
          >
            Это и последующие
          </Button>
          <Button
            variant={seriesAction === 'cancel' ? 'destructive' : 'default'}
            onClick={() => seriesAction === 'cancel' ? doCancel('all') : doSave('all')}
            disabled={isCancelling || isSaving}
          >
            Вся серия
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Phase 2b: отмена одиночного занятия с суммой списания */}
    <AlertDialog open={showCancelCharge} onOpenChange={(open) => { if (!open) setShowCancelCharge(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Отменить занятие</AlertDialogTitle>
          <AlertDialogDescription>
            Сколько списать с баланса ученика за отменённое занятие? Введите 0, если списывать не нужно.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5 py-2">
          <Label className="text-xs">Списать с баланса, ₽</Label>
          <Input
            type="text"
            inputMode="numeric"
            value={cancelChargeText}
            onChange={(e) => setCancelChargeText(e.target.value)}
            className="text-base w-32"
            placeholder="0"
          />
        </div>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={() => setShowCancelCharge(false)} disabled={isCancelling}>Назад</AlertDialogCancel>
          <Button variant="destructive" onClick={handleConfirmCancelCharge} disabled={isCancelling}>
            {isCancelling ? 'Отмена...' : 'Отменить занятие'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Волна 2: цена серийного занятия — «только это / это и далее / вся серия».
        «Вся серия» пересчитывает и ПРОШЕДШИЕ занятия (списания изменятся, видно в ленте). */}
    <AlertDialog open={costScopeAmount !== null} onOpenChange={(open) => { if (!open) setCostScopeAmount(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Применить стоимость к серии?</AlertDialogTitle>
          <AlertDialogDescription>
            Это занятие — часть серии. {costScopeAmount != null && costScopeAmount > 0
              ? `Новая стоимость: ${costScopeAmount} ₽.`
              : 'Стоимость 0 — занятия не будут списываться.'}{' '}
            «Вся серия» пересчитает и уже прошедшие занятия — их списания изменятся.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel disabled={isSavingCost}>Назад</AlertDialogCancel>
          <Button onClick={() => costScopeAmount != null && void applyCost(costScopeAmount, 'this')} disabled={isSavingCost}>
            Только это
          </Button>
          <Button onClick={() => costScopeAmount != null && void applyCost(costScopeAmount, 'this_and_following')} disabled={isSavingCost}>
            Это и последующие
          </Button>
          <Button onClick={() => costScopeAmount != null && void applyCost(costScopeAmount, 'all')} disabled={isSavingCost}>
            Всю серию
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Delete confirmation — 3-way for a series, simple for a single lesson */}
    <AlertDialog open={showDeleteConfirm} onOpenChange={(open) => { if (!open) setShowDeleteConfirm(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить занятие?</AlertDialogTitle>
          <AlertDialogDescription>
            {isActualSeries
              ? 'Это занятие — часть серии. Что удалить? Действие необратимо.'
              : 'Занятие будет удалено без возможности восстановления.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)}>Назад</AlertDialogCancel>
          {isActualSeries ? (
            <>
              <Button variant="destructive" onClick={() => doDelete('this')} disabled={isDeleting}>
                Только это
              </Button>
              <Button variant="destructive" onClick={() => doDelete('this_and_following')} disabled={isDeleting}>
                Это и последующие
              </Button>
              <Button variant="destructive" onClick={() => doDelete('all')} disabled={isDeleting}>
                Всю серию
              </Button>
            </>
          ) : (
            <Button variant="destructive" onClick={() => doDelete('this')} disabled={isDeleting}>
              {isDeleting ? 'Удаление...' : 'Удалить'}
            </Button>
          )}
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
  const [paymentDetailsText, setPaymentDetailsText] = useState(settings?.payment_details_text || '');
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
      setPaymentDetailsText(settings.payment_details_text || '');
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
        payment_details_text: paymentDetailsText.trim() || null,
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
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Реквизиты для оплаты</Label>
              <Textarea
                value={paymentDetailsText}
                onChange={(e) => setPaymentDetailsText(e.target.value)}
                placeholder="Например: Перевод по СБП +7..., Т-Банк, получатель Иван Иванов"
                className="min-h-[90px]"
              />
              <p className="text-xs text-muted-foreground">
                Этот текст бот предложит вставить в напоминание родителю после отметки оплаты.
              </p>
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
  const queryClient = useQueryClient();
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
    isPlaceholder: lessonsIsPlaceholder,
  } = useTutorLessons(weekStart);

  // Личные дела (busy blocks) той же недели.
  const {
    events: calendarEvents,
    refetch: refetchEvents,
    isPlaceholder: eventsIsPlaceholder,
  } = useTutorCalendarEvents(weekStart);

  // Dialogs
  const [addLessonOpen, setAddLessonOpen] = useState(false);
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [detailsEvent, setDetailsEvent] = useState<TutorCalendarEvent | null>(null);
  const [lessonDetailsOpen, setLessonDetailsOpen] = useState(false);
  const [groupDetailsOpen, setGroupDetailsOpen] = useState(false);
  const [reminderSettingsOpen, setReminderSettingsOpen] = useState(false);
  const [calendarSettingsOpen, setCalendarSettingsOpen] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<TutorLessonWithStudent | null>(null);
  const [materialsDrawerLesson, setMaterialsDrawerLesson] = useState<TutorLessonWithStudent | null>(null);
  const [postLessonSheetLesson, setPostLessonSheetLesson] = useState<TutorLessonWithStudent | null>(null);
  const [selectedGroupBucket, setSelectedGroupBucket] = useState<GroupLessonBucket | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number>(0);
  // Меню «Занятие / Личное дело» по клику на пустую ячейку (Волна 1).
  const [quickAdd, setQuickAdd] = useState<QuickAddMenuState | null>(null);
  // «Внести оплату» из расписания (Волна 2): существующий TopupDialog в select-режиме,
  // никаких новых money-путей (topup = единственный «деньги получены», rule 60).
  const [topupOpen, setTopupOpen] = useState(false);
  // Превью перетаскивания живёт в DragPreviewLayer со своим стейтом (через ref) —
  // dragover больше не ререндерит страницу-монолит (performance.md).
  const dragPreviewRef = useRef<DragPreviewHandle>(null);
  const [optimisticStartsByLessonId, setOptimisticStartsByLessonId] = useState<Record<string, string>>({});
  const draggedLessonIdRef = useRef<string | null>(null);
  const draggedLessonDurationRef = useRef<number>(60);
  const isLessonDragInProgressRef = useRef(false);
  const suppressNextGridClickRef = useRef(false);
  // Перенос занятия из серии: спрашиваем scope (это / это и далее / вся серия) перед применением.
  const [pendingMove, setPendingMove] = useState<{ lesson: TutorLessonWithStudent; newStartIso: string } | null>(null);
  const [isMovingSeries, setIsMovingSeries] = useState(false);
  // Drag/перенос личных дел (mirror занятий): свой ref + оптимистичная позиция + scope-серии.
  const draggedEventIdRef = useRef<string | null>(null);
  const [optimisticEventStartsById, setOptimisticEventStartsById] = useState<Record<string, string>>({});
  const [pendingEventMove, setPendingEventMove] = useState<{ event: TutorCalendarEvent; newStartIso: string } | null>(null);
  const [isMovingEventSeries, setIsMovingEventSeries] = useState(false);

  const [copiedLink, setCopiedLink] = useState(false);

  // Payment onboarding
  const [paymentOnboardingOpen, setPaymentOnboardingOpen] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [completingLessonIds, setCompletingLessonIds] = useState<Record<string, boolean>>({});
  const completingLessonIdsRef = useRef<Record<string, boolean>>({});
  const participantPaymentRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const miniGroupsEnabled = Boolean(tutor?.mini_groups_enabled);
  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
  } = useTutorGroups(miniGroupsEnabled);
  // Дедуп (Волна 1, перф): membership-данные уже есть внутри useTutorGroups
  // (listActiveGroupsWithMembers делает тот же запрос) — отдельный
  // useTutorGroupMemberships дублировал HTTP-запрос при каждом монтировании.
  const memberships = useMemo<TutorGroupMembership[]>(
    () =>
      groups.flatMap((g) =>
        g.members.map((m) => ({
          id: `${g.id}:${m.tutor_student_id}`,
          tutor_id: g.tutor_id,
          tutor_student_id: m.tutor_student_id,
          tutor_group_id: g.id,
          is_active: m.is_active,
          created_at: g.created_at,
          updated_at: g.updated_at,
          tutor_group: g,
        })),
      ),
    [groups],
  );
  const membershipsLoading = groupsLoading;
  const membershipsError = groupsError;

  // Гард (A6): групповое ЗАНЯТИЕ создаётся только в учебных (основных) группах —
  // метки (#интенсив) сюда не попадают (иначе «занятие для #прогульщик»).
  const primaryGroupsForLesson = useMemo(() => groups.filter((g) => g.is_primary), [groups]);

  // Цвета сущностей (Волна 1, «4 группы — 4 цвета»): ячейка красится цветом группы
  // (tutor_groups.color) или ученика (tutor_students.color); тип занятия — полоской.
  const studentColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students) {
      if (s.color) map.set(s.id, s.color);
    }
    return map;
  }, [students]);

  const groupColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      if (g.color) map.set(g.id, g.color);
    }
    return map;
  }, [groups]);

  // Опции для TopupDialog (select-режим) — «Внести оплату» из расписания (Волна 2).
  const topupStudentOptions = useMemo<TopupStudentOption[]>(
    () => students.map((s) => ({
      id: s.id,
      name: s.display_name?.trim() || s.profiles?.username || 'Без имени',
      hourly_rate_cents: s.hourly_rate_cents,
    })),
    [students],
  );

  useEffect(() => {
    if (!lessonDetailsOpen || !selectedLesson) return;
    const freshLesson = lessons.find(l => l.id === selectedLesson.id);
    if (freshLesson && freshLesson !== selectedLesson) {
      setSelectedLesson(freshLesson);
    }
  }, [lessonDetailsOpen, lessons, selectedLesson]);

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
  // Tiered (2026-06-02): banner only when the schedule itself failed to load
  // (slots/lessons = load-bearing). Peripheral settings (tutor / students /
  // reminder / calendar / exceptions) failures are `degraded` — the calendar
  // still renders, so a single settings blip must not alarm (was OR-of-7).
  const scheduleDataError = slotsError || lessonsError || null;
  const scheduleDegraded = Boolean(
    tutorError || studentsError || reminderError || calendarError || exceptionsError,
  );
  const pageIsFetching =
    tutorIsFetching ||
    studentsIsFetching ||
    slotsIsFetching ||
    lessonsIsFetching ||
    reminderIsFetching ||
    calendarIsFetching ||
    exceptionsIsFetching;

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

  // Phase 2a (rule 60 «Баланс ученика»): money-RPC занятий (complete / group-toggle /
  // delete / revert) пишут или реверсят ledger-debit → после них обновляем кэши баланса,
  // иначе чипы «Долг» / карточка баланса / «Должники» показывают stale-числа.
  const invalidateBalanceCaches = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['tutor', 'balance'] });
    void queryClient.invalidateQueries({ queryKey: ['tutor', 'ledger'] });
    void queryClient.invalidateQueries({ queryKey: ['tutor', 'students'] });
    void queryClient.invalidateQueries({ queryKey: ['tutor', 'student'] });
    void queryClient.invalidateQueries({ queryKey: ['tutor', 'received-payments'] }); // журнал «Оплаты» (оплата за занятие)
  }, [queryClient]);

  // Бейджи «МЗ»/«ДЗ» пересчитываем после работы с материалами (закрытие шторки/шита).
  const invalidateMaterialFlags = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['tutor', 'lesson-material-flags'] });
  }, [queryClient]);

  const scheduleParticipantPaymentRefresh = useCallback(() => {
    if (participantPaymentRefreshTimerRef.current) {
      clearTimeout(participantPaymentRefreshTimerRef.current);
    }

    participantPaymentRefreshTimerRef.current = setTimeout(() => {
      refetchLessons();
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'payments'] });
      invalidateBalanceCaches();
      participantPaymentRefreshTimerRef.current = null;
    }, 700);
  }, [queryClient, refetchLessons, invalidateBalanceCaches]);

  useEffect(() => {
    return () => {
      if (participantPaymentRefreshTimerRef.current) {
        clearTimeout(participantPaymentRefreshTimerRef.current);
      }
    };
  }, []);

  // Phase 2b lazy-reconcile: при загрузке/смене недели досписываем прошедшие занятия текущего тутора
  // (cost-driven авто-debit) → ощущается «сразу». Throttle ~2 мин; тихо (rule 95), сетку не блокирует.
  const lastDueSyncRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastDueSyncRef.current < 120_000) return;
    lastDueSyncRef.current = now;
    void syncMyDueDebits().then(() => {
      refetchLessons();
      invalidateBalanceCaches();
    });
  }, [weekStart, refetchLessons, invalidateBalanceCaches]);

  // Префетч соседних недель (Волна 1, перф): «Назад/Вперёд» листается из кэша.
  // Ключи строятся ТЕМ ЖЕ weekRangeISO, что и хуки — иначе двойные запросы.
  useEffect(() => {
    for (const delta of [-7, 7]) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + delta);
      const { startDate, endDate } = weekRangeISO(d);
      void queryClient.prefetchQuery({
        queryKey: ['tutor', 'lessons', startDate, endDate],
        queryFn: () => getTutorLessons(startDate, endDate),
        staleTime: TUTOR_STALE_TIME_MS,
      });
      void queryClient.prefetchQuery({
        queryKey: ['tutor', 'calendar-events', startDate, endDate],
        queryFn: () => getTutorCalendarEvents(startDate, endDate),
        staleTime: TUTOR_STALE_TIME_MS,
      });
    }
  }, [weekStart, queryClient]);

  const effectiveLessons = useMemo(() => {
    if (Object.keys(optimisticStartsByLessonId).length === 0) return lessons;
    return lessons.map(lesson => (
      optimisticStartsByLessonId[lesson.id]
        ? { ...lesson, start_at: optimisticStartsByLessonId[lesson.id] }
        : lesson
    ));
  }, [lessons, optimisticStartsByLessonId]);

  const effectiveEvents = useMemo(() => {
    if (Object.keys(optimisticEventStartsById).length === 0) return calendarEvents;
    return calendarEvents.map((ev) => (
      optimisticEventStartsById[ev.id]
        ? { ...ev, start_at: optimisticEventStartsById[ev.id] }
        : ev
    ));
  }, [calendarEvents, optimisticEventStartsById]);

  // Ревью 5.6 P1 #1: пока keepPreviousData отдаёт ПРОШЛУЮ неделю (смена недели,
  // cache miss), её занятия НЕ рендерим — группировка идёт по дню недели, и старые
  // блоки легли бы под чужие даты, оставаясь кликабельными/таскабельными.
  // Каркас сетки (часы/колонки) сохраняется — белого экрана всё равно нет.
  const weekDataIsPlaceholder = lessonsIsPlaceholder || eventsIsPlaceholder;
  const displayLessons = useMemo(
    () => (weekDataIsPlaceholder ? [] : effectiveLessons),
    [weekDataIsPlaceholder, effectiveLessons],
  );
  const displayEvents = useMemo(
    () => (weekDataIsPlaceholder ? [] : effectiveEvents),
    [weekDataIsPlaceholder, effectiveEvents],
  );

  // Бейджи «МЗ»/«ДЗ» на ячейках: один батч-запрос по видимым занятиям недели (Волна 1).
  const weekLessonIds = useMemo(() => displayLessons.map((l) => l.id), [displayLessons]);
  const materialFlags = useLessonMaterialFlags(weekLessonIds);

  // Диапазон часов сетки (Волна 1): рабочие часы, РАСШИРЕННЫЕ занятиями/делами вне их —
  // раньше занятие в 08:00 при workDayStart=9 МОЛЧА не рендерилось (потеря данных).
  const visibleRange = useMemo(() => {
    let start = scheduleSettings.workDayStart;
    let end = scheduleSettings.workDayEnd;
    const widen = (startAtIso: string, durationMin: number) => {
      const d = new Date(startAtIso);
      const startH = d.getHours();
      const endH = Math.ceil((d.getHours() * 60 + d.getMinutes() + (durationMin || 60)) / 60);
      if (startH < start) start = startH;
      if (endH > end) end = Math.min(24, endH);
    };
    for (const l of displayLessons) widen(l.start_at, l.duration_min);
    for (const ev of displayEvents) widen(ev.start_at, ev.duration_min);
    return { start, end };
  }, [displayLessons, displayEvents, scheduleSettings]);

  // Час, с которого рисуется сетка (= точка отсчёта top-позиций блоков).
  const visibleStartHour = visibleRange.start;

  const visibleHours = useMemo(
    () => Array.from({ length: visibleRange.end - visibleRange.start }, (_, i) => visibleRange.start + i),
    [visibleRange],
  );

  const gridHeight = visibleHours.length * HOUR_HEIGHT;

  useEffect(() => {
    setOptimisticStartsByLessonId({});
    setOptimisticEventStartsById({});
    draggedEventIdRef.current = null;
    dragPreviewRef.current?.clear();
    draggedLessonIdRef.current = null;
    draggedLessonDurationRef.current = 60;
    isLessonDragInProgressRef.current = false;
    setGroupDetailsOpen(false);
    setSelectedGroupBucket(null);
  }, [weekStart]);

  const lessonsByDay = useMemo(() => {
    const byDay: Record<number, TutorLessonWithStudent[]> = {};
    for (let i = 0; i < 7; i++) byDay[i] = [];

    for (const lesson of displayLessons) {
      // Show all statuses: booked, completed, cancelled.
      // Фильтра по рабочим часам больше НЕТ (Волна 1): сетка сама расширяется
      // под занятия вне рабочих часов (visibleRange) — раньше они молча исчезали.
      const startDate = new Date(lesson.start_at);
      const dayOfWeek = (startDate.getDay() + 6) % 7;
      byDay[dayOfWeek].push(lesson);
    }

    return byDay;
  }, [displayLessons]);

  const eventsByDay = useMemo(() => {
    const byDay: Record<number, TutorCalendarEvent[]> = {};
    for (let i = 0; i < 7; i++) byDay[i] = [];

    for (const ev of displayEvents) {
      const startDate = new Date(ev.start_at);
      const dayOfWeek = (startDate.getDay() + 6) % 7;
      byDay[dayOfWeek].push(ev);
    }

    return byDay;
  }, [displayEvents]);

  const activeMembershipByTutorStudentId = useMemo(() => {
    const map = new Map<string, TutorGroupMembership>();
    if (!miniGroupsEnabled) return map;

    for (const membership of memberships) {
      if (!membership.is_active) continue;
      if (!membership.tutor_student_id) continue;
      if (membership.tutor_group && membership.tutor_group.is_active === false) continue;
      map.set(membership.tutor_student_id, membership);
    }

    return map;
  }, [memberships, miniGroupsEnabled]);

  const groupById = useMemo(() => {
    const map = new Map<string, TutorGroup>();
    if (!miniGroupsEnabled) return map;
    for (const group of groups) {
      if (!group.is_active) continue;
      map.set(group.id, group);
    }
    return map;
  }, [groups, miniGroupsEnabled]);

  const canUseLegacyMembershipGrouping = miniGroupsEnabled
    && !groupsLoading
    && !membershipsLoading
    && !groupsError
    && !membershipsError;

  const renderItemsByDay = useMemo(() => {
    const byDay: Record<number, DayLessonRenderItem[]> = {};
    for (let i = 0; i < 7; i++) byDay[i] = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dayLessons = lessonsByDay[dayIndex] || [];
      const dayEntries: Array<
        { kind: 'single'; lesson: TutorLessonWithStudent }
        | { kind: 'bucket'; bucketKey: string }
      > = [];

      const bucketByKey = new Map<string, {
        key: string;
        groupSessionId: string | null;
        groupId: string;
        groupName: string;
        startAt: string;
        durationMin: number;
        lessons: TutorLessonWithStudent[];
        groupSourceTutorGroupId: string | null;
        groupTitleSnapshot: string | null;
        groupSizeSnapshot: number | null;
        isLegacyFallback: boolean;
      }>();

      for (const lesson of dayLessons) {
        const startAtMinute = Math.floor(new Date(lesson.start_at).getTime() / 60000);

        if (lesson.group_session_id) {
          const bucketKey = `session:${lesson.group_session_id}|${startAtMinute}|${lesson.duration_min}`;
          const existingBucket = bucketByKey.get(bucketKey);
          const tutorStudentId = lesson.tutor_student_id;
          const membership = tutorStudentId
            ? activeMembershipByTutorStudentId.get(tutorStudentId)
            : null;
          const fallbackGroup = membership
            ? (groupById.get(membership.tutor_group_id) || membership.tutor_group || null)
            : null;
          const groupName =
            lesson.group_title_snapshot
            || fallbackGroup?.short_name
            || fallbackGroup?.name
            || 'Мини-группа';

          if (!existingBucket) {
            bucketByKey.set(bucketKey, {
              key: bucketKey,
              groupSessionId: lesson.group_session_id,
              groupId: lesson.group_source_tutor_group_id || fallbackGroup?.id || null,
              groupName,
              startAt: lesson.start_at,
              durationMin: lesson.duration_min,
              lessons: [lesson],
              groupSourceTutorGroupId: lesson.group_source_tutor_group_id || null,
              groupTitleSnapshot: lesson.group_title_snapshot || null,
              groupSizeSnapshot: lesson.group_size_snapshot ?? null,
              isLegacyFallback: false,
            });
            dayEntries.push({ kind: 'bucket', bucketKey });
          } else {
            existingBucket.lessons.push(lesson);
            if (!existingBucket.groupTitleSnapshot && lesson.group_title_snapshot) {
              existingBucket.groupTitleSnapshot = lesson.group_title_snapshot;
              existingBucket.groupName = lesson.group_title_snapshot;
            }
            if (!existingBucket.groupSourceTutorGroupId && lesson.group_source_tutor_group_id) {
              existingBucket.groupSourceTutorGroupId = lesson.group_source_tutor_group_id;
            }
            if (!existingBucket.groupSizeSnapshot && lesson.group_size_snapshot) {
              existingBucket.groupSizeSnapshot = lesson.group_size_snapshot;
            }
          }
          continue;
        }

        if (!canUseLegacyMembershipGrouping) {
          dayEntries.push({ kind: 'single', lesson });
          continue;
        }

        const tutorStudentId = lesson.tutor_student_id;
        if (!tutorStudentId) {
          dayEntries.push({ kind: 'single', lesson });
          continue;
        }

        const membership = activeMembershipByTutorStudentId.get(tutorStudentId);
        if (!membership) {
          dayEntries.push({ kind: 'single', lesson });
          continue;
        }

        const group = groupById.get(membership.tutor_group_id) || membership.tutor_group || null;
        if (!group || !group.is_active) {
          dayEntries.push({ kind: 'single', lesson });
          continue;
        }

        const bucketKey = `legacy:${group.id}|${startAtMinute}|${lesson.duration_min}`;
        const existingBucket = bucketByKey.get(bucketKey);

        if (!existingBucket) {
          bucketByKey.set(bucketKey, {
            key: bucketKey,
            groupSessionId: null,
            groupId: group.id,
            groupName: group.short_name || group.name || 'Мини-группа',
            startAt: lesson.start_at,
            durationMin: lesson.duration_min,
            lessons: [lesson],
            groupSourceTutorGroupId: group.id,
            groupTitleSnapshot: null,
            groupSizeSnapshot: null,
            isLegacyFallback: true,
          });
          dayEntries.push({ kind: 'bucket', bucketKey });
        } else {
          existingBucket.lessons.push(lesson);
        }
      }

      const dayRenderItems: DayLessonRenderItem[] = [];
      for (const entry of dayEntries) {
        if (entry.kind === 'single') {
          dayRenderItems.push(entry);
          continue;
        }

        const bucket = bucketByKey.get(entry.bucketKey);
        if (!bucket) continue;

        // For unified group lessons (groupSessionId set), always show as group card
        // even if there's only 1 lesson row (participants are in the junction table)
        if (bucket.lessons.length < 2 && !bucket.groupSessionId) {
          bucket.lessons.forEach((lesson) => {
            dayRenderItems.push({ kind: 'single', lesson });
          });
          continue;
        }

        const sortedLessons = [...bucket.lessons].sort((a, b) => {
          const timeDiff = new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.id.localeCompare(b.id);
        });

        const statusCounts = sortedLessons.reduce<GroupLessonStatusCounts>(
          (acc, lesson) => {
            if (lesson.status === 'booked') acc.booked += 1;
            if (lesson.status === 'completed') acc.completed += 1;
            if (lesson.status === 'cancelled') acc.cancelled += 1;
            return acc;
          },
          { booked: 0, completed: 0, cancelled: 0 }
        );

        dayRenderItems.push({
          kind: 'group',
          bucket: {
            key: bucket.key,
            groupSessionId: bucket.groupSessionId,
            groupId: bucket.groupId,
            groupSourceTutorGroupId: bucket.groupSourceTutorGroupId,
            groupTitleSnapshot: bucket.groupTitleSnapshot,
            groupSizeSnapshot: bucket.groupSizeSnapshot,
            isLegacyFallback: bucket.isLegacyFallback,
            groupName: bucket.groupName,
            startAt: bucket.startAt,
            durationMin: bucket.durationMin,
            lessons: sortedLessons,
            memberNames: bucket.groupSessionId && sortedLessons.length === 1 && !sortedLessons[0].tutor_student_id
              ? [`${bucket.groupSizeSnapshot ?? '?'} уч.`]
              : sortedLessons.map((lesson) => getLessonStudentName(lesson)),
            statusCounts,
          },
        });
      }

      byDay[dayIndex] = dayRenderItems;
    }

    return byDay;
  }, [lessonsByDay, canUseLegacyMembershipGrouping, activeMembershipByTutorStudentId, groupById]);

  const groupedBucketsByKey = useMemo(() => {
    const map = new Map<string, GroupLessonBucket>();
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const items = renderItemsByDay[dayIndex] || [];
      for (const item of items) {
        if (item.kind !== 'group') continue;
        map.set(item.bucket.key, item.bucket);
      }
    }
    return map;
  }, [renderItemsByDay]);

  useEffect(() => {
    if (!groupDetailsOpen || !selectedGroupBucket) return;
    let freshBucket = groupedBucketsByKey.get(selectedGroupBucket.key);
    if (!freshBucket && selectedGroupBucket.groupSessionId) {
      for (const candidateBucket of groupedBucketsByKey.values()) {
        if (candidateBucket.groupSessionId === selectedGroupBucket.groupSessionId) {
          freshBucket = candidateBucket;
          break;
        }
      }
    }

    if (!freshBucket) {
      setGroupDetailsOpen(false);
      setSelectedGroupBucket(null);
      return;
    }
    if (freshBucket !== selectedGroupBucket) {
      setSelectedGroupBucket(freshBucket);
    }
  }, [groupDetailsOpen, groupedBucketsByKey, selectedGroupBucket]);

  // Stats (по displayLessons — placeholder-неделя не должна давать чужие цифры)
  const todayLessons = useMemo(() => {
    const today = new Date();
    return displayLessons.filter(l => {
      const d = new Date(l.start_at);
      return l.status === 'booked' && d.toDateString() === today.toDateString();
    }).length;
  }, [displayLessons]);

  const weekLessons = useMemo(() => {
    return displayLessons.filter(l => l.status === 'booked').length;
  }, [displayLessons]);

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
    // Сетка стартует с visibleStartHour (рабочие часы, расширенные ранними занятиями).
    const gridStartMinutes = visibleStartHour * 60;
    const gridEndMinutes = visibleRange.end * 60;
    const minutesFromStart = Math.floor(positionY / PIXELS_PER_MINUTE);
    const rawTotalMinutes = gridStartMinutes + minutesFromStart;
    const roundedTotalMinutes = Math.round(rawTotalMinutes / 15) * 15;
    const latestAllowedStart = Math.max(gridStartMinutes, gridEndMinutes - durationMin);
    const clampedTotalMinutes = Math.max(
      gridStartMinutes,
      Math.min(roundedTotalMinutes, latestAllowedStart)
    );

    return {
      hour: Math.floor(clampedTotalMinutes / 60),
      minute: clampedTotalMinutes % 60
    };
  }, [visibleStartHour, visibleRange.end]);

  // Клик по пустой ячейке → меню «Занятие / Личное дело» (Волна 1), не сразу форма.
  const handleGridClick = useCallback((dayOfWeek: number, clickY: number, clientX: number, clientY: number) => {
    const { hour, minute } = getSnappedTimeFromPosition(clickY);

    const date = getDateForDayOfWeek(weekStart, dayOfWeek);
    setSelectedDate(date);
    setSelectedHour(hour);
    setSelectedMinute(minute);
    setQuickAdd({
      x: clientX,
      y: clientY,
      label: `${format(date, 'EEEEEE, d MMM', { locale: ru })}, ${formatTime(hour, minute)}`,
    });
  }, [getSnappedTimeFromPosition, weekStart]);

  const handleLessonClick = useCallback((lesson: TutorLessonWithStudent) => {
    if (isLessonDragInProgressRef.current) return;
    setSelectedLesson(lesson);
    setLessonDetailsOpen(true);
  }, []);

  const handleGroupBucketClick = useCallback((bucket: GroupLessonBucket) => {
    if (isLessonDragInProgressRef.current) return;
    setSelectedGroupBucket(bucket);
    setGroupDetailsOpen(true);
  }, []);

  // Стабильный хендлер клика по личному делу (инлайн-стрелка убила бы memo CalendarEventBlock).
  const handleEventClick = useCallback((ev: TutorCalendarEvent) => {
    setDetailsEvent(ev);
  }, []);

  const handleGroupDetailsOpenChange = useCallback((open: boolean) => {
    setGroupDetailsOpen(open);
    if (!open) {
      setSelectedGroupBucket(null);
    }
  }, []);

  const handleLessonDragStart = useCallback((lessonId: string, durationMin: number, event: React.DragEvent<HTMLDivElement>) => {
    isLessonDragInProgressRef.current = true;
    draggedEventIdRef.current = null; // не смешивать с drag личного дела
    draggedLessonIdRef.current = lessonId;
    draggedLessonDurationRef.current = durationMin;
    dragPreviewRef.current?.clear();
    event.dataTransfer.setData('text/plain', lessonId);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleLessonDragEnd = useCallback(() => {
    dragPreviewRef.current?.clear();
    draggedLessonDurationRef.current = 60;
    // Reset immediately so click handler is not blocked
    isLessonDragInProgressRef.current = false;
    draggedLessonIdRef.current = null;
    suppressNextGridClickRef.current = true;
  }, []);

  // Drag личных дел — отдельный ref (драг-овер/preview переиспользуют общий duration-ref).
  const handleEventDragStart = useCallback((eventId: string, durationMin: number, event: React.DragEvent<HTMLDivElement>) => {
    isLessonDragInProgressRef.current = true;
    draggedLessonIdRef.current = null; // не смешивать с drag занятия
    draggedEventIdRef.current = eventId;
    draggedLessonDurationRef.current = durationMin;
    dragPreviewRef.current?.clear();
    event.dataTransfer.setData('text/plain', eventId);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleEventDragEnd = useCallback(() => {
    dragPreviewRef.current?.clear();
    draggedLessonDurationRef.current = 60;
    isLessonDragInProgressRef.current = false;
    draggedEventIdRef.current = null;
    suppressNextGridClickRef.current = true;
  }, []);

  const handleDayDragOver = useCallback((dayIndex: number, isWorkDay: boolean, event: React.DragEvent<HTMLDivElement>) => {
    if (!isWorkDay) {
      dragPreviewRef.current?.clear();
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
    const topPx = ((hour * 60) + minute - (visibleStartHour * 60)) * PIXELS_PER_MINUTE;

    dragPreviewRef.current?.set({ dayIndex, topPx, durationMin });
  }, [effectiveLessons, getSnappedTimeFromPosition, gridHeight, visibleStartHour]);

  // Перенос одиночного занятия (оптимистично) — для не-серийных и выбора «Только это».
  // Волна 2: через money-aware RPC tutor_move_lesson (НЕ прямой UPDATE start_at):
  // past→future снимает висящий debit, past→past пересоздаёт debit с новой датой.
  const moveSingleLessonOptimistic = useCallback(async (
    lesson: TutorLessonWithStudent,
    newStartIso: string,
  ) => {
    suppressNextGridClickRef.current = true;
    setOptimisticStartsByLessonId((prev) => ({ ...prev, [lesson.id]: newStartIso }));
    const clearOptimistic = () =>
      setOptimisticStartsByLessonId((prev) => {
        const { [lesson.id]: _removed, ...rest } = prev;
        return rest;
      });
    try {
      const result = await moveLesson(lesson.id, newStartIso);
      clearOptimistic();
      if (result.ok) {
        toast.success('Занятие перенесено');
        refetchLessons();
        invalidateBalanceCaches(); // перенос — money-операция (rule 60 §13)
      } else {
        toast.error(result.error || 'Не удалось перенести');
      }
    } catch (error) {
      console.error(error);
      clearOptimistic();
      toast.error('Ошибка при переносе');
    }
  }, [refetchLessons, invalidateBalanceCaches]);

  // Перенос серии на ту же дельту времени (день недели и шаг сохраняются) — «Это и последующие» / «Вся серия».
  const moveLessonSeries = useCallback(async (
    lesson: TutorLessonWithStudent,
    newStartIso: string,
    scope: 'this_and_following' | 'all',
  ) => {
    const shiftMinutes = Math.round(
      (new Date(newStartIso).getTime() - new Date(lesson.start_at).getTime()) / 60000,
    );
    if (shiftMinutes === 0) return;
    setIsMovingSeries(true);
    try {
      // 'all' клампим к now — перенос не двигает уже прошедшие занятия (висящий debit, review #5).
      const fromStartAtOverride = scope === 'all' ? new Date().toISOString() : undefined;
      const res = await updateLessonSeries(lesson, { applyTimeShift: true, shiftMinutes, scope, fromStartAtOverride });
      if (res.ok) {
        toast.success(
          scope === 'all'
            ? `Перенесена вся серия (${res.updatedCount})`
            : `Перенесено занятий: ${res.updatedCount}`,
        );
        refetchLessons();
      } else {
        toast.error('Не удалось перенести серию');
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка при переносе серии');
    } finally {
      setIsMovingSeries(false);
    }
  }, [refetchLessons]);

  // ── Перенос личных дел (mirror занятий) ──────────────────────────────────
  const moveSingleEventOptimistic = useCallback(async (
    ev: TutorCalendarEvent,
    newStartIso: string,
  ) => {
    suppressNextGridClickRef.current = true;
    setOptimisticEventStartsById((prev) => ({ ...prev, [ev.id]: newStartIso }));
    const clearOptimistic = () =>
      setOptimisticEventStartsById((prev) => {
        const { [ev.id]: _removed, ...rest } = prev;
        return rest;
      });
    try {
      const result = await updateCalendarEvent(ev.id, { start_at: newStartIso });
      clearOptimistic();
      if (result) {
        toast.success('Дело перенесено');
        refetchEvents();
      } else {
        toast.error('Не удалось перенести');
      }
    } catch (error) {
      console.error(error);
      clearOptimistic();
      toast.error('Ошибка при переносе');
    }
  }, [refetchEvents]);

  const moveEventSeries = useCallback(async (
    ev: TutorCalendarEvent,
    newStartIso: string,
    scope: 'this_and_following' | 'all',
  ) => {
    const shiftMinutes = Math.round(
      (new Date(newStartIso).getTime() - new Date(ev.start_at).getTime()) / 60000,
    );
    if (shiftMinutes === 0) return;
    setIsMovingEventSeries(true);
    try {
      const res = await updateCalendarEventSeries(ev, { applyTimeShift: true, shiftMinutes, scope });
      if (res.ok) {
        toast.success(
          scope === 'all'
            ? `Перенесена вся серия (${res.updatedCount})`
            : `Перенесено дел: ${res.updatedCount}`,
        );
        refetchEvents();
      } else {
        toast.error('Не удалось перенести серию');
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка при переносе серии');
    } finally {
      setIsMovingEventSeries(false);
    }
  }, [refetchEvents]);

  const handleEventDrop = useCallback(async (dayIndex: number, event: React.DragEvent<HTMLDivElement>) => {
    const draggedEventId = draggedEventIdRef.current;
    if (!draggedEventId) return;
    const draggedEvent = effectiveEvents.find((ev) => ev.id === draggedEventId);
    if (!draggedEvent) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const positionY = Math.max(0, Math.min(event.clientY - rect.top, gridHeight));
    const { hour, minute } = getSnappedTimeFromPosition(positionY, draggedEvent.duration_min);
    const newStart = getDateForDayOfWeek(weekStart, dayIndex);
    newStart.setHours(hour, minute, 0, 0);

    if (newStart.getTime() === new Date(draggedEvent.start_at).getTime()) {
      suppressNextGridClickRef.current = true;
      return;
    }

    const newStartIso = newStart.toISOString();
    const isSeries = draggedEvent.is_recurring || draggedEvent.parent_event_id != null;
    if (isSeries) {
      suppressNextGridClickRef.current = true;
      setPendingEventMove({ event: draggedEvent, newStartIso });
      return;
    }
    await moveSingleEventOptimistic(draggedEvent, newStartIso);
  }, [effectiveEvents, getSnappedTimeFromPosition, gridHeight, weekStart, moveSingleEventOptimistic]);

  const handleLessonDrop = useCallback(async (dayIndex: number, isWorkDay: boolean, event: React.DragEvent<HTMLDivElement>) => {
    if (!isWorkDay) {
      dragPreviewRef.current?.clear();
      return;
    }

    event.preventDefault();
    dragPreviewRef.current?.clear();

    // Перетаскивают личное дело? Обрабатываем отдельно (тот же drop-target).
    if (draggedEventIdRef.current) {
      await handleEventDrop(dayIndex, event);
      return;
    }

    const draggedLessonId = event.dataTransfer.getData('text/plain') || draggedLessonIdRef.current;
    if (!draggedLessonId) return;

    const draggedLesson = effectiveLessons.find(l => l.id === draggedLessonId && l.status === 'booked');
    if (!draggedLesson) return;

    // Волна 2: прошедшие booked-занятия переносятся через tutor_move_lesson
    // (money-aware: реверс/пересоздание debit) — клиентский запрет снят.

    const rect = event.currentTarget.getBoundingClientRect();
    const positionY = Math.max(0, Math.min(event.clientY - rect.top, gridHeight));
    const { hour, minute } = getSnappedTimeFromPosition(positionY, draggedLesson.duration_min);
    const newStart = getDateForDayOfWeek(weekStart, dayIndex);
    newStart.setHours(hour, minute, 0, 0);

    if (newStart.getTime() === new Date(draggedLesson.start_at).getTime()) {
      suppressNextGridClickRef.current = true;
      return;
    }

    const newStartIso = newStart.toISOString();
    const isSeries = draggedLesson.is_recurring || draggedLesson.parent_lesson_id != null;
    if (isSeries) {
      // Серия (индивид. или группа) → спросить scope, как в Google Calendar, перед переносом.
      suppressNextGridClickRef.current = true;
      setPendingMove({ lesson: draggedLesson, newStartIso });
      return;
    }

    await moveSingleLessonOptimistic(draggedLesson, newStartIso);
  }, [effectiveLessons, getSnappedTimeFromPosition, gridHeight, weekStart, moveSingleLessonOptimistic, handleEventDrop]);

  // Прошедший якорь серии: только «Только это» (series-shift не money-aware, Волна 2).
  const pendingMoveIsPast = useMemo(() => {
    if (!pendingMove) return false;
    const l = pendingMove.lesson;
    return new Date(l.start_at).getTime() + (l.duration_min ?? 60) * 60000 <= Date.now();
  }, [pendingMove]);

  // Применение выбора scope из диалога переноса серии (занятия).
  const handleMoveScopeChoice = useCallback(async (scope: 'this' | 'this_and_following' | 'all') => {
    if (!pendingMove) return;
    const { lesson, newStartIso } = pendingMove;
    setPendingMove(null);
    if (scope === 'this') {
      await moveSingleLessonOptimistic(lesson, newStartIso);
    } else {
      await moveLessonSeries(lesson, newStartIso, scope);
    }
  }, [pendingMove, moveSingleLessonOptimistic, moveLessonSeries]);

  // Применение выбора scope из диалога переноса серии (личные дела).
  const handleEventMoveScopeChoice = useCallback(async (scope: 'this' | 'this_and_following' | 'all') => {
    if (!pendingEventMove) return;
    const { event, newStartIso } = pendingEventMove;
    setPendingEventMove(null);
    if (scope === 'this') {
      await moveSingleEventOptimistic(event, newStartIso);
    } else {
      await moveEventSeries(event, newStartIso, scope);
    }
  }, [pendingEventMove, moveSingleEventOptimistic, moveEventSeries]);

  const handleCompleteLesson = useCallback(async (lessonId: string, amount: number, paymentStatus: string) => {
    if (completingLessonIdsRef.current[lessonId]) {
      return;
    }

    completingLessonIdsRef.current = { ...completingLessonIdsRef.current, [lessonId]: true };
    setCompletingLessonIds((prev) => ({ ...prev, [lessonId]: true }));
    try {
      const ok = await completeLessonAndCreatePayment(lessonId, amount, paymentStatus);
      if (ok) {
        if (paymentStatus === 'paid') {
          setShowConfetti(true);
          toast.success(amount > 0 ? `Отлично! Оплата ${formatCurrency(amount)} получена` : 'Урок отмечен как оплаченный');
        } else {
          toast.success(amount > 0 ? `Урок завершён. Ждём оплату ${formatCurrency(amount)}` : 'Урок завершён');
        }
        setLessonDetailsOpen(false);
        refetchLessons();
        invalidateBalanceCaches(); // complete пишет ledger-debit (rule 60)
        // Keep the post-lesson sheet open and flip step ① to ✓ (optimistic) so the
        // tutor continues straight to materials / ДЗ without re-opening anything.
        // The sheet IS the post-completion materials surface (TASK-9 нудж subsumed).
        setPostLessonSheetLesson((prev) =>
          prev && prev.id === lessonId
            ? {
                ...prev,
                status: 'completed',
                payment_status: paymentStatus as TutorLessonWithStudent['payment_status'],
                payment_amount: amount,
              }
            : prev,
        );
      } else {
        toast.error('Не удалось завершить урок');
      }
    } catch (err) {
      console.error(err);
      toast.error('Ошибка при завершении урока');
    } finally {
      const nextById = { ...completingLessonIdsRef.current };
      delete nextById[lessonId];
      completingLessonIdsRef.current = nextById;
      setCompletingLessonIds((prev) => {
        const { [lessonId]: _removed, ...rest } = prev;
        return rest;
      });
    }
  }, [refetchLessons, invalidateBalanceCaches]);

  // Single-lesson cancel from the post-lesson sheet («Урок не состоялся»). The
  // series-scope cancel stays inside the dialog; here scope is one occurrence.
  const handleCancelLessonFromSheet = useCallback(async (lessonId: string) => {
    try {
      const ok = !!(await cancelLesson(lessonId));
      if (ok) {
        toast.success('Занятие отменено');
        setPostLessonSheetLesson(null);
        refetchLessons();
      } else {
        toast.error('Не удалось отменить занятие');
      }
    } catch (err) {
      console.error(err);
      toast.error('Не удалось отменить занятие');
    }
  }, [refetchLessons]);

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
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-[500px] w-full" />
        </div>
    );
  }

  return (
      <div className="space-y-4">
        <TutorDataStatus
          criticalError={scheduleDataError}
          degraded={scheduleDegraded}
          isFetching={pageIsFetching}
          onRetry={handleRetryAll}
        />

        {/* Phase 2b: баннер «Прошедшие занятия» удалён — авто-списание (cost-driven) делает ручное
            подтверждение ненужным; коррекция сумм — через стоимость в карточке занятия. */}

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
            {/* Кнопки добавления в шапке (Волна 1): раньше жили только под сеткой,
                на мобиле до них надо было доскроллить. «Добавить занятие» — primary
                (единственный на странице, rule 90). */}
            <Button
              size="sm"
              className="bg-accent text-white hover:bg-accent/90"
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedDate(new Date());
                setSelectedHour(new Date().getHours());
                setSelectedMinute(0);
                setAddEventOpen(true);
              }}
            >
              <Ban className="h-4 w-4 mr-2" />
              Личное дело
            </Button>
            {/* «Внести оплату» прямо из расписания (Волна 2; «абонемент» отложен —
                кнопка ведёт на существующее пополнение баланса) */}
            <Button variant="outline" size="sm" onClick={() => setTopupOpen(true)}>
              <Wallet className="h-4 w-4 mr-2" />
              Внести оплату
            </Button>
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

        {/* Stats bar / легенда */}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {LESSON_TYPES.map(t => (
            <div key={t.value} className="flex items-center gap-2">
              <div className={cn("w-3 h-3 rounded", t.color)} />
              <span>{t.shortLabel}</span>
            </div>
          ))}
          {(studentColorById.size > 0 || groupColorById.size > 0) && (
            <span className="text-xs text-muted-foreground">
              Фон ячейки — цвет группы/ученика, полоска слева — тип занятия
            </span>
          )}
          <span className="text-muted-foreground ml-auto">
            Сегодня: {todayLessons} | Неделя: {weekLessons}
          </span>
        </div>

        {/* Доход за месяц видимой недели (запрос Егора; ledger Phase 2a, rule 60) */}
        <MonthIncomeStrip weekStart={weekStart} />

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
              {/* Пока грузится новая неделя (placeholder) — каркас приглушён и неинтерактивен */}
              <div className={cn(
                'min-w-[700px] transition-opacity',
                weekDataIsPlaceholder && 'opacity-60 pointer-events-none',
              )}>
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
                      const dayRenderItems = renderItemsByDay[dayIndex] || [];

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
                            // Меню открывается и на нерабочий день (Волна 1) — раньше клик
                            // молча игнорировался, а личное дело в выходной — валидный сценарий.
                            const rect = e.currentTarget.getBoundingClientRect();
                            const clickY = e.clientY - rect.top;
                            handleGridClick(dayIndex, clickY, e.clientX, e.clientY);
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

                          {/* Lessons — memo-блоки со СТАБИЛЬНЫМИ хендлерами (инлайн-стрелки убили бы memo) */}
                          {dayRenderItems.map((item) => {
                            if (item.kind === 'single') {
                              const lesson = item.lesson;
                              const flags = materialFlags.get(lesson.id);
                              return (
                                <LessonBlock
                                  key={lesson.id}
                                  lesson={lesson}
                                  workDayStart={visibleStartHour}
                                  customColor={lesson.tutor_students ? studentColorById.get(lesson.tutor_students.id) ?? null : null}
                                  hasMaterials={flags?.hasMaterials}
                                  hasHomework={flags?.hasHomework}
                                  onClick={handleLessonClick}
                                  onDragStart={handleLessonDragStart}
                                  onDragEnd={handleLessonDragEnd}
                                />
                              );
                            }

                            let bucketHasMaterials = false;
                            let bucketHasHomework = false;
                            for (const lesson of item.bucket.lessons) {
                              const f = materialFlags.get(lesson.id);
                              if (f?.hasMaterials) bucketHasMaterials = true;
                              if (f?.hasHomework) bucketHasHomework = true;
                            }
                            const bucketGroupId = item.bucket.groupSourceTutorGroupId ?? item.bucket.groupId;
                            return (
                              <GroupLessonBlock
                                key={item.bucket.key}
                                bucket={item.bucket}
                                workDayStart={visibleStartHour}
                                customColor={bucketGroupId ? groupColorById.get(bucketGroupId) ?? null : null}
                                hasMaterials={bucketHasMaterials}
                                hasHomework={bucketHasHomework}
                                onClick={handleGroupBucketClick}
                                onDragStart={handleLessonDragStart}
                                onDragEnd={handleLessonDragEnd}
                              />
                            );
                          })}

                          {/* Личные дела (busy blocks) */}
                          {(eventsByDay[dayIndex] || []).map((ev) => (
                            <CalendarEventBlock
                              key={ev.id}
                              event={ev}
                              workDayStart={visibleStartHour}
                              onClick={handleEventClick}
                              onDragStart={handleEventDragStart}
                              onDragEnd={handleEventDragEnd}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  {/* Превью перетаскивания — отдельный слой со своим стейтом (см. LessonBlocks) */}
                  <DragPreviewLayer ref={dragPreviewRef} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick add buttons */}
        <div className="flex flex-wrap justify-center gap-2">
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
          <Button
            variant="outline"
            onClick={() => {
              setSelectedDate(new Date());
              setSelectedHour(new Date().getHours());
              setSelectedMinute(0);
              setAddEventOpen(true);
            }}
          >
            <Ban className="h-4 w-4 mr-2" />
            Личное дело
          </Button>
        </div>

        {/* Меню «Занятие / Личное дело» по клику на ячейку (Волна 1) */}
        <QuickAddMenu
          state={quickAdd}
          onClose={() => setQuickAdd(null)}
          onAddLesson={() => setAddLessonOpen(true)}
          onAddEvent={() => setAddEventOpen(true)}
        />

        {/* «Внести оплату» — пополнение баланса из расписания (Волна 2) */}
        <TopupDialog
          open={topupOpen}
          onOpenChange={setTopupOpen}
          tutorStudentId=""
          students={topupStudentOptions}
          onSaved={() => invalidateBalanceCaches()}
        />

        {/* Dialogs */}
        {addLessonOpen && (
          <Suspense fallback={null}>
            <AddLessonDialog
              open={addLessonOpen}
              onOpenChange={setAddLessonOpen}
              miniGroupsEnabled={miniGroupsEnabled}
              groups={primaryGroupsForLesson}
              memberships={memberships}
              groupsLoading={groupsLoading}
              membershipsLoading={membershipsLoading}
              groupsError={groupsError}
              membershipsError={membershipsError}
              students={students}
              initialDate={selectedDate}
              initialHour={selectedHour}
              initialMinute={selectedMinute}
              weekLessons={displayLessons}
              weekEvents={displayEvents}
              onSuccess={() => refetchLessons()}
            />
          </Suspense>
        )}

        <AddEventDialog
          open={addEventOpen}
          onOpenChange={setAddEventOpen}
          initialDate={selectedDate}
          initialHour={selectedHour}
          initialMinute={selectedMinute}
          onSuccess={() => refetchEvents()}
        />

        <EventDetailsDialog
          open={detailsEvent !== null}
          onOpenChange={(o) => { if (!o) setDetailsEvent(null); }}
          event={detailsEvent}
          onUpdated={() => { refetchEvents(); refetchLessons(); }}
        />

        <LessonDetailsDialog
          open={lessonDetailsOpen}
          onOpenChange={setLessonDetailsOpen}
          lesson={selectedLesson}
          students={students}
          onCancel={() => { refetchLessons(); invalidateBalanceCaches(); }}
          onUpdate={() => { refetchLessons(); invalidateBalanceCaches(); }}
          isCompleting={selectedLesson ? Boolean(completingLessonIds[selectedLesson.id]) : false}
          onOpenMaterials={() => {
            setLessonDetailsOpen(false);
            setMaterialsDrawerLesson(selectedLesson);
          }}
          onOpenPostLesson={() => {
            setLessonDetailsOpen(false);
            setPostLessonSheetLesson(selectedLesson);
          }}
        />

        {materialsDrawerLesson && (
          <Suspense fallback={null}>
            <LessonMaterialsDrawer
              open={!!materialsDrawerLesson}
              onOpenChange={(o) => { if (!o) { setMaterialsDrawerLesson(null); invalidateMaterialFlags(); } }}
              lesson={materialsDrawerLesson}
            />
          </Suspense>
        )}

        {postLessonSheetLesson && (
          <Suspense fallback={null}>
            <PostLessonSheet
              open={!!postLessonSheetLesson}
              onOpenChange={(o) => { if (!o) { setPostLessonSheetLesson(null); invalidateMaterialFlags(); } }}
              lesson={postLessonSheetLesson}
            />
          </Suspense>
        )}

        <GroupDetailsDialog
          open={groupDetailsOpen}
          onOpenChange={handleGroupDetailsOpenChange}
          bucket={selectedGroupBucket}
          onActionApplied={() => { refetchLessons(); invalidateBalanceCaches(); }}
          onParticipantPaymentUpdated={scheduleParticipantPaymentRefresh}
          onOpenMaterials={(lesson) => {
            handleGroupDetailsOpenChange(false);
            setMaterialsDrawerLesson(lesson);
          }}
          students={students}
        />

        {/* Перенос серии — выбор scope (Google-Calendar-style), общий для индивид. и групп.
            Прошедший якорь — ТОЛЬКО «Только это»: series-shift (update_lesson_series) не
            money-aware, прошедшие занятия серии переносятся по одному через tutor_move_lesson. */}
        <AlertDialog
          open={pendingMove !== null}
          onOpenChange={(open) => { if (!open) setPendingMove(null); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Перенести занятие</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingMoveIsPast
                  ? 'Это прошедшее занятие из серии — переносится только по одному (списание пересчитается автоматически).'
                  : 'Это занятие входит в повторяющуюся серию. Что перенести?'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col sm:flex-row gap-2">
              <AlertDialogCancel disabled={isMovingSeries}>Отмена</AlertDialogCancel>
              <Button
                variant="outline"
                disabled={isMovingSeries}
                onClick={() => handleMoveScopeChoice('this')}
              >
                Только это
              </Button>
              {!pendingMoveIsPast && (
                <>
                  <Button
                    variant="outline"
                    disabled={isMovingSeries}
                    onClick={() => handleMoveScopeChoice('this_and_following')}
                  >
                    Это и последующие
                  </Button>
                  <AlertDialogAction
                    disabled={isMovingSeries}
                    onClick={() => handleMoveScopeChoice('all')}
                  >
                    Вся серия
                  </AlertDialogAction>
                </>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Перенос серии личных дел — выбор scope */}
        <AlertDialog
          open={pendingEventMove !== null}
          onOpenChange={(open) => { if (!open) setPendingEventMove(null); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Перенести личное дело</AlertDialogTitle>
              <AlertDialogDescription>
                Это дело входит в повторяющуюся серию. Что перенести?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col sm:flex-row gap-2">
              <AlertDialogCancel disabled={isMovingEventSeries}>Отмена</AlertDialogCancel>
              <Button variant="outline" disabled={isMovingEventSeries} onClick={() => handleEventMoveScopeChoice('this')}>
                Только это
              </Button>
              <Button variant="outline" disabled={isMovingEventSeries} onClick={() => handleEventMoveScopeChoice('this_and_following')}>
                Это и последующие
              </Button>
              <AlertDialogAction disabled={isMovingEventSeries} onClick={() => handleEventMoveScopeChoice('all')}>
                Вся серия
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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

        <ConfettiBurst active={showConfetti} onComplete={() => setShowConfetti(false)} />
      </div>
  );
}

// =============================================
// Export
// =============================================

export default function TutorSchedule() {
  return <TutorScheduleContent />;
}
