import { useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Upload,
  Loader2,
  Dices,
  Image as ImageIcon,
  X,
  Check,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorStudents } from '@/hooks/useTutor';
import {
  createTutorHomeworkAssignment,
  assignTutorHomeworkStudents,
  notifyTutorHomeworkStudents,
  uploadTutorHomeworkTaskImage,
  deleteTutorHomeworkTaskImage,
  type HomeworkSubject,
  type CreateAssignmentTask,
} from '@/lib/tutorHomeworkApi';

// ─── Constants ───────────────────────────────────────────────────────────────

const SUBJECTS: { value: HomeworkSubject; label: string }[] = [
  { value: 'math', label: 'Математика' },
  { value: 'physics', label: 'Физика' },
  { value: 'history', label: 'История' },
  { value: 'social', label: 'Обществознание' },
  { value: 'english', label: 'Английский' },
  { value: 'cs', label: 'Информатика' },
];

type SubmitPhase = 'idle' | 'creating' | 'assigning' | 'notifying' | 'done';

// ─── Draft task type ─────────────────────────────────────────────────────────

interface DraftTask {
  localId: string;
  task_text: string;
  task_image_path: string | null;
  correct_answer: string;
  solution_steps: string;
  max_score: number;
  uploading: boolean;
}

function createEmptyTask(): DraftTask {
  return {
    localId: crypto.randomUUID(),
    task_text: '',
    task_image_path: null,
    correct_answer: '',
    solution_steps: '',
    max_score: 1,
    uploading: false,
  };
}

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isDone = step < current;
        return (
          <div key={step} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-px w-6 sm:w-10 ${
                  isDone ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              />
            )}
            <div
              className={`flex items-center justify-center h-8 w-8 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isDone
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {isDone ? <Check className="h-4 w-4" /> : step}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Metadata ────────────────────────────────────────────────────────

interface MetaState {
  title: string;
  subject: HomeworkSubject | '';
  topic: string;
  deadline: string;
}

function StepMeta({
  meta,
  onChange,
  errors,
}: {
  meta: MetaState;
  onChange: (m: MetaState) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="hw-title">Название *</Label>
        <Input
          id="hw-title"
          placeholder="Квадратные уравнения"
          value={meta.title}
          onChange={(e) => onChange({ ...meta, title: e.target.value })}
          className="text-base"
        />
        {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
      </div>

      <div className="space-y-2">
        <Label>Предмет *</Label>
        <Select
          value={meta.subject}
          onValueChange={(v) => onChange({ ...meta, subject: v as HomeworkSubject })}
        >
          <SelectTrigger className="text-base">
            <SelectValue placeholder="Выберите предмет" />
          </SelectTrigger>
          <SelectContent>
            {SUBJECTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.subject && <p className="text-sm text-destructive">{errors.subject}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="hw-topic">Тема (необязательно)</Label>
        <Input
          id="hw-topic"
          placeholder="Алгебра, глава 5"
          value={meta.topic}
          onChange={(e) => onChange({ ...meta, topic: e.target.value })}
          className="text-base"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="hw-deadline">Дедлайн (необязательно)</Label>
        <Input
          id="hw-deadline"
          type="datetime-local"
          value={meta.deadline}
          onChange={(e) => onChange({ ...meta, deadline: e.target.value })}
          className="text-base"
        />
      </div>
    </div>
  );
}

// ─── Step 2: Tasks ───────────────────────────────────────────────────────────

function TaskEditor({
  task,
  index,
  onUpdate,
  onRemove,
  canRemove,
}: {
  task: DraftTask;
  index: number;
  onUpdate: (t: DraftTask) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        toast.error('Файл слишком большой (максимум 10 МБ)');
        return;
      }
      onUpdate({ ...task, uploading: true });
      try {
        const { objectPath } = await uploadTutorHomeworkTaskImage(file);
        onUpdate({ ...task, task_image_path: objectPath, uploading: false });
        toast.success('Изображение загружено');
      } catch (err) {
        onUpdate({ ...task, uploading: false });
        toast.error(
          `Ошибка загрузки: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        );
      }
      if (fileRef.current) fileRef.current.value = '';
    },
    [task, onUpdate],
  );

  const handleImageRemove = useCallback(() => {
    if (task.task_image_path) {
      void deleteTutorHomeworkTaskImage(task.task_image_path);
    }
    onUpdate({ ...task, task_image_path: null });
  }, [task, onUpdate]);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Задача {index + 1}
          </span>
          {canRemove && (
            <Button variant="ghost" size="sm" onClick={onRemove}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label>Текст задачи *</Label>
          <textarea
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-y"
            placeholder="Решите уравнение x² - 5x + 6 = 0"
            value={task.task_text}
            onChange={(e) => onUpdate({ ...task, task_text: e.target.value })}
          />
        </div>

        {/* Image upload */}
        <div className="space-y-2">
          <Label>Изображение</Label>
          {task.task_image_path ? (
            <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
              <ImageIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate flex-1">{task.task_image_path.split('/').pop()}</span>
              <Button variant="ghost" size="sm" onClick={handleImageRemove}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
                disabled={task.uploading}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={task.uploading}
                className="gap-2"
              >
                {task.uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {task.uploading ? 'Загрузка...' : 'Загрузить фото'}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Правильный ответ</Label>
            <Input
              placeholder="x=2, x=3"
              value={task.correct_answer}
              onChange={(e) =>
                onUpdate({ ...task, correct_answer: e.target.value })
              }
              className="text-base"
            />
          </div>
          <div className="space-y-2">
            <Label>Макс. баллов</Label>
            <Input
              type="number"
              min={1}
              value={task.max_score}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onUpdate({ ...task, max_score: isNaN(v) || v < 1 ? 1 : v });
              }}
              className="text-base"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Шаги решения</Label>
          <textarea
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[60px] resize-y"
            placeholder="D = 25 - 24 = 1; x = (5±1)/2"
            value={task.solution_steps}
            onChange={(e) =>
              onUpdate({ ...task, solution_steps: e.target.value })
            }
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => toast.info('Генерация вариаций — скоро будет!')}
        >
          <Dices className="h-4 w-4" />
          Вариации
        </Button>
      </CardContent>
    </Card>
  );
}

