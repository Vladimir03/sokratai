// Форма создания занятия — извлечена из TutorSchedule.tsx (Волна 1, rule 10:
// монолит больше не пухнет; подключается через React.lazy).
// Новое в Волне 1: поиск ученика (StudentCombobox), «Без ученика», быстрый
// плейсхолдер «+ Новый ученик», поле «Тема занятия», периоды повтора
// (день/неделя/2 недели/месяц) с дефолтом «до 30 июня» и пресетами.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { calculateLessonPaymentAmount, parseLessonPriceInput } from '@/lib/paymentAmount';
import { manualAddTutorStudent } from '@/lib/tutors';
import { findConflicts } from '@/lib/tutorCalendarEvents';
import {
  createLesson,
  createLessonSeries,
  getLastLessonPriceForStudent,
  getLastLessonPricesForStudents,
} from '@/lib/tutorSchedule';
import {
  createMiniGroupLesson,
  createMiniGroupLessonSeries,
  generateGroupSessionId,
} from '@/lib/tutorScheduleGroupCreate';
import {
  defaultSeriesEndDate,
  generateSeriesDates,
  recurrenceRuleLabel,
  RECURRENCE_RULE_OPTIONS,
  type RecurrenceRule,
} from '@/lib/recurrenceDates';
import { getLessonStudentName } from '@/components/tutor/schedule/LessonBlocks';
import { LESSON_TYPES } from '@/components/tutor/schedule/scheduleColors';
import { StudentCombobox, NO_STUDENT_VALUE } from '@/components/tutor/schedule/StudentCombobox';
import { SUBJECT_REGISTRY } from '@/lib/subjects/registry';
import type {
  LessonType,
  TutorCalendarEvent,
  TutorGroup,
  TutorGroupMembership,
  TutorLessonWithStudent,
  TutorStudentWithProfile,
} from '@/types/tutor';

export interface AddLessonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  miniGroupsEnabled: boolean;
  groups: TutorGroup[];
  memberships: TutorGroupMembership[];
  groupsLoading: boolean;
  membershipsLoading: boolean;
  groupsError: string | null;
  membershipsError: string | null;
  students: TutorStudentWithProfile[];
  initialDate: Date | null;
  initialHour: number | null;
  initialMinute?: number;
  /** Занятия + личные дела видимой недели — для мягкого предупреждения о наложении. */
  weekLessons: TutorLessonWithStudent[];
  weekEvents: TutorCalendarEvent[];
  onSuccess: () => void;
}

type LessonMode = 'individual' | 'mini_group';
type RecurrenceChoice = 'none' | RecurrenceRule;

