import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Save,
  UploadCloud,
} from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabaseClient';
import {
  getStudentMockExam,
  startMockExamAttempt,
  submitMockExamAttempt,
  uploadMockExamBlankPhoto,
  uploadMockExamPart2Photo,
  type StudentMockExamAssignmentView,
  type StudentMockExamVariantTask,
} from '@/lib/studentMockExamApi';
import { cn } from '@/lib/utils';
import { useMockExamAutoSave } from '@/components/student/useMockExamAutoSave';
import type { MockExamCheckMode, MockExamMode } from '@/types/mockExam';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

const BLANK_PDF_URL =
  'https://api.sokratai.ru/storage/v1/object/public/mock-exam-blank-templates/ege-physics-2025.pdf';

type UploadKind = 'blank' | 'part2';
type UploadStatus = 'idle' | 'uploading' | 'saved' | 'error';

interface PhotoState {
  url: string | null;
  objectUrl: string | null;
  file: File | null;
  status: UploadStatus;
  error: string | null;
}

function createEmptyPhoto(url: string | null = null): PhotoState {
  return {
    url,
    objectUrl: null,
    file: null,
    status: url ? 'saved' : 'idle',
    error: null,
  };
}

function formatDuration(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '+' : '';
  const absSeconds = Math.abs(totalSeconds);
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const seconds = absSeconds % 60;
  return `${sign}${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getElapsedSeconds(startedAt: string | null, nowMs = Date.now()): number {
  if (!startedAt) return 0;
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startedMs) / 1000));
}

function getExamTitle(data: StudentMockExamAssignmentView): string {
  return data.variant?.title ?? data.assignment.title ?? 'Пробник';
}

function getModeLabel(mode: MockExamMode): string {
  if (mode === 'blank') return 'С бланком';
  if (mode === 'form') return 'Форма';
  return 'Ручной результат';
}

function getAnswerHint(mode: MockExamCheckMode | null): string {
  switch (mode) {
    case 'ordered':
      return 'Запиши последовательность через запятую: 1,3,2';
    case 'unordered':
      return 'Можно в любом порядке, через запятую';
    case 'multi_choice':
      return 'Номера вариантов: 13 или 1,3';
    case 'task20':
      return 'Ответ без пробелов: например 31';
    case 'pair':
      return 'Число и единица: 12,5 м/с или 12,5;м/с';
    case 'strict':
    default:
      return 'Короткий ответ как в бланке';
  }
}

function getInputWidth(mode: MockExamCheckMode | null): string {
  if (mode === 'pair') return 'w-full sm:w-80';
  if (mode === 'ordered' || mode === 'unordered' || mode === 'multi_choice') {
    return 'w-full sm:w-64';
  }
  return 'w-full sm:w-40';
}

function parseTaskImageRefs(raw: string | null): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      }
    } catch {
      return [];
    }
  }
  return [trimmed];
}

function parseStorageRef(ref: string): { bucket: string; path: string } | null {
  if (!ref.startsWith('storage://')) return null;
  const rest = ref.slice('storage://'.length);
  const slashIndex = rest.indexOf('/');
  if (slashIndex <= 0) return null;
  return {
    bucket: rest.slice(0, slashIndex),
    path: rest.slice(slashIndex + 1),
  };
}

function useSignedTaskImages(tasks: StudentMockExamVariantTask[]) {
  const [imagesByKim, setImagesByKim] = useState<Record<number, string[]>>({});

  useEffect(() => {
    let cancelled = false;

    async function resolveImages() {
      const next: Record<number, string[]> = {};
      for (const task of tasks) {
        const refs = parseTaskImageRefs(task.task_image_url);
        if (refs.length === 0) continue;

        const urls: string[] = [];
        for (const ref of refs) {
          if (ref.startsWith('http://') || ref.startsWith('https://')) {
            urls.push(ref);
            continue;
          }
          const parsed = parseStorageRef(ref);
          if (!parsed) continue;
          const { data, error } = await supabase.storage
            .from(parsed.bucket)
            .createSignedUrl(parsed.path, 60 * 60);
          if (!error && data?.signedUrl) {
            urls.push(data.signedUrl);
          }
        }
        if (urls.length > 0) {
          next[task.kim_number] = urls;
        }
      }

      if (!cancelled) {
        setImagesByKim(next);
      }
    }

    void resolveImages();
    return () => {
      cancelled = true;
    };
  }, [tasks]);

  return imagesByKim;
}

function MathBlock({ text, className }: { text: string; className?: string }) {
  return (
    <Suspense fallback={<div className={cn('whitespace-pre-wrap', className)}>{text}</div>}>
      <MathText text={text} className={cn('whitespace-pre-wrap', className)} />
    </Suspense>
  );
}

function TimerBadge({
  startedAt,
  durationMinutes,
}: {
  startedAt: string | null;
  durationMinutes: number;
}) {
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTimeMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSeconds = getElapsedSeconds(startedAt, currentTimeMs);
  const remainingSeconds = durationMinutes * 60 - elapsedSeconds;
  const isOvertime = remainingSeconds < 0;

  return (
    <div
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 tabular-nums',
        isOvertime
          ? 'border-rose-200 bg-rose-50 text-rose-800'
          : 'border-amber-200 bg-amber-50 text-amber-800',
      )}
    >
      <Clock3 className="h-4 w-4" />
      <span className="font-semibold">{formatDuration(remainingSeconds)}</span>
      <span className="hidden text-sm text-current/70 sm:inline">
        {isOvertime ? 'сверх времени' : 'визуальный таймер'}
      </span>
    </div>
  );
}

function SaveStatus({
  pendingCount,
  isOffline,
  lastSavedAt,
  hasUnsavedDraft,
}: {
  pendingCount: number;
  isOffline: boolean;
  lastSavedAt: string | null;
  hasUnsavedDraft: boolean;
}) {
  const savedTime = useMemo(() => {
    if (!lastSavedAt) return null;
    const parsed = Date.parse(lastSavedAt);
    if (!Number.isFinite(parsed)) return null;
    return new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsed);
  }, [lastSavedAt]);

  if (isOffline) {
    return (
      <div className="inline-flex min-h-10 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertCircle className="h-4 w-4" />
        Черновик сохранён на устройстве, ждёт сеть
      </div>
    );
  }

  if (pendingCount > 0 || hasUnsavedDraft) {
    return (
      <div className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Сохраняю {pendingCount > 0 ? `(${pendingCount})` : ''}
      </div>
    );
  }

  return (
    <div className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      <Save className="h-4 w-4" />
      {savedTime ? `Сохранено в ${savedTime}` : 'Автосохранение включено'}
    </div>
  );
}

function ReferencesPanel() {
  const [open, setOpen] = useState(false);

  return (
    <Card className="overflow-hidden shadow-none hover:shadow-sm">
      <button
        type="button"
        className="flex min-h-11 w-full touch-manipulation items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900">Справочные данные</h2>
          <p className="text-sm text-slate-500">Константы и формулы, которые можно держать перед глазами</p>
        </div>
        <ChevronDown className={cn('h-5 w-5 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-4 text-sm text-slate-700">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-slate-50 p-3">
              <div className="font-medium text-slate-900">Константы</div>
              <div className="mt-2 space-y-1">
                <p>g = 10 м/с²</p>
                <p>c = 3 · 10⁸ м/с</p>
                <p>e = 1,6 · 10⁻¹⁹ Кл</p>
              </div>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <div className="font-medium text-slate-900">Шпаргалка записи</div>
              <div className="mt-2 space-y-1">
                <p>Дроби можно писать через запятую или точку.</p>
                <p>В заданиях на соответствие порядок важен.</p>
                <p>В части 2 загружай одно фото на одно задание.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function BlankModeBanner({
  mode,
  blankPhoto,
  onFileSelected,
  onRetry,
  disabled,
}: {
  mode: MockExamMode;
  blankPhoto: PhotoState;
  onFileSelected: (file: File) => void;
  onRetry: () => void;
  disabled: boolean;
}) {
  if (mode !== 'blank') return null;

  return (
    <Card className="border-amber-200 bg-amber-50 shadow-none hover:shadow-sm">
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2 text-sm text-amber-950">
            <div className="flex items-center gap-2 font-semibold">
              <FileText className="h-4 w-4" />
              Режим: С бланком
            </div>
            <p>
              Распечатай PDF официального бланка, заполни ручкой, потом сфотографируй бланк.
              Ответы части 1 всё равно введи ниже: так проверка будет точной без OCR.
            </p>
            <a
              href={BLANK_PDF_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 font-medium text-amber-900 underline-offset-4 hover:underline"
            >
              <FileText className="h-4 w-4" />
              Открыть PDF бланка
            </a>
          </div>
          <PhotoUploadBox
            kind="blank"
            kimNumber={null}
            title="Фото заполненного бланка"
            state={blankPhoto}
            onFileSelected={onFileSelected}
            onRetry={onRetry}
            disabled={disabled}
            compact
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PhotoUploadBox({
  kind,
  kimNumber,
  title,
  state,
  onFileSelected,
  onRetry,
  disabled,
  compact = false,
}: {
  kind: UploadKind;
  kimNumber: number | null;
  title: string;
  state: PhotoState;
  onFileSelected: (file: File) => void;
  onRetry: () => void;
  disabled: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewUrl = state.objectUrl ?? state.url;
  const inputId = `${kind}-${kimNumber ?? 'blank'}-photo`;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFileSelected(file);
    event.target.value = '';
  };

  return (
    <div
      className={cn(
        'rounded-lg border-2 border-dashed bg-white/80 p-4',
        state.status === 'error' ? 'border-rose-300' : 'border-slate-300',
        compact ? 'w-full md:w-80' : 'w-full',
      )}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={handleChange}
        disabled={disabled || state.status === 'uploading'}
      />
      {previewUrl ? (
        <div className="space-y-3">
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-md border border-slate-200 bg-slate-50"
          >
            <img src={previewUrl} alt={title} className="max-h-64 w-full object-contain" />
          </a>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              {state.status === 'uploading' ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              ) : state.status === 'error' ? (
                <AlertCircle className="h-4 w-4 text-rose-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              )}
              <span className={state.status === 'error' ? 'text-rose-700' : 'text-slate-700'}>
                {state.status === 'uploading'
                  ? 'Загружаю фото'
                  : state.status === 'error'
                    ? state.error ?? 'Не удалось загрузить'
                    : 'Фото сохранено'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {state.file && state.status === 'error' && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="touch-manipulation"
                  onClick={onRetry}
                  disabled={disabled}
                >
                  <RotateCcw className="h-4 w-4" />
                  Повторить
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="touch-manipulation"
                onClick={() => inputRef.current?.click()}
                disabled={disabled || state.status === 'uploading'}
              >
                <Camera className="h-4 w-4" />
                Переснять
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center">
          <ImageIcon className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-2 text-sm font-medium text-slate-700">{title}</p>
          <p className="mt-1 text-sm text-slate-500">JPG/PNG/WebP/HEIC · до 10 МБ · 1 фото</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 touch-manipulation bg-white"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            <UploadCloud className="h-4 w-4" />
            Загрузить фото
          </Button>
        </div>
      )}
    </div>
  );
}

function Part1TaskCard({
  task,
  answer,
  status,
  imageUrls,
  onAnswer,
  disabled,
}: {
  task: StudentMockExamVariantTask;
  answer: string;
  status: string | undefined;
  imageUrls: string[];
  onAnswer: (kim: number, answer: string) => void;
  disabled: boolean;
}) {
  return (
    <Card className="shadow-none hover:shadow-sm" id={`task-${task.kim_number}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700">
            №{task.kim_number}
            {task.topic ? ` · ${task.topic}` : ''}
          </span>
          <span className="text-sm text-slate-500">{task.max_score} балл{task.max_score === 1 ? '' : 'а'}</span>
        </div>
        <MathBlock text={task.task_text} className="text-base leading-7 text-slate-800" />
        {imageUrls.length > 0 && (
          <div className="mt-4 grid gap-3">
            {imageUrls.map((url, index) => (
              <img
                key={`${task.kim_number}-${index}`}
                src={url}
                alt={`Иллюстрация к заданию ${task.kim_number}`}
                className="max-h-80 w-full rounded-md border border-slate-200 bg-slate-50 object-contain"
              />
            ))}
          </div>
        )}
        <div className="mt-4">
          <label htmlFor={`answer-${task.kim_number}`} className="text-sm font-medium text-slate-700">
            Ответ
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id={`answer-${task.kim_number}`}
              value={answer}
              onChange={(event) => onAnswer(task.kim_number, event.target.value)}
              placeholder="Введи ответ"
              disabled={disabled}
              className={cn(
                'h-11 touch-manipulation border-slate-200 text-base tabular-nums focus:border-accent focus:ring-2 focus:ring-accent/20',
                getInputWidth(task.check_mode),
              )}
              inputMode={task.check_mode === 'pair' ? 'text' : 'decimal'}
              autoComplete="off"
            />
            <span className="text-sm text-slate-500">{getAnswerHint(task.check_mode)}</span>
          </div>
          {status && status !== 'idle' && (
            <div className="mt-2 text-sm text-slate-500">
              {status === 'saving'
                ? 'Сохраняется...'
                : status === 'saved'
                  ? 'Сохранено'
                  : status === 'error'
                    ? 'Есть локальный черновик, повторю при сети'
                    : 'В очереди сохранения'}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Part2TaskCard({
  task,
  state,
  imageUrls,
  onFileSelected,
  onRetry,
  disabled,
}: {
  task: StudentMockExamVariantTask;
  state: PhotoState;
  imageUrls: string[];
  onFileSelected: (file: File) => void;
  onRetry: () => void;
  disabled: boolean;
}) {
  return (
    <Card className="shadow-none hover:shadow-sm" id={`task-${task.kim_number}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-900">
            №{task.kim_number}
            {task.topic ? ` · ${task.topic}` : ''}
          </span>
          <span className="text-sm text-slate-500">{task.max_score} баллов · развёрнутое решение</span>
        </div>
        <MathBlock text={task.task_text} className="text-base leading-7 text-slate-800" />
        {imageUrls.length > 0 && (
          <div className="mt-4 grid gap-3">
            {imageUrls.map((url, index) => (
              <img
                key={`${task.kim_number}-${index}`}
                src={url}
                alt={`Иллюстрация к заданию ${task.kim_number}`}
                className="max-h-80 w-full rounded-md border border-slate-200 bg-slate-50 object-contain"
              />
            ))}
          </div>
        )}
        <div className="mt-4">
          <PhotoUploadBox
            kind="part2"
            kimNumber={task.kim_number}
            title="Фото решения"
            state={state}
            onFileSelected={onFileSelected}
            onRetry={onRetry}
            disabled={disabled}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StudentMockExamWorkspace({ data }: { data: StudentMockExamAssignmentView }) {
  const navigate = useNavigate();
  const [startedAt, setStartedAt] = useState(data.attempt.started_at);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [blankPhoto, setBlankPhoto] = useState<PhotoState>(() =>
    createEmptyPhoto(data.attempt.blank_photo_url),
  );
  const [part2Photos, setPart2Photos] = useState<Record<number, PhotoState>>(() => {
    const initial: Record<number, PhotoState> = {};
    for (const row of data.part2_solutions) {
      initial[row.kim_number] = createEmptyPhoto(row.photo_url);
    }
    return initial;
  });
  const objectUrlsRef = useRef<string[]>([]);

  const tasks = useMemo(
    () => [...data.tasks].sort((a, b) => a.order_num - b.order_num),
    [data.tasks],
  );
  const part1Tasks = useMemo(() => tasks.filter((task) => task.part === 1), [tasks]);
  const part2Tasks = useMemo(() => tasks.filter((task) => task.part === 2), [tasks]);
  const imagesByKim = useSignedTaskImages(tasks);
  const isFinal = data.attempt.status !== 'in_progress';
  const durationMinutes = data.variant?.duration_minutes ?? 235;

  const autosave = useMockExamAutoSave({
    attemptId: data.attempt.id,
    initialAnswers: data.part1_answers,
    disabled: isFinal,
  });

  useEffect(() => {
    if (data.attempt.status !== 'in_progress') {
      navigate(`/student/mock-exams/${data.assignment.id}/result`, { replace: true });
      return;
    }
    if (!data.attempt.started_at) {
      const optimisticStart = new Date().toISOString();
      setStartedAt(optimisticStart);
      startMockExamAttempt(data.attempt.id).catch((err) => {
        console.warn('[mock-exam] failed to start attempt', err);
      });
    }
  }, [data.assignment.id, data.attempt.id, data.attempt.started_at, data.attempt.status, navigate]);

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current = [];
    };
  }, []);

  const registerObjectUrl = useCallback((file: File): string => {
    const objectUrl = URL.createObjectURL(file);
    objectUrlsRef.current.push(objectUrl);
    return objectUrl;
  }, []);

  const uploadBlank = useCallback(
    async (file: File) => {
      const objectUrl = registerObjectUrl(file);
      setBlankPhoto({ url: null, objectUrl, file, status: 'uploading', error: null });
      try {
        const result = await uploadMockExamBlankPhoto(data.attempt.id, file);
        setBlankPhoto({
          url: result.signed_url,
          objectUrl: result.signed_url ? null : objectUrl,
          file: null,
          status: 'saved',
          error: null,
        });
      } catch (err) {
        setBlankPhoto((prev) => ({
          ...prev,
          file,
          status: 'error',
          error: err instanceof Error ? err.message : 'Не удалось загрузить фото',
        }));
      }
    },
    [data.attempt.id, registerObjectUrl],
  );

  const uploadPart2 = useCallback(
    async (kimNumber: number, file: File) => {
      const objectUrl = registerObjectUrl(file);
      setPart2Photos((prev) => ({
        ...prev,
        [kimNumber]: { url: null, objectUrl, file, status: 'uploading', error: null },
      }));
      try {
        const result = await uploadMockExamPart2Photo(data.attempt.id, kimNumber, file);
        setPart2Photos((prev) => ({
          ...prev,
          [kimNumber]: {
            url: result.signed_url,
            objectUrl: result.signed_url ? null : objectUrl,
            file: null,
            status: 'saved',
            error: null,
          },
        }));
      } catch (err) {
        setPart2Photos((prev) => ({
          ...prev,
          [kimNumber]: {
            ...(prev[kimNumber] ?? createEmptyPhoto()),
            file,
            status: 'error',
            error: err instanceof Error ? err.message : 'Не удалось загрузить фото',
          },
        }));
      }
    },
    [data.attempt.id, registerObjectUrl],
  );

  const retryBlank = useCallback(() => {
    if (blankPhoto.file) void uploadBlank(blankPhoto.file);
  }, [blankPhoto.file, uploadBlank]);

  const retryPart2 = useCallback(
    (kimNumber: number) => {
      const file = part2Photos[kimNumber]?.file;
      if (file) void uploadPart2(kimNumber, file);
    },
    [part2Photos, uploadPart2],
  );

  const answeredPart1Count = part1Tasks.filter((task) => {
    const value = autosave.answers[task.kim_number];
    return typeof value === 'string' && value.trim().length > 0;
  }).length;
  const uploadedPart2Count = part2Tasks.filter((task) => {
    const photo = part2Photos[task.kim_number];
    return Boolean(photo?.url || photo?.objectUrl);
  }).length;
  const failedUploadCount =
    (blankPhoto.status === 'error' ? 1 : 0) +
    part2Tasks.filter((task) => part2Photos[task.kim_number]?.status === 'error').length;
  const uploadingCount =
    (blankPhoto.status === 'uploading' ? 1 : 0) +
    part2Tasks.filter((task) => part2Photos[task.kim_number]?.status === 'uploading').length;

  const handleSubmit = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const flush = await autosave.flush();
      if (flush.failed > 0) {
        setSubmitError('Не все ответы дошли до сервера. Черновик сохранён на устройстве, но работу пока нельзя сдавать.');
        return;
      }
      await submitMockExamAttempt(data.attempt.id);
      navigate(`/student/mock-exams/${data.assignment.id}/result`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Не удалось сдать работу');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="sokrat min-h-[100dvh] bg-slate-50" data-sokrat-mode="student">
      <PageContent>
        <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 sm:pb-32">
          <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase text-slate-500">Пробник ЕГЭ по физике</p>
                <h1 className="mt-1 text-xl font-semibold leading-tight text-slate-900 sm:text-2xl">
                  {getExamTitle(data)}
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                  {getModeLabel(data.assignment.mode)} · {tasks.length} задач · Часть 1: {answeredPart1Count}/
                  {part1Tasks.length} · Часть 2: {uploadedPart2Count}/{part2Tasks.length} фото
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
                <TimerBadge startedAt={startedAt} durationMinutes={durationMinutes} />
                <SaveStatus
                  pendingCount={autosave.pendingCount}
                  isOffline={autosave.isOffline}
                  lastSavedAt={autosave.lastSavedAt}
                  hasUnsavedDraft={autosave.hasUnsavedDraft}
                />
              </div>
            </div>
          </section>

          <div className="space-y-4">
            <BlankModeBanner
              mode={data.assignment.mode}
              blankPhoto={blankPhoto}
              onFileSelected={(file) => void uploadBlank(file)}
              onRetry={retryBlank}
              disabled={isFinal}
            />
            <ReferencesPanel />
          </div>

          <section className="mt-6 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Часть 1</h2>
                <p className="text-sm text-slate-500">Вводи ответы сразу. Каждое изменение сохраняется автоматически.</p>
              </div>
              <span className="rounded-md bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                {answeredPart1Count}/{part1Tasks.length}
              </span>
            </div>
            {part1Tasks.map((task) => (
              <Part1TaskCard
                key={task.id}
                task={task}
                answer={autosave.answers[task.kim_number] ?? ''}
                status={autosave.statusByKim[task.kim_number]}
                imageUrls={imagesByKim[task.kim_number] ?? []}
                onAnswer={autosave.setAnswer}
                disabled={isFinal}
              />
            ))}
          </section>

          <section className="mt-8 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Часть 2</h2>
                <p className="text-sm text-slate-500">Загрузи одно фото решения на каждое задание. Если фото не ушло, нажми «Повторить».</p>
              </div>
              <span className="rounded-md bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
                {uploadedPart2Count}/{part2Tasks.length} фото
              </span>
            </div>
            {part2Tasks.map((task) => (
              <Part2TaskCard
                key={task.id}
                task={task}
                state={part2Photos[task.kim_number] ?? createEmptyPhoto()}
                imageUrls={imagesByKim[task.kim_number] ?? []}
                onFileSelected={(file) => void uploadPart2(task.kim_number, file)}
                onRetry={() => retryPart2(task.kim_number)}
                disabled={isFinal}
              />
            ))}
          </section>
        </main>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              <span>
                Часть 1: <strong className="text-slate-900">{answeredPart1Count}/{part1Tasks.length}</strong>
              </span>
              <span className="mx-2 text-slate-300">·</span>
              <span>
                Часть 2: <strong className="text-slate-900">{uploadedPart2Count}/{part2Tasks.length} фото</strong>
              </span>
              {uploadingCount > 0 && <span className="ml-2 text-amber-700">идёт загрузка</span>}
              {failedUploadCount > 0 && <span className="ml-2 text-rose-700">есть фото с ошибкой</span>}
            </div>
            <Button
              type="button"
              className="min-h-[52px] touch-manipulation bg-accent px-6 text-base text-white hover:bg-accent/90"
              onClick={() => setSubmitOpen(true)}
              disabled={isSubmitting || uploadingCount > 0}
            >
              Сдать работу
            </Button>
          </div>
        </div>

        <Dialog open={submitOpen} onOpenChange={(open) => !isSubmitting && setSubmitOpen(open)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Сдать пробник?</DialogTitle>
              <DialogDescription>
                После отправки ответы уже нельзя будет менять. Часть 1 проверится сразу, часть 2 уйдёт репетитору.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              <p>Часть 1: {answeredPart1Count} из {part1Tasks.length} ответов.</p>
              <p>Часть 2: {uploadedPart2Count} из {part2Tasks.length} фото.</p>
              {data.assignment.mode === 'blank' && (
                <p>Бланк: {blankPhoto.url ? 'фото загружено' : 'фото пока не загружено'}.</p>
              )}
              {autosave.pendingCount > 0 && <p>Перед отправкой синхронизирую {autosave.pendingCount} черновик(а).</p>}
              {failedUploadCount > 0 && <p className="text-rose-700">Есть фото с ошибкой загрузки. Их лучше повторить до сдачи.</p>}
            </div>
            {submitError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                {submitError}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="touch-manipulation"
                onClick={() => setSubmitOpen(false)}
                disabled={isSubmitting}
              >
                Вернуться
              </Button>
              <Button
                type="button"
                className="touch-manipulation bg-accent text-white hover:bg-accent/90"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Сдать работу
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageContent>
    </div>
  );
}

export default function StudentMockExam() {
  const { id } = useParams<{ id: string }>();
  const assignmentId = id ?? '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['student', 'mock-exam', assignmentId],
    queryFn: () => getStudentMockExam(assignmentId),
    enabled: assignmentId.length > 0,
    staleTime: 15_000,
  });

  return (
    <AuthGuard>
      {isLoading && (
        <PageContent>
          <main className="sokrat grid min-h-[60dvh] place-items-center bg-slate-50 px-4" data-sokrat-mode="student">
            <div className="flex items-center gap-3 text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              Загружаю пробник...
            </div>
          </main>
        </PageContent>
      )}
      {!isLoading && error && (
        <PageContent>
          <main className="sokrat min-h-[60dvh] bg-slate-50 px-4 py-8" data-sokrat-mode="student">
            <Card className="mx-auto max-w-xl border-rose-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-rose-800">
                  <AlertCircle className="h-5 w-5" />
                  Не удалось открыть пробник
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-600">
                {error instanceof Error ? error.message : 'Проверь подключение и попробуй ещё раз.'}
              </CardContent>
            </Card>
          </main>
        </PageContent>
      )}
      {!isLoading && data && <StudentMockExamWorkspace data={data} />}
    </AuthGuard>
  );
}
