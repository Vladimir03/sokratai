import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
  Search,
  X,
  Check,
  Send,
  Library,
  ChevronDown,
  ChevronUp,
  Paperclip,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorStudents, useTutorGroups, useTutorGroupMemberships } from '@/hooks/useTutor';
import { useTutorHomeworkTemplates } from '@/hooks/useTutorHomework';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  createTutorHomeworkAssignment,
  assignTutorHomeworkStudents,
  notifyTutorHomeworkStudents,
  uploadTutorHomeworkTaskImage,
  deleteTutorHomeworkTaskImage,
  uploadTutorHomeworkMaterial,
  addTutorHomeworkMaterial,
  getTutorHomeworkTemplate,
  createTutorHomeworkTemplate,
  parseStorageRef,
  HomeworkApiError,
  type HomeworkSubject,
  type CreateAssignmentTask,
  type StudentsTelegramNotConnectedDetails,
  type HomeworkTemplateListItem,
  type MaterialType,
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

type SubmitPhase = 'idle' | 'creating' | 'adding_materials' | 'assigning' | 'notifying' | 'done';
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const IMAGE_REQUIREMENTS_HINT = 'Форматы: JPG, PNG, WEBP, GIF. Размер до 10 МБ.';

// ─── Draft task type ─────────────────────────────────────────────────────────

interface DraftTask {
  localId: string;
  task_text: string;
  task_image_path: string | null;
  task_image_name: string | null;
  task_image_preview_url: string | null;
  task_image_used_fallback: boolean;
  correct_answer: string;
  solution_steps: string;
  rubric_text: string;
  max_score: number;
  uploading: boolean;
}

function createEmptyTask(): DraftTask {
  return {
    localId: crypto.randomUUID(),
    task_text: '',
    task_image_path: null,
    task_image_name: null,
    task_image_preview_url: null,
    task_image_used_fallback: false,
    correct_answer: '',
    solution_steps: '',
    rubric_text: '',
    max_score: 1,
    uploading: false,
  };
}

// ─── Draft material type ──────────────────────────────────────────────────────

interface DraftMaterial {
  localId: string;
  type: MaterialType;
  title: string;
  file: File | null;
  url: string;
  uploading: boolean;
}

function createEmptyMaterial(): DraftMaterial {
  return {
    localId: crypto.randomUUID(),
    type: 'link',
    title: '',
    file: null,
    url: '',
    uploading: false,
  };
}