function StepTasks({
  tasks,
  onChange,
  errors,
}: {
  tasks: DraftTask[];
  onChange: (t: DraftTask[]) => void;
  errors: Record<string, string>;
}) {
  const handleAdd = useCallback(() => {
    onChange([...tasks, createEmptyTask()]);
  }, [tasks, onChange]);

  const handleUpdate = useCallback(
    (idx: number, updated: DraftTask) => {
      const next = [...tasks];
      next[idx] = updated;
      onChange(next);
    },
    [tasks, onChange],
  );

  const handleRemove = useCallback(
    (idx: number) => {
      const removed = tasks[idx];
      if (removed.task_image_path) {
        void deleteTutorHomeworkTaskImage(removed.task_image_path);
      }
      onChange(tasks.filter((_, i) => i !== idx));
    },
    [tasks, onChange],
  );

  return (
    <div className="space-y-4">
      {errors._tasks && (
        <p className="text-sm text-destructive">{errors._tasks}</p>
      )}
      {tasks.map((task, i) => (
        <TaskEditor
          key={task.localId}
          task={task}
          index={i}
          onUpdate={(t) => handleUpdate(i, t)}
          onRemove={() => handleRemove(i)}
          canRemove={tasks.length > 1}
        />
      ))}
      <Button variant="outline" onClick={handleAdd} className="gap-2 w-full">
        <Plus className="h-4 w-4" />
        Добавить задачу
      </Button>
    </div>
  );
}

// ─── Step 3: Assign + Notify ─────────────────────────────────────────────────

