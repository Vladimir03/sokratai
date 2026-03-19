import { useState, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Trash2,
  Upload,
  Loader2,
  Dices,
  Image as ImageIcon,
  X,
  Paperclip,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  uploadTutorHomeworkTaskImage,
  deleteTutorHomeworkTaskImage,
  parseStorageRef,
} from '@/lib/tutorHomeworkApi';
import { SourceBadge } from '@/components/kb/ui/SourceBadge';
import { type DraftTask, MAX_IMAGE_SIZE_BYTES, IMAGE_REQUIREMENTS_HINT, revokeObjectUrl } from './types';

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

// ─── Task card ────────────────────────────────────────────────────────────────

export interface HWTaskCardProps {
  task: DraftTask;
  index: number;
  onUpdate: (t: DraftTask) => void;
  onRemove: () => void;
  canRemove: boolean;
  /** When set, defer storage image deletes instead of executing immediately (edit mode safety) */
  onDeferImageDelete?: (storagePath: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

export function HWTaskCard({ task, index, onUpdate, onRemove, canRemove, onDeferImageDelete, onMoveUp, onMoveDown, isFirst, isLast }: HWTaskCardProps) {
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
          if (onDeferImageDelete) {
            onDeferImageDelete(previousImagePath);
          } else {
            void deleteTutorHomeworkTaskImage(previousImagePath);
          }
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
    [task, onUpdate, onDeferImageDelete],
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
      if (onDeferImageDelete) {
        onDeferImageDelete(task.task_image_path);
      } else {
        void deleteTutorHomeworkTaskImage(task.task_image_path);
      }
    }
    revokeObjectUrl(task.task_image_preview_url);
    onUpdate({
      ...task,
      task_image_path: null,
      task_image_name: null,
      task_image_preview_url: null,
      task_image_used_fallback: false,
    });
  }, [task, onUpdate, onDeferImageDelete]);

  return (
    <Card animate={false}>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveUp} disabled={isFirst}
                aria-label="Переместить вверх">
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveDown} disabled={isLast}
                aria-label="Переместить вниз">
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
            <span className="text-sm font-medium text-muted-foreground">
              Задача {index + 1}
            </span>
            {task.kb_source && (
              <SourceBadge source={task.kb_source} />
            )}
            {task.kb_attachment_url && !task.task_image_path && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                <Paperclip className="h-3 w-3" />
                Есть изображение в базе
              </span>
            )}
          </div>
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
            placeholder="Условие задачи (можно вставить скриншот Ctrl+V)..."
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