export function AddLessonDialog({
  open,
  onOpenChange,
  miniGroupsEnabled,
  groups,
  memberships,
  groupsLoading,
  membershipsLoading,
  groupsError,
  membershipsError,
  students,
  initialDate,
  initialHour,
  initialMinute = 0,
  weekLessons,
  weekEvents,
  onSuccess,
}: AddLessonDialogProps) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState<Date | undefined>(initialDate || new Date());
  const [hour, setHour] = useState(initialHour?.toString() || new Date().getHours().toString());
  const [minute, setMinute] = useState(initialMinute.toString().padStart(2, '0'));
  const [lessonMode, setLessonMode] = useState<LessonMode>('individual');
  const [studentId, setStudentId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('60');
  const [lessonType, setLessonType] = useState<LessonType>('regular');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  // Период повтора: 'none' = разовое занятие (Волна 1: день/неделя/2 недели/месяц).
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>('none');
  const [repeatUntil, setRepeatUntil] = useState<Date | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  // Ручная цена занятия (РУБЛИ). Индивидуальное — строка; группа — по участнику (key=tutor_student_id).
  // Предзаполняется последней ценой ученика (UX-решение владельца), редактируемо.
  const [priceText, setPriceText] = useState('');
  const [memberPrices, setMemberPrices] = useState<Record<string, string>>({});
  // Тутор уже трогал поле цены? Тогда поздний async-prefill не должен затирать ввод (review fix).
  const priceTouchedRef = useRef(false);
  // Быстрые плейсхолдеры, созданные из формы: попадают в пикер сразу, до рефетча списка.
  const [localCreated, setLocalCreated] = useState<TutorStudentWithProfile[]>([]);
  const [creatingStudent, setCreatingStudent] = useState(false);
  // Мини-форма «+ Новый ученик»: имя + ОБЯЗАТЕЛЬНЫЙ канонический предмет
  // (rule 60/AGENTS: имя + предмет — фронтовый gate; ревью 5.6 P1 #3).
  const [pendingCreateName, setPendingCreateName] = useState<string | null>(null);
  const [newStudentSubject, setNewStudentSubject] = useState('');

  const isRecurring = recurrence !== 'none';

  useEffect(() => {
    if (open) {
      setDate(initialDate || new Date());
      setHour(initialHour?.toString() || new Date().getHours().toString());
      setMinute(initialMinute.toString().padStart(2, '0'));
      setLessonMode('individual');
      setStudentId('');
      setGroupId('');
      setNotes('');
      setDuration('60');
      setLessonType('regular');
      setSubject('');
      setTopic('');
      setRecurrence('none');
      setRepeatUntil(undefined);
      setPriceText('');
      setMemberPrices({});
      setLocalCreated([]);
      setPendingCreateName(null);
      setNewStudentSubject('');
      priceTouchedRef.current = false;
    }
  }, [open, initialDate, initialHour, initialMinute]);

  useEffect(() => {
    if (lessonMode === 'mini_group') {
      setStudentId('');
      setPriceText('');
      priceTouchedRef.current = false;
      // daily для мини-групп отключён (per-occurrence цикл, см. tutorScheduleGroupCreate).
      setRecurrence((prev) => (prev === 'daily' ? 'weekly' : prev));
    }
  }, [lessonMode]);

  // Сброс цен участников при смене группы (новый состав → свежий предзаполнённый прайс).
  useEffect(() => {
    setMemberPrices({});
  }, [groupId]);

  // Объединённый список для пикера/сабмита: серверные + свежесозданные плейсхолдеры.
  const allStudents = useMemo(() => {
    if (localCreated.length === 0) return students;
    const known = new Set(students.map((s) => s.student_id));
    return [...students, ...localCreated.filter((s) => !known.has(s.student_id))];
  }, [students, localCreated]);

  const isNoStudent = studentId === NO_STUDENT_VALUE;

  // Auto-fill subject from student profile
  useEffect(() => {
    if (studentId && !isNoStudent) {
      const student = allStudents.find(s => s.student_id === studentId);
      if (student?.subject) {
        setSubject(student.subject);
      }
    }
  }, [studentId, isNoStudent, allStudents]);

  const studentsByTutorStudentId = useMemo(() => {
    const map = new Map<string, TutorStudentWithProfile>();
    allStudents.forEach((student) => {
      map.set(student.id, student);
    });
    return map;
  }, [allStudents]);

  const selectedGroupMemberships = useMemo(
    () =>
      memberships.filter(
        (membership) =>
          membership.is_active && groupId !== '' && membership.tutor_group_id === groupId
      ),
    [groupId, memberships]
  );

  const selectedGroupMembers = useMemo(
    () =>
      selectedGroupMemberships.map((membership) => ({
        membership,
        student: studentsByTutorStudentId.get(membership.tutor_student_id) ?? null,
      })),
    [selectedGroupMemberships, studentsByTutorStudentId]
  );

  const resolvedGroupMembers = useMemo(
    () => selectedGroupMembers.filter((member) => member.student !== null),
    [selectedGroupMembers]
  );

  const unresolvedGroupMembers = useMemo(
    () => selectedGroupMembers.filter((member) => member.student === null),
    [selectedGroupMembers]
  );

  const membersWithoutRate = useMemo(
    () =>
      resolvedGroupMembers.filter(
        (member) => member.student?.hourly_rate_cents == null
      ),
    [resolvedGroupMembers]
  );

  const miniGroupDataError = groupsError || membershipsError;
  const canUseMiniGroupMode = miniGroupsEnabled;
  const isMiniGroupMode = canUseMiniGroupMode && lessonMode === 'mini_group';
  const isMiniGroupDataLoading = isMiniGroupMode && (groupsLoading || membershipsLoading);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === groupId) ?? null,
    [groupId, groups]
  );

  const miniGroupMembersForCreate = useMemo(
    () =>
      resolvedGroupMembers.map((member) => ({
        tutorStudentId: member.student!.id,
        studentId: member.student!.student_id,
        studentName: member.student?.profiles?.username || 'Без имени',
      })),
    [resolvedGroupMembers]
  );

  // Предзаполнение цены индивидуального занятия последней ценой ученика (fallback — ставка×длит).
  useEffect(() => {
    if (isMiniGroupMode || !studentId || isNoStudent) return;
    const tutorStudent = allStudents.find((s) => s.student_id === studentId);
    if (!tutorStudent) return;
    priceTouchedRef.current = false; // новый ученик → можно предзаполнить заново
    let cancelled = false;
    void (async () => {
      const last = await getLastLessonPriceForStudent(tutorStudent.id);
      // Не затираем, если тутор уже ввёл цену пока шёл запрос (review fix #3).
      if (cancelled || priceTouchedRef.current) return;
      const derived = calculateLessonPaymentAmount(
        parseInt(duration) || 60,
        tutorStudent.hourly_rate_cents ?? null,
      );
      const prefill = last ?? derived;
      setPriceText(prefill != null ? String(prefill) : '');
    })();
    return () => { cancelled = true; };
    // duration намеренно вне deps — иначе смена длительности затёрла бы ручную правку цены.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, isNoStudent, isMiniGroupMode, allStudents]);

  // Предзаполнение цены каждого участника группы (последняя цена ученика → ставка×длит).
  // Guard: уже введённые цены не затираем (эффект может перезапуститься при рефетче состава).
  // Батч (Волна 1, перф): 2 запроса на весь состав вместо N×2.
  useEffect(() => {
    if (!isMiniGroupMode || resolvedGroupMembers.length === 0) return;
    let cancelled = false;
    void (async () => {
      const lastPrices = await getLastLessonPricesForStudents(
        resolvedGroupMembers.map((m) => m.student!.id),
      );
      const entries = resolvedGroupMembers.map((m) => {
        const ts = m.student!;
        const last = lastPrices.get(ts.id) ?? null;
        const derived = calculateLessonPaymentAmount(
          parseInt(duration) || 60,
          ts.hourly_rate_cents ?? null,
        );
        const prefill = last ?? derived;
        return [ts.id, prefill != null ? String(prefill) : ''] as const;
      });
      if (cancelled) return;
      setMemberPrices((prev) => {
        const next = { ...prev };
        for (const [id, val] of entries) {
          if (next[id] === undefined) next[id] = val;
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMiniGroupMode, resolvedGroupMembers]);

  // Мягкое предупреждение о наложении на личное дело ИЛИ другое занятие (не блокирует создание).
  const conflictInfo = useMemo(() => {
    if (!date) return null;
    const start = new Date(date);
    start.setHours(parseInt(hour), parseInt(minute), 0, 0);
    const dur = parseInt(duration) || 60;
    const end = new Date(start.getTime() + dur * 60000);
    const { lessons: lc, events: ec } = findConflicts(start, end, weekLessons, weekEvents);
    if (lc.length === 0 && ec.length === 0) return null;
    return { lessons: lc, events: ec };
  }, [date, hour, minute, duration, weekLessons, weekEvents]);

  // Смена периода: если дата окончания ещё не выбрана — дефолт «до конца учебного года».
  // Считается от ДАТЫ ПЕРВОГО ЗАНЯТИЯ, не от сегодня (ревью 5.6 P1 #4: занятие,
  // запланированное после 30 июня, давало repeatUntil < start → пустая серия).
  const handleRecurrenceChange = (value: RecurrenceChoice) => {
    setRecurrence(value);
    if (value !== 'none' && !repeatUntil) {
      setRepeatUntil(defaultSeriesEndDate(date ?? new Date()));
    }
  };

  // Перенесли старт за пределы выбранного окончания → пересчитать окончание,
  // иначе серия молча генерит 0 занятий (ревью 5.6 P1 #4).
  useEffect(() => {
    if (recurrence === 'none' || !date || !repeatUntil) return;
    if (repeatUntil < date) {
      setRepeatUntil(defaultSeriesEndDate(date));
    }
    // repeatUntil в deps намеренно: ручной выбор даты раньше старта тоже чиним.
  }, [date, repeatUntil, recurrence]);

  // Подсказка «Будет создано ~N занятий» — тем же генератором, что и создание.
  const plannedCount = useMemo(() => {
    if (!isRecurring || !repeatUntil || !date) return null;
    const start = new Date(date);
    start.setHours(parseInt(hour), parseInt(minute), 0, 0);
    const until = new Date(new Date(repeatUntil).setHours(23, 59, 59, 999));
    return generateSeriesDates(start, until, recurrence as RecurrenceRule).length;
  }, [isRecurring, repeatUntil, date, hour, minute, recurrence]);

  // Быстрый плейсхолдер «+ Новый ученик»: клик в пикере открывает мини-форму
  // (имя + обязательный канонический предмет — фронтовый gate rule 60; ревью 5.6 P1 #3).
  const handleCreateStudentRequest = (name: string) => {
    setPendingCreateName(name);
  };

  // Создание через edge tutor-manual-add-student; контакт/доступы — позже
  // в карточке ученика (create-then-claim).
  const handleConfirmCreateStudent = async () => {
    const name = pendingCreateName?.trim();
    if (!name || creatingStudent) return;
    if (!newStudentSubject) {
      toast.error('Выберите предмет ученика');
      return;
    }
    setCreatingStudent(true);
    try {
      const res = await manualAddTutorStudent({ name, learning_goal: '', subject: newStudentSubject });
      const stub: TutorStudentWithProfile = {
        id: res.tutor_student_id,
        tutor_id: '',
        student_id: res.student_id,
        display_name: name,
        target_score: null,
        start_score: null,
        current_score: null,
        exam_type: null,
        subject: newStudentSubject,
        notes: null,
        status: 'active',
        paid_until: null,
        last_activity_at: null,
        parent_contact: null,
        last_lesson_at: null,
        hourly_rate_cents: null,
        created_at: '',
        updated_at: '',
        profiles: {
          id: res.student_id,
          username: name,
          telegram_username: null,
          telegram_user_id: null,
          grade: null,
        },
      };
      setLocalCreated((prev) => [...prev, stub]);
      setStudentId(res.student_id);
      setPendingCreateName(null);
      setNewStudentSubject('');
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'students'] });
      toast.success(`Ученик «${name}» создан. Доступы можно выдать позже в его карточке.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось создать ученика');
    } finally {
      setCreatingStudent(false);
    }
  };

  const handleSubmit = async () => {
    if (!date) {
      toast.error('Выберите дату');
      return;
    }
    const startAt = new Date(date);
    startAt.setHours(parseInt(hour), parseInt(minute), 0, 0);
    const baseLessonInput = {
      start_at: startAt.toISOString(),
      duration_min: parseInt(duration),
      lesson_type: lessonType,
      subject: subject || undefined,
      topic: topic.trim() || undefined,
      notes: notes || undefined,
    };
    const rule: RecurrenceRule = isRecurring ? (recurrence as RecurrenceRule) : 'weekly';

    if (isMiniGroupMode) {
      if (isMiniGroupDataLoading) {
        toast.error('Подождите, идет загрузка состава мини-группы');
        return;
      }
      if (miniGroupDataError) {
        toast.error('Не удалось загрузить данные мини-групп');
        return;
      }
      if (!groupId) {
        toast.error('Выберите мини-группу');
        return;
      }
      if (miniGroupMembersForCreate.length === 0) {
        toast.error('В выбранной группе нет активных участников');
        return;
      }
      if (unresolvedGroupMembers.length > 0) {
        toast.error('Часть участников группы не найдена в списке учеников');
        return;
      }
      if (isRecurring && !repeatUntil) {
        toast.error('Выберите дату окончания повторений');
        return;
      }
      if (isRecurring && repeatUntil && (plannedCount ?? 0) === 0) {
        // Ревью 5.6 P1 #4: не даём молча создать «серию из 0 занятий».
        toast.error('Дата окончания серии раньше первого занятия — поправьте «Повторять до»');
        return;
      }

      const sessionId = generateGroupSessionId();

      const groupLessonInput = {
        ...baseLessonInput,
        group_session_id: sessionId,
        group_source_tutor_group_id: selectedGroup?.id,
        group_title_snapshot: selectedGroup?.short_name || selectedGroup?.name || 'Мини-группа',
        group_size_snapshot: miniGroupMembersForCreate.length,
      };

      const groupMembers = miniGroupMembersForCreate.map((m) => ({
        ...m,
        hourlyRateCents: resolvedGroupMembers.find(
          (rm) => rm.student?.id === m.tutorStudentId
        )?.student?.hourly_rate_cents ?? null,
        // Ручная цена участника (null = derived из ставки, 0 = waive). Применится ко всей серии.
        overrideAmount: parseLessonPriceInput(memberPrices[m.tutorStudentId] ?? ''),
      }));

      setIsSaving(true);
      try {
        if (isRecurring && repeatUntil) {
          const result = await createMiniGroupLessonSeries({
            members: groupMembers,
            lessonInput: groupLessonInput,
            repeatUntil: repeatUntil.toISOString(),
            rule,
            makeGroupSessionId: generateGroupSessionId,
          });
          if (result.ok && result.root) {
            if (result.failedCount > 0) {
              // Частичный успех: часть повторов не создалась — НЕ скрываем это.
              toast.warning(
                `Создано ${result.count} из ${result.expected} занятий. ${result.failedCount} не удалось — проверьте расписание и при необходимости добавьте вручную.`,
              );
            } else {
              toast.success(`Создано ${result.count} занятий для мини-группы (${recurrenceRuleLabel(rule).toLowerCase()})`);
            }
            onSuccess();
            onOpenChange(false);
          } else {
            toast.error(result.errorMessage || 'Не удалось создать серию занятий');
          }
        } else {
          const result = await createMiniGroupLesson({
            members: groupMembers,
            lessonInput: groupLessonInput,
          });
          if (result.ok) {
            toast.success(`Занятие для мини-группы создано (${result.participantsInserted} уч.)`);
            onSuccess();
            onOpenChange(false);
          } else {
            toast.error(result.errorMessage || 'Не удалось создать занятие');
          }
        }
      } catch (err) {
        console.error(err);
        toast.error('Ошибка при создании занятия для мини-группы');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    // Волна 1: занятие можно создать БЕЗ ученика — но выбор должен быть явным
    // («Без ученика» в пикере), пустой пикер = не решил, не создаём молча.
    if (!studentId) {
      toast.error('Выберите ученика или «Без ученика»');
      return;
    }
    if (isRecurring && !repeatUntil) {
      toast.error('Выберите дату окончания повторений');
      return;
    }
    if (isRecurring && repeatUntil && (plannedCount ?? 0) === 0) {
      // Ревью 5.6 P1 #4: не даём молча создать «серию из 0 занятий».
      toast.error('Дата окончания серии раньше первого занятия — поправьте «Повторять до»');
      return;
    }

    setIsSaving(true);
    try {
      const tutorStudent = isNoStudent
        ? undefined
        : allStudents.find(s => s.student_id === studentId);

      // Без ученика нет баланса → цена не пишется (auto-debit идёт по tutor_student_id).
      const individualPrice = isNoStudent ? null : parseLessonPriceInput(priceText);

      if (isRecurring && repeatUntil) {
        const { root, count } = await createLessonSeries(
          {
            tutor_student_id: tutorStudent?.id,
            student_id: isNoStudent ? undefined : studentId,
            payment_amount: individualPrice,
            ...baseLessonInput,
          },
          repeatUntil.toISOString(),
          rule
        );

        if (root) {
          toast.success(`Создано ${count} занятий (${recurrenceRuleLabel(rule).toLowerCase()})`);
          onSuccess();
          onOpenChange(false);
        } else {
          toast.error('Не удалось создать серию занятий');
        }
      } else {
        const result = await createLesson({
          tutor_student_id: tutorStudent?.id,
          student_id: isNoStudent ? undefined : studentId,
          payment_amount: individualPrice,
          ...baseLessonInput,
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

  // Пресеты даты окончания серии (репорт: «до июня очень долго листать календарь»).
  // Оба считаются от даты первого занятия (ревью 5.6 P1 #4).
  const applyEndPreset = (preset: 'school_year' | 'three_months') => {
    if (preset === 'school_year') {
      setRepeatUntil(defaultSeriesEndDate(date ?? new Date()));
      return;
    }
    const base = date ? new Date(date) : new Date();
    base.setMonth(base.getMonth() + 3);
    setRepeatUntil(base);
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

          {conflictInfo && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-900">
              <AlertDescription className="text-sm">
                <div className="font-medium">⚠️ В это время уже есть записи:</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {conflictInfo.events.map((ev) => (
                    <li key={ev.id}>Занято: {ev.title} ({format(new Date(ev.start_at), 'HH:mm')})</li>
                  ))}
                  {conflictInfo.lessons.map((l) => (
                    <li key={l.id}>Занятие: {getLessonStudentName(l)} ({format(new Date(l.start_at), 'HH:mm')})</li>
                  ))}
                </ul>
                <div className="mt-1 text-xs opacity-80">Создать занятие всё равно можно.</div>
              </AlertDescription>
            </Alert>
          )}

          {canUseMiniGroupMode && (
            <div className="space-y-2">
              <Label>Формат занятия</Label>
              <Select
                value={lessonMode}
                onValueChange={(value) => setLessonMode(value as LessonMode)}
                disabled={isSaving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Индивидуально</SelectItem>
                  <SelectItem value="mini_group">Мини-группа</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {lessonMode === 'individual'
                  ? 'Формат занятия: Индивидуально'
                  : 'Формат занятия: Мини-группа'}
              </p>
            </div>
          )}

          {!isMiniGroupMode && (
            <div className="space-y-2">
              <Label>Ученик *</Label>
              <StudentCombobox
                students={allStudents}
                value={studentId}
                onChange={setStudentId}
                disabled={isSaving}
                allowNoStudent
                onCreateStudent={handleCreateStudentRequest}
                creatingStudent={creatingStudent}
              />
              {isNoStudent && (
                <p className="text-xs text-muted-foreground">
                  Занятие без учеников: попадёт в расписание, деньги не списываются. Учеников можно добавить позже.
                </p>
              )}

              {/* Мини-форма быстрого плейсхолдера: имя + обязательный предмет (rule 60) */}
              {pendingCreateName !== null && (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">Новый ученик</p>
                  <Input
                    value={pendingCreateName}
                    onChange={(e) => setPendingCreateName(e.target.value)}
                    placeholder="Имя ученика"
                    className="text-base"
                  />
                  <Select value={newStudentSubject} onValueChange={setNewStudentSubject}>
                    <SelectTrigger>
                      <SelectValue placeholder="Предмет *" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECT_REGISTRY.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleConfirmCreateStudent()}
                      disabled={creatingStudent || !pendingCreateName.trim() || !newStudentSubject}
                    >
                      {creatingStudent ? 'Создаём...' : 'Создать ученика'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => { setPendingCreateName(null); setNewStudentSubject(''); }}
                    >
                      Отмена
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Контакт и доступы можно выдать позже в карточке ученика.
                  </p>
                </div>
              )}
            </div>
          )}

          {isMiniGroupMode && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-2">
                <Label>Мини-группа *</Label>
                <Select
                  value={groupId}
                  onValueChange={setGroupId}
                  disabled={isSaving || isMiniGroupDataLoading || groups.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите мини-группу" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        <span className="flex items-center gap-2">
                          {group.color && (
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: group.color }}
                              aria-hidden="true"
                            />
                          )}
                          {group.short_name || group.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Будет создано одно групповое занятие с участниками выбранной мини-группы.
                </p>
              </div>

              {isMiniGroupDataLoading && (
                <p className="text-xs text-muted-foreground">
                  Загружаем состав мини-групп...
                </p>
              )}

              {!isMiniGroupDataLoading && miniGroupDataError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Не удалось загрузить мини-группы. Попробуйте закрыть и открыть форму снова.
                  </AlertDescription>
                </Alert>
              )}

              {!isMiniGroupDataLoading && !miniGroupDataError && groups.length === 0 && (
                <Alert>
                  <AlertDescription>
                    Нет активных мини-групп. Создайте группу во вкладке "Ученики".
                  </AlertDescription>
                </Alert>
              )}

              {!isMiniGroupDataLoading && !miniGroupDataError && groupId && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      Состав группы {selectedGroup ? `"${selectedGroup.short_name || selectedGroup.name}"` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Участников: {resolvedGroupMembers.length}
                    </p>
                  </div>

                  {resolvedGroupMembers.length > 0 && (
                    <div className="space-y-2">
                      <div className="max-h-60 overflow-auto rounded border bg-muted/20 p-2 text-sm">
                        <ul className="space-y-2">
                          {resolvedGroupMembers.map((member) => (
                            <li key={member.student!.id} className="space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate">{member.student?.profiles?.username || 'Без имени'}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {member.student?.hourly_rate_cents != null
                                    ? `${member.student.hourly_rate_cents / 100} ₽/ч`
                                    : 'Ставка не указана'}
                                </span>
                              </div>
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={memberPrices[member.student!.id] ?? ''}
                                onChange={(e) =>
                                  setMemberPrices((prev) => ({ ...prev, [member.student!.id]: e.target.value }))
                                }
                                placeholder="Стоимость, ₽"
                                className="h-9 text-base"
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Цена за занятие для каждого ученика спишется с баланса после занятия. 0 — не списывать. Пусто — из ставки. Применится ко всей серии.
                      </p>
                    </div>
                  )}

                  {resolvedGroupMembers.length === 0 && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        В выбранной группе нет активных участников.
                      </AlertDescription>
                    </Alert>
                  )}

                  {resolvedGroupMembers.length === 1 && (
                    <Alert>
                      <AlertDescription>
                        В группе только 1 участник. Будет создано 1 занятие.
                      </AlertDescription>
                    </Alert>
                  )}

                  {membersWithoutRate.length > 0 && (
                    <Alert>
                      <AlertDescription>
                        У части участников не указана ставка ({membersWithoutRate.length}).
                        Оплаты останутся per-student.
                      </AlertDescription>
                    </Alert>
                  )}

                  {unresolvedGroupMembers.length > 0 && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        Часть участников не найдена в списке учеников ({unresolvedGroupMembers.length}).
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>
          )}

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

          {!isMiniGroupMode && !isNoStudent && (
            <div className="space-y-2">
              <Label>Стоимость занятия, ₽</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={priceText}
                onChange={(e) => { priceTouchedRef.current = true; setPriceText(e.target.value); }}
                placeholder="напр. 1700"
                className="text-base"
              />
              <p className="text-xs text-muted-foreground">
                Спишется с баланса ученика после занятия. 0 — не списывать. Пусто — посчитать из ставки. Применится ко всей серии.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Предмет</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Математика, Физика..."
              className="text-base"
            />
          </div>

          {/* Тема урока (Волна 1): видна на ячейке расписания и ученику во вкладке «Занятия» */}
          <div className="space-y-2">
            <Label>Тема занятия (опц.)</Label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Динамика: второй закон Ньютона..."
              className="text-base"
            />
          </div>

          {/* Recurring — периоды повтора (Волна 1: день / неделя / 2 недели / месяц) */}
          <div className="space-y-3 border-t pt-3">
            <div className="space-y-2">
              <Label>Повторение</Label>
              <Select
                value={recurrence}
                onValueChange={(v) => handleRecurrenceChange(v as RecurrenceChoice)}
                disabled={isSaving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не повторять</SelectItem>
                  {RECURRENCE_RULE_OPTIONS
                    // daily для мини-групп отключён в v1 (см. tutorScheduleGroupCreate).
                    .filter((o) => !(isMiniGroupMode && o.value === 'daily'))
                    .map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
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
                      defaultMonth={repeatUntil}
                      disabled={(d) => d < (date || new Date())}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                {/* Пресеты — «до июня очень долго листать календарь» (репорт репетитора) */}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => applyEndPreset('school_year')}>
                    До конца уч. года
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => applyEndPreset('three_months')}>
                    +3 месяца
                  </Button>
                </div>
                {plannedCount != null && (
                  <p className="text-xs text-muted-foreground">
                    Будет создано ~{plannedCount} занятий ({recurrenceRuleLabel(recurrence as RecurrenceRule).toLowerCase()})
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
          <Button
            onClick={handleSubmit}
            disabled={
              isSaving ||
              (isMiniGroupMode &&
                (
                  isMiniGroupDataLoading ||
                  Boolean(miniGroupDataError) ||
                  !groupId ||
                  miniGroupMembersForCreate.length === 0 ||
                  unresolvedGroupMembers.length > 0
                ))
            }
          >
            {isSaving
              ? (isMiniGroupMode
                  ? (isRecurring ? 'Создаем серию для группы...' : 'Создаем занятие для группы...')
                  : 'Сохранение...')
              : isMiniGroupMode
                ? (isRecurring ? 'Создать серию для группы' : 'Создать занятие')
                : (isRecurring ? 'Создать серию' : 'Создать')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
