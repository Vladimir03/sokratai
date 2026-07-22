// Фаза 2 «один загрузчик — N назначений» (2026-07-20): конструктор СВОЕГО
// варианта пробника. Запрос Елены/Ульяны (редактируемые пробники) + Егора
// (AI-создание из PDF — вход добавляет пуш 3).
//
// Модель: вариант в БД всегда ПОЛНЫЙ (черновик живёт в React-state; схемные
// CHECK'и тоталов не ослабляем). Все записи — через edge mock-exam-tutor-api
// (единственный write-path); чтения prefill — PostgREST под RLS.
// «Вариант в работе» (есть назначения) → контент заморожен (сервер 409),
// UI показывает баннер + предлагает «Дублировать».

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Copy,
  ImagePlus,
  Loader2,
  Lock,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { MathText } from '@/components/kb/ui/MathText';
import { MockExamFeatureGate } from './MockExamFeatureGate';
import { useQueryClient } from '@tanstack/react-query';
import {
  MOCK_EXAM_VARIANTS_KEY,
  useMockExamVariantDetail,
  type MockExamVariantTaskRow,
} from '@/hooks/useMockExamVariants';
import {
  createMockExamVariant,
  deleteMockExamVariant,
  duplicateMockExamVariant,
  MockExamApiError,
  replaceMockExamVariantTasks,
  updateMockExamVariantMeta,
  type MockExamVariantTaskInput,
} from '@/lib/mockExamApi';
import { getKBImageSignedUrl, uploadKBTaskImage, validateImageFile } from '@/lib/kbApi';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';
import {
  createEmptyVariantTask,
  readAndClearVariantPrefill,
  rowToDraft,
  type VariantTaskDraft,
} from '@/components/tutor/mock-exams/variantTaskDraft';
import { MockExamAiLoaderSheet } from '@/components/tutor/mock-exams/MockExamAiLoaderSheet';
import { SUBJECTS } from '@/types/homework';
import { cn } from '@/lib/utils';

// ─── Constants ───────────────────────────────────────────────────────────────

const CHECK_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: 'strict', label: 'Точное совпадение (число / слово)' },
  { value: 'ordered', label: 'Последовательность цифр — порядок важен' },
  { value: 'ordered_lenient', label: 'Последовательность — 1 ошибка/лишняя позиция = 1 балл' },
  { value: 'unordered', label: 'Набор цифр — порядок неважен' },
  { value: 'multi_choice', label: 'Выбор нескольких (частичный балл за 1 ошибку)' },
  { value: 'task20', label: 'Набор цифр — всё или ничего' },
  { value: 'pair', label: 'Пара «значение + единица»' },
];

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-[16px] transition-colors focus:border-accent/50 focus:outline-none [touch-action:manipulation]';

// ─── Task image attach (условие) ─────────────────────────────────────────────