function revokeObjectUrl(url: string | null | undefined) {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
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

// ─── Rubric field (collapsible) ───────────────────────────────────────────────

function RubricField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(Boolean(value));
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Критерии проверки
      </button>
      {open && (
        <textarea
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-y"
          placeholder="Полное решение: 2 балла, только ответ: 1 балл, ошибка в знаке: минус 1 балл..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

// ─── Template picker (sheet) ──────────────────────────────────────────────────

const SUBJECT_LABELS_MAP: Record<string, string> = {
  math: 'Математика', physics: 'Физика', history: 'История',
  social: 'Обществознание', english: 'Английский', cs: 'Информатика',
};

function TemplatePickerSheet({
  onSelect,
}: {
  onSelect: (template: HomeworkTemplateListItem) => void;
}) {
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const { templates, loading } = useTutorHomeworkTemplates(
    filterSubject !== 'all' ? (filterSubject as HomeworkSubject) : undefined,
  );
  const [open, setOpen] = useState(false);

  const handlePick = useCallback(
    (tpl: HomeworkTemplateListItem) => {
      onSelect(tpl);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Library className="h-4 w-4" />
          Из шаблона
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Шаблоны домашних заданий</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-1">
            {['all', 'math', 'physics', 'history', 'social', 'english', 'cs'].map((s) => (
              <button
                key={s}
                onClick={() => setFilterSubject(s)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  filterSubject === s
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-muted-foreground/30 text-muted-foreground hover:border-primary/50'
                }`}
              >
                {s === 'all' ? 'Все' : (SUBJECT_LABELS_MAP[s] ?? s)}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Нет шаблонов. Создайте ДЗ и сохраните как шаблон.
            </p>
          ) : (
            <div className="space-y-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => handlePick(tpl)}
                  className="w-full text-left p-3 rounded-md border hover:bg-muted/50 transition-colors space-y-1"
                >
                  <p className="text-sm font-medium">{tpl.title}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{SUBJECT_LABELS_MAP[tpl.subject] ?? tpl.subject}</span>
                    {tpl.topic && <span>· {tpl.topic}</span>}
                    {tpl.task_count != null && <span>· {tpl.task_count} задач</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Materials section ────────────────────────────────────────────────────────

function MaterialsSection({
  materials,
  onChange,
}: {
  materials: DraftMaterial[];
  onChange: (m: DraftMaterial[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleAddLink = useCallback(() => {
    onChange([...materials, { ...createEmptyMaterial(), type: 'link' }]);
    setOpen(true);
  }, [materials, onChange]);

  const handleAddFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === 'application/pdf';
    const type: MaterialType = isPdf ? 'pdf' : 'image';
    onChange([...materials, { ...createEmptyMaterial(), type, file, title: file.name }]);
    setOpen(true);
    if (fileRef.current) fileRef.current.value = '';
  }, [materials, onChange]);

  const handleUpdate = useCallback((idx: number, updated: DraftMaterial) => {
    const next = [...materials];
    next[idx] = updated;
    onChange(next);
  }, [materials, onChange]);

  const handleRemove = useCallback((idx: number) => {
    onChange(materials.filter((_, i) => i !== idx));
  }, [materials, onChange]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <Paperclip className="h-4 w-4" />
        Материалы{materials.length > 0 ? ` (${materials.length})` : ''}
      </button>
      {open && (
        <div className="space-y-3 pl-2 border-l-2 border-muted">
          {materials.map((mat, idx) => (
            <div key={mat.localId} className="flex items-start gap-2 p-2 border rounded-md bg-muted/30">
              <div className="flex-1 space-y-2 min-w-0">
                <Input
                  placeholder="Название (например: Конспект урока)"
                  value={mat.title}
                  onChange={(e) => handleUpdate(idx, { ...mat, title: e.target.value })}
                  className="text-sm"
                />
                {mat.type === 'link' && (
                  <Input
                    placeholder="https://..."
                    value={mat.url}
                    onChange={(e) => handleUpdate(idx, { ...mat, url: e.target.value })}
                    className="text-sm"
                  />
                )}
                {mat.type !== 'link' && mat.file && (
                  <p className="text-xs text-muted-foreground truncate">{mat.file.name}</p>
                )}
                <span className="text-xs text-muted-foreground uppercase">{mat.type}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleRemove(idx)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={handleAddLink}>
              <ExternalLink className="h-3.5 w-3.5" />
              Ссылка
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Файл
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleAddFile}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 1: Metadata ────────────────────────────────────────────────────────

interface MetaState {
  title: string;
  subject: HomeworkSubject | "";
  topic: string;
  deadline: string;
  max_attempts: number;
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

      <div className="space-y-2">
        <Label htmlFor="hw-max-attempts">Максимум попыток</Label>
        <Input
          id="hw-max-attempts"
          type="number"
          min={1}
          max={10}
          value={meta.max_attempts}
          onChange={(e) =>
            onChange({
              ...meta,
              max_attempts: Math.min(10, Math.max(1, Number(e.target.value || 3))),
            })
          }
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
  const parsedRef = parseStorageRef(task.task_image_path);
  const imageName =
    task.task_image_name ||
    parsedRef?.objectPath.split('/').pop() ||
    'uploaded-image.jpg';

  const processTaskImageFile = useCallback(
    async (file: File, previousImagePath: string | null) => {
      if (task.uploading) {
        toast.warning('Дождись завершения текущей загрузки.');
        return;
      }

      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        toast.error('Файл слишком большой (максимум 10 МБ)');
        return;
      }

      const displayFileName = file.name || 'pasted-image.jpg';
      const previewUrl = URL.createObjectURL(file);

      onUpdate({ ...task, uploading: true });
      try {
        const uploadResult = await uploadTutorHomeworkTaskImage(file);
        revokeObjectUrl(task.task_image_preview_url);

        onUpdate({
          ...task,
          task_image_path: uploadResult.storageRef,
          task_image_name: displayFileName,
          task_image_preview_url: previewUrl,
          task_image_used_fallback: uploadResult.usedFallback,
          uploading: false,
        });

        if (previousImagePath && previousImagePath !== uploadResult.storageRef) {
          void deleteTutorHomeworkTaskImage(previousImagePath);
        }

        toast.success('Изображение загружено');
        if (uploadResult.usedFallback) {
          toast.warning('Основной bucket недоступен, использован резервный канал загрузки.');
        }
      } catch (err) {
        revokeObjectUrl(previewUrl);
        onUpdate({ ...task, uploading: false });
        toast.error(
          `Ошибка загрузки: ${err instanceof Error ? err.message : 'неизвестная ошибка'}. Попробуйте ещё раз.`,
        );
      }
    },
    [task, onUpdate],
  );

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      await processTaskImageFile(file, null);

      if (fileRef.current) fileRef.current.value = '';
    },
    [processTaskImageFile],
  );

  const handleTaskTextPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items?.length) return;

      let pastedImage: File | null = null;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          pastedImage = item.getAsFile();
          if (pastedImage) break;
        }
      }

      if (!pastedImage) return;

      e.preventDefault();

      if (task.uploading) {
        toast.warning('Дождись завершения текущей загрузки.');
        return;
      }

      const previousImagePath = task.task_image_path;
      if (previousImagePath) {
        const confirmed = window.confirm(
          'У задачи уже есть фото. Заменить его новым скриншотом?',
        );
        if (!confirmed) return;
      }

      void processTaskImageFile(pastedImage, previousImagePath);
    },
    [task.uploading, task.task_image_path, processTaskImageFile],
  );

  const handleImageRemove = useCallback(() => {
    if (task.task_image_path) {
      void deleteTutorHomeworkTaskImage(task.task_image_path);
    }
    revokeObjectUrl(task.task_image_preview_url);
    onUpdate({
      ...task,
      task_image_path: null,
      task_image_name: null,
      task_image_preview_url: null,
      task_image_used_fallback: false,
    });
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
            placeholder="Напиши свой вопрос или вставь скриншот (Ctrl+V)..."
            value={task.task_text}
            onChange={(e) => onUpdate({ ...task, task_text: e.target.value })}
            onPaste={handleTaskTextPaste}
          />
        </div>

        {/* Image upload */}
        <div className="space-y-2">
          <Label>Изображение</Label>
          {task.task_image_path ? (
            <div className="p-2 border rounded-md bg-muted/50 space-y-2">
              <div className="flex items-center gap-2">
                {task.task_image_preview_url ? (
                  <img
                    src={task.task_image_preview_url}
                    alt="Превью задачи"
                    className="h-12 w-12 rounded border object-cover bg-background"
                  />
                ) : (
                  <div className="h-12 w-12 rounded border bg-background flex items-center justify-center">
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{imageName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {task.task_image_path}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={handleImageRemove}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {task.task_image_used_fallback && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Изображение загружено через резервный bucket.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
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
              <p className="text-xs text-muted-foreground">{IMAGE_REQUIREMENTS_HINT}</p>
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

        <RubricField
          value={task.rubric_text}
          onChange={(v) => onUpdate({ ...task, rubric_text: v })}
        />

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
  materials,
  onMaterialsChange,
  errors,
}: {
  tasks: DraftTask[];
  onChange: (t: DraftTask[]) => void;
  materials: DraftMaterial[];
  onMaterialsChange: (m: DraftMaterial[]) => void;
  errors: Record<string, string>;
  assignMode: 'student' | 'group';
  onAssignModeChange: (mode: 'student' | 'group') => void;
  selectedGroupId: string;
  onGroupIdChange: (groupId: string) => void;
  groups: Array<{ id: string; name: string }>;
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
      revokeObjectUrl(removed.task_image_preview_url);
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
      <div className="border-t pt-3">
        <MaterialsSection materials={materials} onChange={onMaterialsChange} />
      </div>
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
  assignMode,
  onAssignModeChange,
  selectedGroupId,
  onGroupIdChange,
  groups,
}: {
  selectedIds: Set<string>;
  onChangeSelected: (s: Set<string>) => void;
  notifyEnabled: boolean;
  onNotifyChange: (v: boolean) => void;
  notifyTemplate: string;
  onTemplateChange: (v: string) => void;
  errors: Record<string, string>;
  assignMode: 'student' | 'group';
  onAssignModeChange: (mode: 'student' | 'group') => void;
  selectedGroupId: string;
  onGroupIdChange: (groupId: string) => void;
  groups: Array<{ id: string; name: string }>;
}) {
  const [searchQuery, setSearchQuery] = useState('');
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

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => {
      const name = (s.profiles?.username ?? '').toLowerCase();
      const tg = (s.profiles?.telegram_username ?? '').toLowerCase();
      return name.includes(q) || tg.includes(q);
    });
  }, [students, searchQuery]);

  const selectedWithoutTelegram = useMemo(
    () =>
      students.filter(
        (s) => selectedIds.has(s.student_id) && !s.profiles?.telegram_user_id,
      ).length,
    [students, selectedIds],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Кому назначить</Label>
        <div className="flex gap-2">
          <Button type="button" variant={assignMode === 'student' ? 'default' : 'outline'} size="sm" onClick={() => onAssignModeChange('student')}>Ученик</Button>
          <Button type="button" variant={assignMode === 'group' ? 'default' : 'outline'} size="sm" onClick={() => onAssignModeChange('group')}>Группа</Button>
        </div>
        {assignMode === 'group' && (
          <Select value={selectedGroupId || undefined} onValueChange={onGroupIdChange}>
            <SelectTrigger><SelectValue placeholder="Выберите группу" /></SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

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

        {!loading && students.length > 0 && (
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск по имени или @username"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-base"
            />
          </div>
        )}

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
        ) : filteredStudents.length === 0 ? (
          <Card className="bg-muted/30">
            <CardContent className="py-6 text-center">
              <p className="text-sm text-muted-foreground">
                По запросу ничего не найдено.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1 max-h-[360px] overflow-y-auto rounded-md border p-1">
            {filteredStudents.map((s) => {
              const checked = selectedIds.has(s.student_id);
              const name = s.profiles?.username || 'Без имени';
              const isTelegramConnected = Boolean(s.profiles?.telegram_user_id);
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
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{name}</p>
                    {s.profiles?.telegram_username && (
                      <p className="text-xs text-muted-foreground truncate">
                        @{s.profiles.telegram_username}
                      </p>
                    )}
                  </div>
                  <Badge variant={isTelegramConnected ? 'default' : 'secondary'} className="text-xs">
                    {isTelegramConnected ? 'Telegram подключен' : 'Telegram не подключен'}
                  </Badge>
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
          Выбрано: {selectedIds.size} из {students.length}. Без Telegram: {selectedWithoutTelegram}
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

function SubmitPhaseTracker({
  phase,
  notifyEnabled,
  hasMaterials,
}: {
  phase: SubmitPhase;
  notifyEnabled: boolean;
  hasMaterials: boolean;
}) {
  const phases: Array<{ key: Exclude<SubmitPhase, 'idle' | 'done'>; label: string }> = [
    { key: 'creating', label: 'Создание' },
    ...(hasMaterials ? [{ key: 'adding_materials' as const, label: 'Материалы' }] : []),
    { key: 'assigning', label: 'Назначение' },
    ...(notifyEnabled ? [{ key: 'notifying' as const, label: 'Уведомления' }] : []),
  ];

  const currentIdx = phases.findIndex((p) => p.key === phase);
  const doneByFinalState = phase === 'done';

  return (
    <div className="flex flex-wrap gap-2">
      {phases.map((p, idx) => {
        const isDone = doneByFinalState || (currentIdx > -1 && idx < currentIdx);
        const isCurrent = currentIdx === idx;
        return (
          <Badge
            key={p.key}
            variant={isDone ? 'default' : 'secondary'}
            className={isCurrent ? 'ring-1 ring-primary/50' : ''}
          >
            {p.label}
          </Badge>
        );
      })}
    </div>
  );
}

// ─── Main Wizard Content ─────────────────────────────────────────────────────

function TutorHomeworkCreateContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { students: tutorStudents } = useTutorStudents();
  const { groups } = useTutorGroups(step === 3);
  const { memberships } = useTutorGroupMemberships(step === 3);

  const [step, setStep] = useState(1);
  const [templateLoading, setTemplateLoading] = useState(false);

  // Step 1
  const [meta, setMeta] = useState<MetaState>({
    title: '',
    subject: '',
    topic: '',
    deadline: '',
    max_attempts: 3,
  });

  // Step 2
  const [tasks, setTasks] = useState<DraftTask[]>([createEmptyTask()]);
  const tasksRef = useRef<DraftTask[]>(tasks);
  const [materials, setMaterials] = useState<DraftMaterial[]>([]);

  // Step 3
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
    new Set(),
  );
  const [assignMode, setAssignMode] = useState<'student' | 'group'>('student');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyTemplate, setNotifyTemplate] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  // Submit state
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('idle');
  const createdAssignmentIdRef = useRef<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    if (assignMode !== 'group' || !selectedGroupId) return;

    const memberTutorStudentIds = new Set(
      memberships
        .filter((m) => m.tutor_group_id === selectedGroupId && m.is_active)
        .map((m) => m.tutor_student_id),
    );

    const mappedStudentIds = tutorStudents
      .filter((s) => memberTutorStudentIds.has(s.id))
      .map((s) => s.student_id);

    setSelectedStudentIds(new Set(mappedStudentIds));
  }, [assignMode, selectedGroupId, memberships, tutorStudents]);

  useEffect(
    () => () => {
      for (const task of tasksRef.current) {
        revokeObjectUrl(task.task_image_preview_url);
      }
    },
    [],
  );

  // Auto-load template from ?template_id query param
  const templateId = searchParams.get('template_id');
  const templateLoadedRef = useRef(false);
  useEffect(() => {
    if (!templateId || templateLoadedRef.current) return;
    templateLoadedRef.current = true;
    setTemplateLoading(true);
    getTutorHomeworkTemplate(templateId)
      .then((tpl) => {
        setMeta((m) => ({
          ...m,
          title: tpl.title,
          subject: tpl.subject,
          topic: tpl.topic ?? '',
        }));
        setTasks(
          tpl.tasks_json.map((t) => ({
            ...createEmptyTask(),
            task_text: t.task_text,
            task_image_path: t.task_image_url ?? null,
            correct_answer: t.correct_answer ?? '',
            solution_steps: t.solution_steps ?? '',
            rubric_text: t.rubric_text ?? '',
            max_score: t.max_score ?? 1,
          })),
        );
        toast.success(`Шаблон «${tpl.title}» загружен`);
      })
      .catch(() => toast.error('Не удалось загрузить шаблон'))
      .finally(() => setTemplateLoading(false));
  }, [templateId]);

  // Apply template from picker sheet
  const handleApplyTemplate = useCallback(async (tpl: HomeworkTemplateListItem) => {
    const isDirty =
      meta.title.trim().length > 0 ||
      tasks.some((t) => t.task_text.trim().length > 0);
    if (isDirty && !window.confirm('Заменить текущие данные шаблоном?')) return;

    setTemplateLoading(true);
    try {
      const full = await getTutorHomeworkTemplate(tpl.id);
      setMeta((m) => ({
        ...m,
        title: full.title,
        subject: full.subject,
        topic: full.topic ?? '',
      }));
      setTasks(
        full.tasks_json.map((t) => ({
          ...createEmptyTask(),
          task_text: t.task_text,
          task_image_path: t.task_image_url ?? null,
          correct_answer: t.correct_answer ?? '',
          solution_steps: t.solution_steps ?? '',
          rubric_text: t.rubric_text ?? '',
          max_score: t.max_score ?? 1,
        })),
      );
      toast.success(`Шаблон «${full.title}» применён`);
    } catch {
      toast.error('Не удалось загрузить шаблон');
    } finally {
      setTemplateLoading(false);
    }
  }, [meta.title, tasks]);

  const hasUnsavedChanges = useMemo(() => {
    if (submitPhase === 'done') return false;

    const metaDirty =
      meta.title.trim().length > 0 ||
      meta.subject !== '' ||
      meta.topic.trim().length > 0 ||
      meta.deadline.trim().length > 0;

    const tasksDirty =
      tasks.length !== 1 ||
      tasks.some(
        (task) =>
          task.task_text.trim().length > 0 ||
          task.task_image_path !== null ||
          task.correct_answer.trim().length > 0 ||
          task.solution_steps.trim().length > 0 ||
          task.max_score !== 1,
      );

    const assignDirty =
      selectedStudentIds.size > 0 ||
      notifyEnabled !== true ||
      notifyTemplate.trim().length > 0;

    return metaDirty || tasksDirty || assignDirty;
  }, [meta, tasks, selectedStudentIds, notifyEnabled, notifyTemplate, submitPhase]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

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
    } else {
      const selectedWithoutTelegram = tutorStudents.filter(
        (s) => selectedStudentIds.has(s.student_id) && !s.profiles?.telegram_user_id,
      );
      if (selectedWithoutTelegram.length > 0) {
        const names = selectedWithoutTelegram
          .map((s) => s.profiles?.username || s.profiles?.telegram_username || s.student_id);
        const preview = names.slice(0, 5).join(', ');
        const suffix = names.length > 5 ? '...' : '';
        errs._students =
          `Выбраны ученики без Telegram-связки: ${preview}${suffix}. ` +
          'Попросите ученика нажать /start и повторите.';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [selectedStudentIds, tutorStudents]);

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

  const handleNavigateToList = useCallback(() => {
    if (
      hasUnsavedChanges &&
      !window.confirm('Есть несохранённые изменения. Выйти без сохранения?')
    ) {
      return;
    }
    navigate('/tutor/homework');
  }, [hasUnsavedChanges, navigate]);

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
          rubric_text: t.rubric_text.trim() || null,
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
          max_attempts: meta.max_attempts,
          group_id: assignMode === 'group' && selectedGroupId ? selectedGroupId : null,
        });
        assignmentId = result.assignment_id;
        createdAssignmentIdRef.current = assignmentId;
      }

      // Phase 1.5: add materials
      if (materials.length > 0) {
        setSubmitPhase('adding_materials');
        for (const mat of materials) {
          try {
            let storageRef: string | undefined;
            if (mat.file) {
              const uploaded = await uploadTutorHomeworkMaterial(mat.file);
              storageRef = uploaded.storageRef;
            }
            await addTutorHomeworkMaterial(assignmentId!, {
              type: mat.type,
              title: mat.title.trim() || mat.file?.name || 'Материал',
              storage_ref: storageRef ?? null,
              url: mat.type === 'link' ? (mat.url.trim() || null) : null,
            });
          } catch (matErr) {
            console.warn('homework_material_add_failed', matErr);
            toast.warning(`Не удалось добавить материал «${mat.title}»`);
          }
        }
      }

      // Phase 2: assign
      setSubmitPhase('assigning');
      const assignResult = await assignTutorHomeworkStudents(
        assignmentId,
        [...selectedStudentIds],
        assignMode === 'group' && selectedGroupId ? selectedGroupId : null,
      );

      // Phase 3: notify (optional)
      let notifyResult: {
        sent: number;
        failed: number;
        failed_student_ids: string[];
        failed_by_reason?: Record<string, string>;
      } | null = null;
      if (notifyEnabled) {
        setSubmitPhase('notifying');
        try {
          notifyResult = await notifyTutorHomeworkStudents(
            assignmentId,
            notifyTemplate.trim() || undefined,
          );
        } catch (notifyErr) {
          console.warn('homework_notify_error', notifyErr);
          notifyResult = {
            sent: 0,
            failed: selectedStudentIds.size,
            failed_student_ids: [...selectedStudentIds],
            failed_by_reason: Object.fromEntries(
              [...selectedStudentIds].map((id) => [id, 'telegram_send_error']),
            ),
          };
        }
      }

      // Phase: save as template (optional)
      if (saveAsTemplate) {
        try {
          await createTutorHomeworkTemplate({
            title: meta.title.trim(),
            subject: meta.subject as HomeworkSubject,
            topic: meta.topic.trim() || null,
            tasks_json: tasks.map((t) => ({
              task_text: t.task_text.trim(),
              task_image_url: t.task_image_path || null,
              correct_answer: t.correct_answer.trim() || null,
              solution_steps: t.solution_steps.trim() || null,
              rubric_text: t.rubric_text.trim() || null,
              max_score: t.max_score,
            })),
          });
          void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'templates'] });
        } catch (tplErr) {
          console.warn('homework_template_save_failed', tplErr);
          toast.warning('Не удалось сохранить как шаблон');
        }
      }

      // Done
      setSubmitPhase('done');

      void queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'assignments'],
      });

      // Build toast message
      const parts: string[] = [`ДЗ создано, назначено ${assignResult.added} ученикам`];
      if (assignResult.assignment_status !== 'active') {
        parts.push(`Статус задания: ${assignResult.assignment_status}`);
      }
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
        if (notifyResult.failed_student_ids.length > 0) {
          parts.push(
            `Недоставлено: ${notifyResult.failed_student_ids.slice(0, 5).join(', ')}${
              notifyResult.failed_student_ids.length > 5 ? '...' : ''
            }`,
          );
        }
      }
      toast.success(parts.join('. '));
      navigate('/tutor/homework');
    } catch (err) {
      setSubmitPhase('idle');

      if (
        err instanceof HomeworkApiError &&
        err.code === 'STUDENTS_TELEGRAM_NOT_CONNECTED'
      ) {
        const details =
          err.details && typeof err.details === 'object'
            ? (err.details as StudentsTelegramNotConnectedDetails)
            : null;
        const names =
          details?.invalid_student_names?.filter((name) => typeof name === 'string') ?? [];
        const ids =
          details?.invalid_student_ids?.filter((id) => typeof id === 'string') ?? [];

        const selected = names.length > 0 ? names : ids;
        const preview = selected.slice(0, 5).join(', ');
        const suffix = selected.length > 5 ? '...' : '';
        const message = selected.length > 0
          ? `Выбраны ученики без Telegram-связки: ${preview}${suffix}. Попросите ученика нажать /start и повторите.`
          : 'У части выбранных учеников не подключен Telegram. Попросите ученика нажать /start и повторите.';

        setErrors({ _students: message });
        setStep(3);
        toast.error(message);
        return;
      }

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
    assignMode,
    selectedGroupId,
    notifyEnabled,
    notifyTemplate,
    materials,
    saveAsTemplate,
    navigate,
    queryClient,
  ]);

  const isSubmitting = submitPhase !== 'idle' && submitPhase !== 'done';

  const submitLabel = (() => {
    switch (submitPhase) {
      case 'creating':
        return 'Создаём ДЗ...';
      case 'adding_materials':
        return 'Добавляем материалы...';
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
          <Button variant="ghost" size="sm" onClick={handleNavigateToList} disabled={isSubmitting}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад
          </Button>
          <h1 className="text-2xl font-bold flex-1">Создание ДЗ</h1>
          {!isSubmitting && (
            <TemplatePickerSheet onSelect={handleApplyTemplate} />
          )}
          {templateLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
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
            <StepTasks
              tasks={tasks}
              onChange={setTasks}
              materials={materials}
              onMaterialsChange={setMaterials}
              errors={errors}
            />
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
              assignMode={assignMode}
              onAssignModeChange={setAssignMode}
              selectedGroupId={selectedGroupId}
              onGroupIdChange={setSelectedGroupId}
              groups={groups.map((g) => ({ id: g.id, name: g.name }))}
            />
          )}
        </div>

        {/* Navigation footer */}
        <div className="border-t pt-4 sticky bottom-0 bg-background pb-4 md:pb-0 md:relative z-10 space-y-3">
          {step === 3 && (
            <SubmitPhaseTracker
              phase={submitPhase}
              notifyEnabled={notifyEnabled}
              hasMaterials={materials.length > 0}
            />
          )}
          {step === 3 && submitPhase === 'idle' && (
            <div className="flex items-center gap-2">
              <Switch
                id="save-template-toggle"
                checked={saveAsTemplate}
                onCheckedChange={setSaveAsTemplate}
              />
              <Label htmlFor="save-template-toggle" className="text-sm cursor-pointer">
                Сохранить как шаблон
              </Label>
            </div>
          )}
          <div className="flex items-center justify-between">
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