function StepAssign({
  selectedIds,
  onChangeSelected,
  notifyEnabled,
  onNotifyChange,
  notifyTemplate,
  onTemplateChange,
  errors,
}: {
  selectedIds: Set<string>;
  onChangeSelected: (s: Set<string>) => void;
  notifyEnabled: boolean;
  onNotifyChange: (v: boolean) => void;
  notifyTemplate: string;
  onTemplateChange: (v: string) => void;
  errors: Record<string, string>;
}) {
  const {
    students,
    loading,
    error,
    refetch,
    isFetching,
    isRecovering,
    failureCount,
  } = useTutorStudents();

  const handleToggle = useCallback(
    (studentId: string) => {
      const next = new Set(selectedIds);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      onChangeSelected(next);
    },
    [selectedIds, onChangeSelected],
  );

  const handleSelectAll = useCallback(() => {
    onChangeSelected(new Set(students.map((s) => s.student_id)));
  }, [students, onChangeSelected]);

  const handleDeselectAll = useCallback(() => {
    onChangeSelected(new Set());
  }, [onChangeSelected]);

  return (
    <div className="space-y-6">
      {/* Student list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base">Ученики</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSelectAll}>
              Выбрать всех
            </Button>
            <Button variant="outline" size="sm" onClick={handleDeselectAll}>
              Снять всех
            </Button>
          </div>
        </div>

        {errors._students && (
          <p className="text-sm text-destructive">{errors._students}</p>
        )}

        <TutorDataStatus
          error={error}
          isFetching={isFetching}
          isRecovering={isRecovering}
          failureCount={failureCount}
          onRetry={refetch}
        />

        {loading && !students.length ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <Card className="bg-muted/30">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                У вас пока нет учеников.{' '}
                <Link to="/tutor/students" className="text-primary underline">
                  Добавить ученика
                </Link>
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1 max-h-[360px] overflow-y-auto rounded-md border p-1">
            {students.map((s) => {
              const checked = selectedIds.has(s.student_id);
              const name = s.profiles?.username || 'Без имени';
              const statusLabel =
                s.status === 'active'
                  ? null
                  : s.status === 'paused'
                  ? 'На паузе'
                  : 'Завершён';
              return (
                <label
                  key={s.student_id}
                  className="flex items-center gap-3 p-2.5 rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => handleToggle(s.student_id)}
                  />
                  <span className="text-sm font-medium flex-1">{name}</span>
                  {s.profiles?.telegram_username && (
                    <span className="text-xs text-muted-foreground">
                      @{s.profiles.telegram_username}
                    </span>
                  )}
                  {statusLabel && (
                    <Badge variant="secondary" className="text-xs">
                      {statusLabel}
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Выбрано: {selectedIds.size} из {students.length}
        </p>
      </div>

      {/* Notify toggle */}
      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="notify-toggle" className="text-base cursor-pointer">
            Отправить уведомления в Telegram
          </Label>
          <Switch
            id="notify-toggle"
            checked={notifyEnabled}
            onCheckedChange={onNotifyChange}
          />
        </div>
        {notifyEnabled && (
          <div className="space-y-2">
            <Label htmlFor="notify-template" className="text-sm text-muted-foreground">
              Текст сообщения (необязательно, по умолчанию стандартный)
            </Label>
            <textarea
              id="notify-template"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[60px] resize-y"
              placeholder="Новая домашка! Используй /homework чтобы начать."
              value={notifyTemplate}
              onChange={(e) => onTemplateChange(e.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Wizard Content ─────────────────────────────────────────────────────

function TutorHomeworkCreateContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);

  // Step 1
  const [meta, setMeta] = useState<MetaState>({
    title: '',
    subject: '',
    topic: '',
    deadline: '',
  });

  // Step 2
  const [tasks, setTasks] = useState<DraftTask[]>([createEmptyTask()]);

  // Step 3
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
    new Set(),
  );
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyTemplate, setNotifyTemplate] = useState('');

  // Submit state
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('idle');
  const createdAssignmentIdRef = useRef<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Validation ──

  const validateStep1 = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!meta.title.trim()) errs.title = 'Введите название';
    if (!meta.subject) errs.subject = 'Выберите предмет';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [meta]);

  const validateStep2 = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (tasks.length === 0) {
      errs._tasks = 'Добавьте хотя бы одну задачу';
    }
    for (let i = 0; i < tasks.length; i++) {
      if (!tasks[i].task_text.trim()) {
        errs._tasks = `Задача ${i + 1}: введите текст задачи`;
        break;
      }
      if (tasks[i].max_score < 1) {
        errs._tasks = `Задача ${i + 1}: баллы должны быть >= 1`;
        break;
      }
      if (tasks[i].uploading) {
        errs._tasks = `Задача ${i + 1}: дождитесь загрузки изображения`;
        break;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [tasks]);

  const validateStep3 = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (selectedStudentIds.size === 0) {
      errs._students = 'Выберите хотя бы одного ученика';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [selectedStudentIds]);

  // ── Navigation ──

  const handleNext = useCallback(() => {
    if (step === 1 && validateStep1()) {
      setErrors({});
      setStep(2);
    } else if (step === 2 && validateStep2()) {
      setErrors({});
      setStep(3);
    }
  }, [step, validateStep1, validateStep2]);

  const handleBack = useCallback(() => {
    setErrors({});
    if (step > 1) setStep(step - 1);
  }, [step]);

  // ── Submit ──

  const handleSubmit = useCallback(async () => {
    if (!validateStep3()) return;

    const isRetry = createdAssignmentIdRef.current !== null;
    let assignmentId = createdAssignmentIdRef.current;

    try {
      // Phase 1: create (skip if already created)
      if (!assignmentId) {
        setSubmitPhase('creating');
        const apiTasks: CreateAssignmentTask[] = tasks.map((t, i) => ({
          order_num: i + 1,
          task_text: t.task_text.trim(),
          task_image_url: t.task_image_path || null,
          correct_answer: t.correct_answer.trim() || null,
          solution_steps: t.solution_steps.trim() || null,
          max_score: t.max_score,
        }));

        const result = await createTutorHomeworkAssignment({
          title: meta.title.trim(),
          subject: meta.subject as HomeworkSubject,
          topic: meta.topic.trim() || null,
          deadline: meta.deadline
            ? new Date(meta.deadline).toISOString()
            : null,
          tasks: apiTasks,
        });
        assignmentId = result.assignment_id;
        createdAssignmentIdRef.current = assignmentId;
      }

      // Phase 2: assign
      setSubmitPhase('assigning');
      const assignResult = await assignTutorHomeworkStudents(
        assignmentId,
        [...selectedStudentIds],
      );

      // Phase 3: notify (optional)
      let notifyResult: { sent: number; failed: number } | null = null;
      if (notifyEnabled) {
        setSubmitPhase('notifying');
        try {
          notifyResult = await notifyTutorHomeworkStudents(
            assignmentId,
            notifyTemplate.trim() || undefined,
          );
        } catch (notifyErr) {
          console.warn('homework_notify_error', notifyErr);
          notifyResult = { sent: 0, failed: selectedStudentIds.size };
        }
      }

      // Done
      setSubmitPhase('done');

      void queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'assignments'],
      });

      // Build toast message
      const parts: string[] = [`ДЗ создано, назначено ${assignResult.added} ученикам`];
      if (notifyResult) {
        if (notifyResult.failed > 0 && notifyResult.sent > 0) {
          parts.push(
            `Уведомления: ${notifyResult.sent} отправлено, ${notifyResult.failed} не удалось`,
          );
        } else if (notifyResult.failed > 0 && notifyResult.sent === 0) {
          parts.push('Не удалось отправить уведомления');
        } else {
          parts.push(`Уведомления отправлены (${notifyResult.sent})`);
        }
      }
      toast.success(parts.join('. '));
      navigate('/tutor/homework');
    } catch (err) {
      setSubmitPhase('idle');
      const message =
        err instanceof Error ? err.message : 'Неизвестная ошибка';
      toast.error(`Ошибка: ${message}`);
      if (isRetry) {
        toast.info('Можно попробовать ещё раз — ДЗ уже создано, повторим назначение.');
      }
    }
  }, [
    validateStep3,
    tasks,
    meta,
    selectedStudentIds,
    notifyEnabled,
    notifyTemplate,
    navigate,
    queryClient,
  ]);

  const isSubmitting = submitPhase !== 'idle' && submitPhase !== 'done';

  const submitLabel = (() => {
    switch (submitPhase) {
      case 'creating':
        return 'Создаём ДЗ...';
      case 'assigning':
        return 'Назначаем учеников...';
      case 'notifying':
        return 'Отправляем уведомления...';
      default:
        return notifyEnabled ? 'Создать и уведомить' : 'Создать ДЗ';
    }
  })();

  return (
    <TutorLayout>
      <div className="space-y-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/tutor/homework">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Назад
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Создание ДЗ</h1>
        </div>

        {/* Step indicator */}
        <div className="flex justify-center">
          <StepIndicator current={step} total={3} />
        </div>

        {/* Step content */}
        <div className="min-h-[300px]">
          {step === 1 && (
            <StepMeta meta={meta} onChange={setMeta} errors={errors} />
          )}
          {step === 2 && (
            <StepTasks tasks={tasks} onChange={setTasks} errors={errors} />
          )}
          {step === 3 && (
            <StepAssign
              selectedIds={selectedStudentIds}
              onChangeSelected={setSelectedStudentIds}
              notifyEnabled={notifyEnabled}
              onNotifyChange={setNotifyEnabled}
              notifyTemplate={notifyTemplate}
              onTemplateChange={setNotifyTemplate}
              errors={errors}
            />
          )}
        </div>

        {/* Navigation footer */}
        <div className="flex items-center justify-between border-t pt-4 sticky bottom-0 bg-background pb-4 md:pb-0 md:relative z-10">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={step === 1 || isSubmitting}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Button>

          {step < 3 ? (
            <Button onClick={handleNext} className="gap-2">
              Далее
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="gap-2"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {!isSubmitting && (notifyEnabled ? <Send className="h-4 w-4" /> : <Check className="h-4 w-4" />)}
              {submitLabel}
            </Button>
          )}
        </div>
      </div>
    </TutorLayout>
  );
}

// ─── Export with guard ───────────────────────────────────────────────────────

export default function TutorHomeworkCreate() {
  return (
    <TutorGuard>
      <TutorHomeworkCreateContent />
    </TutorGuard>
  );
}