function TaskImageAttachment({
  imageUrl,
  disabled,
  onChange,
}: {
  imageUrl: string | null;
  disabled: boolean;
  onChange: (ref: string | null) => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  // Ревью 5.6 P2 #10: явное failed-состояние вместо вечного skeleton/битого
  // <img> (реально при shared-blob debt: KB-задачу удалили — blob исчез).
  const [imageFailed, setImageFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstRef = useMemo(() => parseAttachmentUrls(imageUrl)[0] ?? null, [imageUrl]);

  useEffect(() => {
    setImageFailed(false);
    setSignedUrl(null);
    if (!firstRef) return;
    let cancelled = false;
    void getKBImageSignedUrl(firstRef).then((url) => {
      if (cancelled) return;
      if (url) setSignedUrl(url);
      else setImageFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [firstRef]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validationError = validateImageFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setUploading(true);
    try {
      const res = await uploadKBTaskImage(file);
      onChange(res.storageRef);
      toast.success('Фото прикреплено');
    } catch {
      toast.error('Не удалось загрузить фото');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {firstRef ? (
        imageFailed ? (
          <div
            className="flex h-16 w-24 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-1 text-center text-[10px] font-medium leading-tight text-amber-700"
            title="Файл изображения недоступен — замените или уберите"
          >
            Фото недоступно
          </div>
        ) : signedUrl ? (
          <img
            loading="lazy"
            src={signedUrl}
            alt="Фото условия"
            onError={() => setImageFailed(true)}
            className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
            <ImagePlus className="h-4 w-4 animate-pulse text-slate-300" aria-hidden="true" />
          </div>
        )
      ) : null}
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50 [touch-action:manipulation]"
      >
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {firstRef ? 'Заменить фото' : 'Фото условия'}
      </button>
      {firstRef ? (
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => onChange(null)}
          className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 [touch-action:manipulation]"
        >
          Убрать
        </button>
      ) : null}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
}

// ─── Task card ───────────────────────────────────────────────────────────────

const VariantTaskCard = memo(function VariantTaskCard({
  draft,
  index,
  disabled,
  duplicateKim,
  onUpdate,
  onRemove,
}: {
  draft: VariantTaskDraft;
  index: number;
  disabled: boolean;
  /** true = № КИМ конфликтует с другой задачей (live-подсветка). */
  duplicateKim: boolean;
  onUpdate: (localId: string, patch: Partial<VariantTaskDraft>) => void;
  onRemove: (localId: string) => void;
}) {
  const isPart1 = draft.part === 1;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-20">
          <Label className="mb-1 block text-xs font-semibold text-slate-500">№ КИМ</Label>
          <input
            type="text"
            inputMode="numeric"
            value={draft.kimNumber}
            disabled={disabled}
            onChange={(e) => onUpdate(draft.localId, { kimNumber: e.target.value.replace(/\D/g, '') })}
            className={cn(INPUT_CLASS, duplicateKim && 'border-red-300 bg-red-50/40')}
            aria-label={`№ КИМ задачи ${index + 1}`}
          />
        </div>
        <div className="w-20">
          <Label className="mb-1 block text-xs font-semibold text-slate-500">Балл</Label>
          <input
            type="text"
            inputMode="numeric"
            value={draft.maxScore}
            disabled={disabled}
            onChange={(e) => onUpdate(draft.localId, { maxScore: e.target.value.replace(/\D/g, '') })}
            className={INPUT_CLASS}
            aria-label={`Макс. балл задачи ${index + 1}`}
          />
        </div>
        {isPart1 ? (
          <div className="min-w-[220px] flex-1">
            <Label className="mb-1 block text-xs font-semibold text-slate-500">Проверка ответа</Label>
            <select
              value={draft.checkMode}
              disabled={disabled}
              onChange={(e) => onUpdate(draft.localId, { checkMode: e.target.value })}
              className={INPUT_CLASS}
              aria-label={`Режим проверки задачи ${index + 1}`}
            >
              {CHECK_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onRemove(draft.localId)}
          aria-label={`Удалить задачу ${index + 1}`}
          title="Удалить задачу"
          className="ml-auto rounded-md p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 [touch-action:manipulation]"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {duplicateKim ? (
        <p className="text-[11px] text-red-600">№ КИМ повторяется — номера в варианте должны быть уникальны.</p>
      ) : null}

      <div>
        <Label className="mb-1 block text-xs font-semibold text-slate-500">Условие</Label>
        <textarea
          value={draft.taskText}
          disabled={disabled}
          onChange={(e) => onUpdate(draft.localId, { taskText: e.target.value })}
          rows={isPart1 ? 2 : 3}
          className={cn(INPUT_CLASS, 'resize-y leading-relaxed')}
          placeholder="Текст условия (формулы в $…$) — или прикрепите фото"
        />
        {draft.taskText.includes('$') ? (
          <div className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <MathText text={draft.taskText} />
          </div>
        ) : null}
      </div>

      <TaskImageAttachment
        imageUrl={draft.taskImageUrl}
        disabled={disabled}
        onChange={(ref) => onUpdate(draft.localId, { taskImageUrl: ref })}
      />

      {isPart1 ? (
        <div>
          <Label className="mb-1 block text-xs font-semibold text-slate-500">
            Правильный ответ <span className="text-red-500">*</span>
          </Label>
          <input
            type="text"
            value={draft.correctAnswer}
            disabled={disabled}
            onChange={(e) => onUpdate(draft.localId, { correctAnswer: e.target.value })}
            className={cn(
              INPUT_CLASS,
              !draft.correctAnswer.trim() && 'border-amber-300 bg-amber-50/40',
            )}
            placeholder="Для авто-проверки Части 1"
          />
        </div>
      ) : (
        <>
          <div>
            <Label className="mb-1 block text-xs font-semibold text-slate-500">
              Правильный ответ <span className="font-normal text-slate-400">(необязательно)</span>
            </Label>
            <input
              type="text"
              value={draft.correctAnswer}
              disabled={disabled}
              onChange={(e) => onUpdate(draft.localId, { correctAnswer: e.target.value })}
              className={INPUT_CLASS}
              placeholder="Итоговый ответ — AI сверяет при проверке"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs font-semibold text-slate-500">
              Эталонное решение <span className="font-normal text-slate-400">(видит AI и ученик после сдачи)</span>
            </Label>
            <textarea
              value={draft.solutionText}
              disabled={disabled}
              onChange={(e) => onUpdate(draft.localId, { solutionText: e.target.value })}
              rows={3}
              className={cn(INPUT_CLASS, 'resize-y leading-relaxed')}
              placeholder="Ход решения — AI проверяет по нему работу ученика"
            />
          </div>
        </>
      )}
    </div>
  );
});

// ─── Page ────────────────────────────────────────────────────────────────────

function VariantEditorContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: editId } = useParams<{ id: string }>();
  const isEditMode = Boolean(editId);

  const { detail, loading: detailLoading, error: detailError } = useMockExamVariantDetail(
    isEditMode ? editId! : null,
  );

  // Prefill из корзины Базы («Создать пробник» в HWDrawer, пуш 3) — читается
  // СИНХРОННО один раз при маунте create-режима (не эффект — без клобберов,
  // конвенция конструктора ДЗ `?folder=`).
  const cartPrefillRef = useRef(!isEditMode ? readAndClearVariantPrefill() : null);
  const cartPrefill = cartPrefillRef.current;

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState(cartPrefill?.subject ?? 'physics');
  const [exam, setExam] = useState<'ege' | 'oge'>('ege');
  const [durationText, setDurationText] = useState('235');
  const [part1Tasks, setPart1Tasks] = useState<VariantTaskDraft[]>(
    () => cartPrefill?.drafts.filter((d) => d.part === 1) ?? [],
  );
  const [part2Tasks, setPart2Tasks] = useState<VariantTaskDraft[]>(
    () => cartPrefill?.drafts.filter((d) => d.part === 2) ?? [],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [aiLoaderOpen, setAiLoaderOpen] = useState(false);

  // Prefill (edit) — один раз на загрузку detail (ref-guard, конвенция
  // конструктора ДЗ: без эффектов-клобберов).
  const prefilledRef = useRef(false);
  useEffect(() => {
    prefilledRef.current = false;
  }, [editId]);
  useEffect(() => {
    if (!isEditMode || !detail || prefilledRef.current) return;
    prefilledRef.current = true;
    setTitle(detail.variant.title);
    setSubject(detail.variant.subject ?? 'physics');
    setExam(detail.variant.exam_type.startsWith('oge') ? 'oge' : 'ege');
    setDurationText(String(detail.variant.duration_minutes));
    setPart1Tasks(detail.tasks.filter((t) => t.part === 1).map(rowToDraft));
    setPart2Tasks(detail.tasks.filter((t) => t.part === 2).map(rowToDraft));
  }, [isEditMode, detail]);

  const inUse = isEditMode && (detail?.inUse ?? false);
  const contentLocked = inUse;

  // Live-детект дублей КИМ по обеим частям.
  const duplicateKims = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of [...part1Tasks, ...part2Tasks]) {
      const k = t.kimNumber.trim();
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [part1Tasks, part2Tasks]);

  const updateTask = useCallback((localId: string, patch: Partial<VariantTaskDraft>) => {
    const apply = (prev: VariantTaskDraft[]) =>
      prev.map((t) => (t.localId === localId ? { ...t, ...patch } : t));
    setPart1Tasks(apply);
    setPart2Tasks(apply);
  }, []);

  const removeTask = useCallback((localId: string) => {
    setPart1Tasks((prev) => prev.filter((t) => t.localId !== localId));
    setPart2Tasks((prev) => prev.filter((t) => t.localId !== localId));
  }, []);

  const addPart1 = useCallback(() => {
    setPart1Tasks((prev) => [...prev, createEmptyVariantTask(1)]);
  }, []);
  const addPart2 = useCallback(() => {
    setPart2Tasks((prev) => [...prev, createEmptyVariantTask(2)]);
  }, []);

  // Приём готовых черновиков из AI-загрузчика (functional updater — анти-race).
  const appendDrafts = useCallback((drafts: VariantTaskDraft[]) => {
    setPart1Tasks((prev) => [...prev, ...drafts.filter((d) => d.part === 1)]);
    setPart2Tasks((prev) => [...prev, ...drafts.filter((d) => d.part === 2)]);
    const p1 = drafts.filter((d) => d.part === 1).length;
    const p2 = drafts.length - p1;
    toast.success(
      `Добавлено задач: ${drafts.length}` +
        (p1 > 0 && p2 > 0 ? ` (Часть 1 — ${p1}, Часть 2 — ${p2})` : ''),
    );
  }, []);

  const totalMax = useMemo(
    () =>
      [...part1Tasks, ...part2Tasks].reduce((acc, t) => {
        const n = parseInt(t.maxScore.trim(), 10);
        return acc + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [part1Tasks, part2Tasks],
  );

  const buildTasksPayload = useCallback((): MockExamVariantTaskInput[] | string => {
    const all = [...part1Tasks, ...part2Tasks];
    if (all.length === 0) return 'Добавьте хотя бы одну задачу';
    const payload: MockExamVariantTaskInput[] = [];
    for (const [i, t] of all.entries()) {
      const label = `Задача ${i + 1}${t.part === 2 ? ' (Часть 2)' : ''}`;
      const kim = parseInt(t.kimNumber.trim(), 10);
      if (!Number.isFinite(kim) || kim < 1 || kim > 99) return `${label}: укажите № КИМ (1–99)`;
      if (duplicateKims.has(t.kimNumber.trim())) return `№ КИМ ${kim} повторяется — исправьте дубли`;
      const maxScore = parseInt(t.maxScore.trim(), 10);
      if (!Number.isFinite(maxScore) || maxScore < 1 || maxScore > 25) return `${label}: макс. балл 1–25`;
      if (!t.taskText.trim() && !t.taskImageUrl) return `${label}: добавьте текст условия или фото`;
      if (t.part === 1 && !t.correctAnswer.trim()) return `${label}: для Части 1 обязателен правильный ответ`;
      payload.push({
        kim_number: kim,
        part: t.part,
        task_text: t.taskText.trim(),
        task_image_url: t.taskImageUrl,
        correct_answer: t.correctAnswer.trim() || null,
        check_mode: t.part === 1 ? (t.checkMode as MockExamVariantTaskInput['check_mode']) : 'manual',
        max_score: maxScore,
        solution_text: t.solutionText.trim() || null,
        solution_image_urls: t.solutionImageUrls,
        topic: t.topic.trim() || null,
      });
    }
    return payload;
  }, [part1Tasks, part2Tasks, duplicateKims]);

  const invalidateVariantCaches = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: MOCK_EXAM_VARIANTS_KEY });
    if (editId) {
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'mock-exams', 'variant', editId] });
    }
  }, [queryClient, editId]);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error('Укажите название варианта');
      return;
    }
    const duration = parseInt(durationText.trim(), 10);
    if (!Number.isFinite(duration) || duration < 1 || duration > 600) {
      toast.error('Длительность — целое число минут (1–600)');
      return;
    }

    setIsSubmitting(true);
    try {
      if (!isEditMode) {
        const tasksPayload = buildTasksPayload();
        if (typeof tasksPayload === 'string') {
          toast.error(tasksPayload);
          return;
        }
        const created = await createMockExamVariant({
          title: trimmedTitle,
          subject,
          exam,
          duration_minutes: duration,
          tasks: tasksPayload,
        });
        invalidateVariantCaches();
        toast.success('Вариант создан — теперь его можно назначить ученикам');
        navigate(`/tutor/mock-exams/new?variant=${created.variant_id}`, { replace: true });
        return;
      }

      // Edit: назначенный вариант — только title; иначе мета + задачи ОДНИМ
      // атомарным вызовом (ревью 5.6 P1 #4 — сервер сохраняет всё одной
      // транзакцией; частичное «мета прошла, задачи упали» невозможно).
      if (contentLocked) {
        await updateMockExamVariantMeta(editId!, { title: trimmedTitle });
        invalidateVariantCaches();
        toast.success('Название сохранено (вариант уже назначен — состав заморожен)');
        return;
      }
      const tasksPayload = buildTasksPayload();
      if (typeof tasksPayload === 'string') {
        toast.error(tasksPayload);
        return;
      }
      await replaceMockExamVariantTasks(editId!, tasksPayload, {
        title: trimmedTitle,
        subject,
        exam,
        duration_minutes: duration,
      });
      invalidateVariantCaches();
      toast.success('Вариант сохранён');
    } catch (err) {
      const msg = err instanceof MockExamApiError || err instanceof Error
        ? err.message
        : 'Не удалось сохранить вариант';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    title,
    durationText,
    isEditMode,
    contentLocked,
    subject,
    exam,
    editId,
    buildTasksPayload,
    invalidateVariantCaches,
    navigate,
  ]);

  const handleDuplicate = useCallback(async () => {
    if (!editId || isDuplicating) return;
    setIsDuplicating(true);
    try {
      const res = await duplicateMockExamVariant(editId);
      invalidateVariantCaches();
      toast.success('Копия создана — правьте её свободно');
      navigate(`/tutor/mock-exams/variants/${res.variant_id}/edit`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось создать копию');
    } finally {
      setIsDuplicating(false);
    }
  }, [editId, isDuplicating, invalidateVariantCaches, navigate]);

  const handleDelete = useCallback(async () => {
    if (!editId || isSubmitting) return;
    if (!window.confirm('Удалить вариант? Действие необратимо.')) return;
    setIsSubmitting(true);
    try {
      await deleteMockExamVariant(editId);
      invalidateVariantCaches();
      toast.success('Вариант удалён');
      navigate('/tutor/mock-exams/new', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось удалить вариант');
      setIsSubmitting(false);
    }
  }, [editId, isSubmitting, invalidateVariantCaches, navigate]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (isEditMode && detailLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isEditMode && (detailError || !detail)) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <p className="text-sm text-muted-foreground">Не удалось загрузить вариант.</p>
        <Button variant="outline" onClick={() => navigate('/tutor/mock-exams/new')}>
          К назначению пробника
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground" aria-label="Хлебные крошки">
        <Link
          to="/tutor/mock-exams/new"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Назначить пробник
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">{isEditMode ? 'Редактировать вариант' : 'Свой вариант'}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isEditMode ? 'Редактировать вариант' : 'Создать свой вариант'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Часть 1 проверяется автоматически, Часть 2 — AI-черновик с вашим подтверждением
        </p>
      </div>

      {inUse ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-[240px]">
            Вариант уже назначен ученикам — состав задач и параметры заморожены (ученики должны видеть то, что проверялось). Можно менять только название.
          </span>
          <Button size="sm" variant="outline" onClick={() => void handleDuplicate()} disabled={isDuplicating} className="gap-1.5">
            {isDuplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            Дублировать
          </Button>
        </div>
      ) : null}

      {/* Мета */}
      <Card animate={false}>
        <CardContent className="p-5 space-y-3">
          <div>
            <Label htmlFor="variant-title" className="mb-1 block text-xs font-semibold text-slate-500">
              Название варианта <span className="text-red-500">*</span>
            </Label>
            <Input
              id="variant-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Тренировочный вариант — механика"
              maxLength={200}
              className="text-base"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <Label className="mb-1 block text-xs font-semibold text-slate-500">Предмет</Label>
              <select
                value={subject}
                disabled={contentLocked}
                onChange={(e) => setSubject(e.target.value)}
                className={INPUT_CLASS}
                aria-label="Предмет варианта"
              >
                {SUBJECTS.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs font-semibold text-slate-500">Экзамен</Label>
              <select
                value={exam}
                disabled={contentLocked}
                onChange={(e) => setExam(e.target.value as 'ege' | 'oge')}
                className={INPUT_CLASS}
                aria-label="Экзамен"
              >
                <option value="ege">ЕГЭ</option>
                <option value="oge">ОГЭ</option>
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs font-semibold text-slate-500">Длительность, мин</Label>
              <input
                type="text"
                inputMode="numeric"
                value={durationText}
                disabled={contentLocked}
                onChange={(e) => setDurationText(e.target.value.replace(/\D/g, ''))}
                className={INPUT_CLASS}
                aria-label="Длительность в минутах"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI-загрузка задач из PDF/фото — shared loader (destination mock_variant).
          Задачи распределяются по частям автоматически (физика КИМ 21-26 → Ч2). */}
      {!contentLocked ? (
        <Button
          variant="outline"
          onClick={() => setAiLoaderOpen(true)}
          disabled={isSubmitting}
          className="gap-2 w-full border-dashed"
        >
          <Sparkles className="h-4 w-4" />
          Загрузить задачи из файла (AI)
        </Button>
      ) : null}

      {/* Часть 1 */}
      <Card animate={false}>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Часть 1 · авто-проверка{part1Tasks.length > 0 ? ` · ${part1Tasks.length} задач` : ''}
            </p>
          </div>
          {part1Tasks.map((t, i) => (
            <VariantTaskCard
              key={t.localId}
              draft={t}
              index={i}
              disabled={contentLocked || isSubmitting}
              duplicateKim={duplicateKims.has(t.kimNumber.trim()) && t.kimNumber.trim() !== ''}
              onUpdate={updateTask}
              onRemove={removeTask}
            />
          ))}
          <Button variant="outline" onClick={addPart1} disabled={contentLocked || isSubmitting} className="gap-2 w-full">
            <Plus className="h-4 w-4" />
            Задача Части 1
          </Button>
        </CardContent>
      </Card>

      {/* Часть 2 */}
      <Card animate={false}>
        <CardContent className="p-5 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Часть 2 · развёрнутые решения{part2Tasks.length > 0 ? ` · ${part2Tasks.length} задач` : ''}
          </p>
          {part2Tasks.map((t, i) => (
            <VariantTaskCard
              key={t.localId}
              draft={t}
              index={part1Tasks.length + i}
              disabled={contentLocked || isSubmitting}
              duplicateKim={duplicateKims.has(t.kimNumber.trim()) && t.kimNumber.trim() !== ''}
              onUpdate={updateTask}
              onRemove={removeTask}
            />
          ))}
          <Button variant="outline" onClick={addPart2} disabled={contentLocked || isSubmitting} className="gap-2 w-full">
            <Plus className="h-4 w-4" />
            Задача Части 2
          </Button>
        </CardContent>
      </Card>

      <MockExamAiLoaderSheet
        open={aiLoaderOpen}
        onOpenChange={setAiLoaderOpen}
        subject={subject}
        onAddTasks={appendDrafts}
      />

      {/* Итог + CTA */}
      <div className="sticky bottom-0 -mx-1 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {part1Tasks.length + part2Tasks.length} задач · макс. {totalMax} баллов
          </p>
          <div className="ml-auto flex items-center gap-2">
            {isEditMode && !inUse ? (
              <Button variant="ghost" onClick={() => void handleDelete()} disabled={isSubmitting} className="gap-1.5 text-slate-500 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
                Удалить
              </Button>
            ) : null}
            <Button onClick={() => void handleSubmit()} disabled={isSubmitting} className="gap-2 min-w-[180px]">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEditMode ? 'Сохранить' : 'Создать вариант'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TutorMockExamVariantEditor() {
  return (
    <MockExamFeatureGate>
      <VariantEditorContent />
    </MockExamFeatureGate>
  );
}
