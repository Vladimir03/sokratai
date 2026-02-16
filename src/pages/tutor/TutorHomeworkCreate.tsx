import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, ArrowRight, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateHomework, useAssignStudents, useNotifyStudents } from '@/hooks/useTutorHomework';
import { useTutorStudents } from '@/hooks/useTutor';
import type { CreateAssignmentTask, HomeworkSubject } from '@/lib/tutorHomeworkApi';

const SUBJECTS: { value: HomeworkSubject; label: string }[] = [
  { value: 'math', label: 'Математика' },
  { value: 'physics', label: 'Физика' },
  { value: 'history', label: 'История' },
  { value: 'social', label: 'Обществознание' },
  { value: 'english', label: 'Английский' },
  { value: 'cs', label: 'Информатика' },
];

interface DraftTask extends CreateAssignmentTask {
  _key: string;
}

function newTask(): DraftTask {
  return { _key: crypto.randomUUID(), task_text: '', max_score: 1 };
}

// ─── Step 1 ──────────────────────────────────────────────────────────────────

function Step1({
  title, setTitle,
  subject, setSubject,
  topic, setTopic,
  deadline, setDeadline,
}: {
  title: string; setTitle: (v: string) => void;
  subject: HomeworkSubject; setSubject: (v: HomeworkSubject) => void;
  topic: string; setTopic: (v: string) => void;
  deadline: string; setDeadline: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="hw-title">Название *</Label>
        <Input id="hw-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Дроби, вариант 3" className="text-base" />
      </div>
      <div>
        <Label>Предмет *</Label>
        <Select value={subject} onValueChange={(v) => setSubject(v as HomeworkSubject)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUBJECTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="hw-topic">Тема</Label>
        <Input id="hw-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Сложение дробей" className="text-base" />
      </div>
      <div>
        <Label htmlFor="hw-deadline">Дедлайн</Label>
        <Input id="hw-deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="text-base" />
      </div>
    </div>
  );
}

// ─── Step 2 ──────────────────────────────────────────────────────────────────

function Step2({ tasks, setTasks }: { tasks: DraftTask[]; setTasks: (t: DraftTask[]) => void }) {
  const updateTask = (key: string, patch: Partial<DraftTask>) =>
    setTasks(tasks.map((t) => (t._key === key ? { ...t, ...patch } : t)));

  const removeTask = (key: string) => setTasks(tasks.filter((t) => t._key !== key));

  return (
    <div className="space-y-4">
      {tasks.map((task, i) => (
        <Card key={task._key}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Задача {i + 1}</span>
              {tasks.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => removeTask(task._key)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
            <div>
              <Label>Условие *</Label>
              <Input
                value={task.task_text}
                onChange={(e) => updateTask(task._key, { task_text: e.target.value })}
                placeholder="Найдите значение выражения…"
                className="text-base"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Правильный ответ</Label>
                <Input
                  value={task.correct_answer ?? ''}
                  onChange={(e) => updateTask(task._key, { correct_answer: e.target.value })}
                  className="text-base"
                />
              </div>
              <div>
                <Label>Макс. балл</Label>
                <Input
                  type="number"
                  min={1}
                  value={task.max_score ?? 1}
                  onChange={(e) => updateTask(task._key, { max_score: Number(e.target.value) || 1 })}
                  className="text-base"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" className="w-full gap-2" onClick={() => setTasks([...tasks, newTask()])}>
        <Plus className="h-4 w-4" /> Добавить задачу
      </Button>
    </div>
  );
}

// ─── Step 3 ──────────────────────────────────────────────────────────────────

function Step3({
  selectedIds, setSelectedIds,
}: {
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
}) {
  const { students, loading } = useTutorStudents();
  const activeStudents = (students ?? []).filter((s) => s.status === 'active');

  const toggle = (id: string) =>
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  const toggleAll = () =>
    setSelectedIds(selectedIds.length === activeStudents.length ? [] : activeStudents.map((s) => s.student_id));

  if (loading) return <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;

  if (activeStudents.length === 0) return <p className="text-muted-foreground text-sm">Нет активных учеников. Добавьте учеников в разделе «Ученики».</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox checked={selectedIds.length === activeStudents.length} onCheckedChange={toggleAll} id="select-all" />
        <Label htmlFor="select-all">Выбрать всех ({activeStudents.length})</Label>
      </div>
      {activeStudents.map((s) => {
        const profile = s.profiles as { username?: string } | null;
        const name = profile?.username ?? 'Ученик';
        return (
          <div key={s.id} className="flex items-center gap-2">
            <Checkbox checked={selectedIds.includes(s.student_id)} onCheckedChange={() => toggle(s.student_id)} id={`s-${s.id}`} />
            <Label htmlFor={`s-${s.id}`}>{name}</Label>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main wizard ─────────────────────────────────────────────────────────────

function TutorHomeworkCreateContent() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState<HomeworkSubject>('math');
  const [topic, setTopic] = useState('');
  const [deadline, setDeadline] = useState('');

  // Step 2
  const [tasks, setTasks] = useState<DraftTask[]>([newTask()]);

  // Step 3
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

  const createMutation = useCreateHomework();
  const assignMutation = useAssignStudents();
  const notifyMutation = useNotifyStudents();

  const isSubmitting = createMutation.isPending || assignMutation.isPending || notifyMutation.isPending;

  const canNext = useCallback(() => {
    if (step === 1) return title.trim().length > 0;
    if (step === 2) return tasks.length > 0 && tasks.every((t) => t.task_text.trim().length > 0);
    return true;
  }, [step, title, tasks]);

  const handleSubmit = async () => {
    try {
      const payload = {
        title: title.trim(),
        subject,
        topic: topic.trim() || undefined,
        deadline: deadline ? new Date(deadline).toISOString() : undefined,
        tasks: tasks.map((t, i) => ({
          order_num: i + 1,
          task_text: t.task_text.trim(),
          correct_answer: t.correct_answer?.trim() || undefined,
          max_score: t.max_score ?? 1,
        })),
      };

      const { assignment_id } = await createMutation.mutateAsync(payload);

      if (selectedStudentIds.length > 0) {
        await assignMutation.mutateAsync({ assignmentId: assignment_id, studentIds: selectedStudentIds });
        try {
          await notifyMutation.mutateAsync({ assignmentId: assignment_id });
        } catch {
          // notifications are best-effort
        }
      }

      toast.success('ДЗ создано!');
      navigate('/tutor/homework');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка при создании ДЗ');
    }
  };

  const STEP_TITLES = ['Основные данные', 'Задания', 'Назначить ученикам'];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" className="gap-2" onClick={() => step > 1 ? setStep(step - 1) : navigate('/tutor/homework')}>
        <ArrowLeft className="h-4 w-4" />
        {step > 1 ? 'Назад' : 'К списку ДЗ'}
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{STEP_TITLES[step - 1]}</span>
            <span className="text-sm text-muted-foreground font-normal">Шаг {step} из 3</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === 1 && <Step1 {...{ title, setTitle, subject, setSubject, topic, setTopic, deadline, setDeadline }} />}
          {step === 2 && <Step2 tasks={tasks} setTasks={setTasks} />}
          {step === 3 && <Step3 selectedIds={selectedStudentIds} setSelectedIds={setSelectedStudentIds} />}

          <div className="mt-6 flex justify-end gap-3">
            {step < 3 && (
              <Button disabled={!canNext()} onClick={() => setStep(step + 1)} className="gap-2">
                Далее <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === 3 && (
              <Button disabled={isSubmitting} onClick={handleSubmit} className="gap-2">
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Создать ДЗ
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TutorHomeworkCreate() {
  return (
    <TutorGuard>
      <TutorLayout>
        <TutorHomeworkCreateContent />
      </TutorLayout>
    </TutorGuard>
  );
}
