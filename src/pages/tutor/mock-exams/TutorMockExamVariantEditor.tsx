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
  getMockExamVariantListening,
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
  reclassifyDraftsForSubjectExam,
  rowToDraft,
  type VariantTaskDraft,
} from '@/components/tutor/mock-exams/variantTaskDraft';
import { MockExamAiLoaderSheet } from '@/components/tutor/mock-exams/MockExamAiLoaderSheet';
import {
  TaskBlocksSection,
  blockDisplayTitle,
  type TaskBlockDraft,
} from '@/components/tutor/mock-exams/TaskBlocksSection';
import { SubjectSelect } from '@/components/tutor/SubjectSelect';
import { getSubjectLabel } from '@/types/homework';
import { subjectRequiresCefr } from '@/lib/subjects/registry';
import { getExamProfile } from '@/lib/examProfiles';
import {
  resolveTutorDefaultExamEgeOge,
  resolveTutorDefaultSubject,
  saveExamLastUsed,
} from '@/lib/tutorSubjects';
import { useTutorProfile } from '@/hooks/useTutorProfile';
import { cn } from '@/lib/utils';

// ─── Constants ───────────────────────────────────────────────────────────────

const CHECK_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: 'strict', label: 'Точное совпадение (число / слово)' },
  { value: 'ordered', label: 'Последовательность цифр — порядок важен' },
  { value: 'ordered_lenient', label: 'Последовательность — 1 ошибка/лишняя позиция = 1 балл' },
  { value: 'unordered', label: 'Набор цифр — порядок неважен' },
  { value: 'multi_choice', label: 'Выбор нескольких — физика (замена цифры = 1 балл)' },
  { value: 'multi_choice_strict', label: 'Выбор нескольких — обществознание (замена = 0)' },
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
  blockLabel,
  onUpdate,
  onRemove,
}: {
  draft: VariantTaskDraft;
  index: number;
  disabled: boolean;
  /** true = № КИМ конфликтует с другой задачей (live-подсветка). */
  duplicateKim: boolean;
  /** Read-only бейдж блока; правится чипами в секции блоков (один источник). */
  blockLabel: string | null;
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
      {blockLabel ? (
        <p className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
          Блок: {blockLabel}
        </p>
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
  // Дефолт предмета (Ф2, был хардкод physics — вариант обществоведа стартовал
  // физикой): корзина Базы → профиль репетитора → physics. Кэш профиля тёплый
  // (SideNav держит app-wide ключ) → init обычно синхронный.
  const { data: tutorProfile } = useTutorProfile();
  const [subject, setSubject] = useState(
    () => cartPrefill?.subject ?? resolveTutorDefaultSubject(tutorProfile?.subjects, null),
  );
  const subjectTouchedRef = useRef(false);
  const subjectAutoSetRef = useRef(false);
  // Ф3 (ревью 5.6 P1 №3): экзамен выбран руками → смена предмета/поздний
  // профиль его не пересчитывают.
  const examTouchedRef = useRef(false);
  // Холодный кэш профиля мог не успеть к useState-init (mirror InputStage):
  // one-shot ре-дефолт, когда профиль подъехал. Не клоббер: edit-prefill,
  // корзина и ручной выбор побеждают.
  useEffect(() => {
    if (subjectAutoSetRef.current) return;
    if (isEditMode || cartPrefill?.subject || subjectTouchedRef.current) return;
    const profs = tutorProfile?.subjects;
    if (!profs || profs.length === 0) return; // ждём профиль
    subjectAutoSetRef.current = true;
    const resolved = resolveTutorDefaultSubject(profs, null);
    if (resolved === subject && !examTouchedRef.current) {
      // Предмет не сменился, но exam-init мог пройти без exam_focus (холодный
      // кэш) → доводим экзамен уже с картой фокусов (ревью 5.6 P1 №3).
      setExam(
        resolveTutorDefaultExamEgeOge(resolved, tutorProfile?.exam_focus_by_subject) ?? 'ege',
      );
    }
    if (resolved !== subject) {
      setSubject(resolved);
      // Ревью P2-4: exam был вычислен для прежнего предмета — пересчитать.
      setExam(
        resolveTutorDefaultExamEgeOge(resolved, tutorProfile?.exam_focus_by_subject) ?? 'ege',
      );
    }
  }, [tutorProfile, isEditMode, cartPrefill, subject]);
  // Ф3 (2026-07-23): дефолт экзамена — из экзамен-фокуса предмета (prefill-only;
  // непригодный фокус → last-used → 'ege'; edit-prefill перезапишет из
  // detail.variant.exam_type как раньше).
  const [exam, setExam] = useState<'ege' | 'oge'>(() => {
    const s = cartPrefill?.subject ?? resolveTutorDefaultSubject(tutorProfile?.subjects, null);
    return resolveTutorDefaultExamEgeOge(s, tutorProfile?.exam_focus_by_subject) ?? 'ege';
  });
  // Ревью 5.6 P1 #1: стартовая длительность — из ExamProfile (предмет × экзамен),
  // а не жёсткие физические 235. Раньше новый вариант обществознания сохранял
  // 3ч55м (репорт Милады), и read-side фолбэк на профиль не срабатывал никогда —
  // в БД лежало «валидное» чужое значение. `durationTouchedRef` фиксирует ручную
  // правку: после неё смена предмета/экзамена поле не трогает.
  const durationTouchedRef = useRef(false);
  const [durationText, setDurationText] = useState(() => {
    const s = cartPrefill?.subject ?? resolveTutorDefaultSubject(tutorProfile?.subjects, null);
    const e = resolveTutorDefaultExamEgeOge(s, tutorProfile?.exam_focus_by_subject) ?? 'ege';
    // 235 — общий фолбэк, когда профиля нет / длительность не подтверждена предметником.
    return String(getExamProfile(s, e)?.durationMinutes ?? 235);
  });
  const [part1Tasks, setPart1Tasks] = useState<VariantTaskDraft[]>(
    () => cartPrefill?.drafts.filter((d) => d.part === 1) ?? [],
  );
  const [part2Tasks, setPart2Tasks] = useState<VariantTaskDraft[]>(
    () => cartPrefill?.drafts.filter((d) => d.part === 2) ?? [],
  );
  // Аудирование (2026-07-31): storage:// ref трека + ручной транскрипт.
  // Легаси variant-level модель — читается для обратной совместимости и
  // нормализуется в блок при prefill; новые сохранения пишут только блоки.
  const [listeningAudioRef, setListeningAudioRef] = useState<string | null>(null);
  const [listeningTranscript, setListeningTranscript] = useState('');
  // Блоки заданий (2026-08-01): общий материал + привязка вопросов.
  const [blocks, setBlocks] = useState<TaskBlockDraft[]>([]);
  // CAS-ревизия загруженного варианта (P0-4/P0-5 ревью 5.6): уходит обратно
  // при сохранении, сервер сверяет. Вкладка с устаревшим снимком получит 409
  // вместо тихой перезаписи чужих правок и потери привязок блоков.
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
  // Data-loss гард: в edit-режиме транскрипт приходит ОТДЕЛЬНЫМ edge-запросом
  // (column-GRANT 20260731190000 закрыл его от PostgREST). Пока запрос не
  // resolve'нулся (или упал): textarea disabled, а save шлёт undefined
  // («не менять»), НЕ '' — иначе сбой prefill-фетча молча стирал бы
  // сохранённый транскрипт.
  const [transcriptReady, setTranscriptReady] = useState(!isEditMode);
  // Ревью 5.6 P0 (HZ-4): upload аудио (1-3 мин) должен блокировать Save —
  // иначе «Сохранить» посреди загрузки подтверждает вариант без трека.
  // P0-2 ревью 5.6: параллельные загрузки треков. Один boolean ломался —
  // короткий файл завершался первым и разблокировал «Сохранить», пока два
  // других ещё грузились; их поздние storage-ref не попадали никуда.
  // Множество активных ключей: Save открыт только когда оно пусто.
  const [uploadingBlocks, setUploadingBlocks] = useState<Set<string>>(() => new Set());
  const audioUploading = uploadingBlocks.size > 0;
  const handleUploadingChange = useCallback((key: string, uploading: boolean) => {
    setUploadingBlocks((prev) => {
      const next = new Set(prev);
      if (uploading) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
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
    setListeningAudioRef(detail.variant.listening_audio_url ?? null);
    setLoadedRevision(detail.variant.content_revision ?? null);
    const savedBlocks = detail.variant.task_blocks_json ?? null;
    // Транскрипт — отдельным edge-запросом (см. transcriptReady-гард).
    void getMockExamVariantListening(editId!)
      .then((res) => {
        setListeningTranscript(res.listening_transcript ?? '');
        const transcripts = res.block_transcripts ?? {};
        if (savedBlocks && savedBlocks.length > 0) {
          setBlocks(savedBlocks.map((b) => ({
            id: b.id,
            title: b.title ?? '',
            instruction: b.instruction ?? '',
            imageUrl: b.image_url ?? null,
            audioUrl: b.audio_url ?? null,
            transcript: transcripts[b.id] ?? '',
          })));
        } else if (detail.variant.listening_audio_url) {
          // Легаси variant-level трек → синтетический блок без привязок.
          // Без привязок = общий плеер над Частью 1, то есть ровно прежнее
          // поведение: репетитору ничего перенастраивать не нужно.
          setBlocks([{
            id: 'legacy',
            title: 'Аудирование',
            instruction: '',
            imageUrl: null,
            audioUrl: detail.variant.listening_audio_url,
            transcript: res.listening_transcript ?? '',
          }]);
        }
        setTranscriptReady(true);
      })
      .catch(() => {
        // Гард остаётся false → поле disabled, save не тронет сохранённый транскрипт.
        // Ревью 5.6 (гипотеза 3): без «Повторить» это тупик до перезагрузки —
        // секция блоков заморожена целиком, а причина сбоя обычно сетевая.
        toast.error(
          'Не удалось загрузить транскрипт аудирования — блоки временно заморожены, при сохранении они не изменятся',
          {
            duration: 15000,
            action: { label: 'Повторить', onClick: () => window.location.reload() },
          },
        );
      });
  }, [isEditMode, detail, editId]);

  // Длительность следует за профилем, пока репетитор не правил поле руками.
  // В edit-режиме молчим — там истина в сохранённом варианте (prefill выше).
  useEffect(() => {
    if (isEditMode || durationTouchedRef.current) return;
    const profileDuration = getExamProfile(subject, exam)?.durationMinutes;
    if (profileDuration != null) setDurationText(String(profileDuration));
  }, [subject, exam, isEditMode]);

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

  // Ревью 5.6 P1 #2 (остаток): смена предмета/экзамена в шапке переклассифицирует
  // уже добавленные задачи (формат проверки + балл ФИПИ Части 1) — у каждого
  // предмета свои критерии. Вызывается ТОЛЬКО из пользовательского onChange
  // селектора (не эффект — иначе затрёт edit-prefill/поздний автодефолт). Читает
  // массивы из scope: onChange единичный, гонки нет.
  const reclassifyTasks = useCallback(
    (nextSubject: string, nextExam: '' | 'ege' | 'oge') => {
      const r1 = reclassifyDraftsForSubjectExam(part1Tasks, nextSubject, nextExam);
      const r2 = reclassifyDraftsForSubjectExam(part2Tasks, nextSubject, nextExam);
      const changed = r1.changed + r2.changed;
      if (changed === 0) return;
      setPart1Tasks(r1.drafts);
      setPart2Tasks(r2.drafts);
      toast.info(
        `Обновили формат проверки и баллы у ${changed} задан${changed === 1 ? 'ия' : 'ий'} под «${getSubjectLabel(nextSubject)}» — критерии ФИПИ у предметов отличаются. Проверьте перед сохранением.`,
      );
    },
    [part1Tasks, part2Tasks],
  );

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
        block_id: t.blockId,
      });
    }
    return payload;
  }, [part1Tasks, part2Tasks, duplicateKims]);

  // Чипы привязки показывают ВСЕ задачи варианта: блок-документ бывает и у
  // задачи Части 2 (эссе по прочитанному тексту), не только у аудирования.
  const allTasks = useMemo(() => [...part1Tasks, ...part2Tasks], [part1Tasks, part2Tasks]);

  // Этап 0 блоков (решение владельца 2026-08-02, docs/delivery/features/
  // task-blocks/research.md §2.7): секция доступна ВСЕМ предметам — паттерн
  // «общий материал + группа вопросов» есть почти во всех КИМ (химия №29–30,
  // обществознание №17–20, русский №23–27, история 9–12…), а не только в
  // языках. Прежний языковой гейт заменён ДВУМЯ состояниями: чтобы не засорять
  // редактор тем, кто блоками не пользуется, по умолчанию секция свёрнута в
  // одну compact-строку; развёрнута — у иностранных языков (КАНОНИЧЕСКИЙ
  // предикат `subjectRequiresCefr`, AGENTS.md: никаких локальных
  // ['french','english',…] — расхождение списков уже ломало создание ДЗ) и
  // ВСЕГДА при уже заведённых блоках: если блоки есть, а предмет сменили,
  // секция обязана остаться видимой — иначе контент становится недостижимым,
  // а сохранение молча уносит его вместе с привязками.
  const [blocksManuallyOpened, setBlocksManuallyOpened] = useState(false);
  const blocksExpanded =
    blocksManuallyOpened || subjectRequiresCefr(subject) || blocks.length > 0;

  // Бейдж на карточке задачи — READ-ONLY: привязка правится в ОДНОМ месте,
  // чипами внутри блока. Второй редактируемый контрол на ту же связь дал бы
  // два источника истины и «почему тут пусто, а там выбрано».
  const blockLabelFor = useCallback((blockId: string | null): string | null => {
    if (!blockId) return null;
    const index = blocks.findIndex((b) => b.id === blockId);
    return index < 0 ? null : blockDisplayTitle(blocks[index], index);
  }, [blocks]);

  const handleBindTaskToBlock = useCallback((taskLocalId: string, blockId: string | null) => {
    const patch = (list: VariantTaskDraft[]) =>
      list.map((t) => (t.localId === taskLocalId ? { ...t, blockId } : t));
    setPart1Tasks(patch);
    setPart2Tasks(patch);
  }, []);

  // Блоки → две части проводного контракта. Транскрипты уходят ОТДЕЛЬНЫМ
  // объектом, потому что в БД это отдельная колонка без column-GRANT'а
  // (транскрипт = ответы аудирования, rule 45). Не схлопывать.
  const buildBlocksPayload = useCallback(() => {
    const task_blocks = blocks.map((b) => ({
      id: b.id,
      title: b.title.trim(),
      instruction: b.instruction.trim(),
      image_url: b.imageUrl,
      audio_url: b.audioUrl,
    }));
    const block_transcripts: Record<string, string> = {};
    for (const b of blocks) {
      const value = b.transcript.trim();
      if (value) block_transcripts[b.id] = value;
    }
    return { task_blocks, block_transcripts };
  }, [blocks]);

  const invalidateVariantCaches = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: MOCK_EXAM_VARIANTS_KEY });
    if (editId) {
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'mock-exams', 'variant', editId] });
    }
  }, [queryClient, editId]);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    // Ревью 5.6 P0 (HZ-4): обязательный гард — Save во время upload аудио
    // сохранил бы вариант со старым/пустым ref, а завершившаяся позже
    // загрузка уже никуда не попала бы (тихий data-loss трека).
    if (audioUploading) {
      toast.error('Дождитесь окончания загрузки аудио — иначе трек не попадёт в вариант');
      return;
    }
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
          listening_audio_url: listeningAudioRef,
          listening_transcript: listeningTranscript.trim() || null,
          ...buildBlocksPayload(),
        });
        // Ф3: пер-предметный last-used экзамена (дефолт следующего create).
        saveExamLastUsed(subject, exam);
        invalidateVariantCaches();
        // Deploy-skew handshake (ревью 5.6 P0): listening-поля отправлены, но
        // маркер не пришёл = старый edge их проигнорировал — честно сказать,
        // а не показать success с потерянным треком.
        // Блоки едут под тем же handshake: старый edge их МОЛЧА игнорирует
        // (в create/replace нет unknown-key гарда), и без этого условия
        // потерянные блоки не дали бы ни ошибки, ни маркера.
        const sentListening =
          Boolean(listeningAudioRef || listeningTranscript.trim()) || blocks.length > 0;
        if (sentListening && !created.block_fields_applied) {
          toast.error(
            'Вариант создан, но аудио/транскрипт НЕ сохранились — сервер ещё обновляется. Откройте вариант и прикрепите аудио повторно чуть позже.',
            { duration: 10000 },
          );
        } else {
          toast.success('Вариант создан — теперь его можно назначить ученикам');
        }
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
      // Sync-гард пары (ревью 5.6 P1): при !transcriptReady заморожены ОБА
      // listening-поля (UI disabled) — не шлём ни аудио, ни транскрипт,
      // сохранённая пара остаётся согласованной.
      const replaceRes = await replaceMockExamVariantTasks(editId!, tasksPayload, {
        title: trimmedTitle,
        subject,
        exam,
        duration_minutes: duration,
        // Тристейт edge: '' = очистить (трек убран), строка = новое значение,
        // undefined = не менять.
        ...(transcriptReady
          ? {
              listening_audio_url: listeningAudioRef ?? '',
              listening_transcript: listeningTranscript.trim(),
              // Блоки под тем же гардом: их транскрипты приходят тем же
              // prefill-запросом, значит и замораживаются вместе с ним.
              ...buildBlocksPayload(),
            }
          : {}),
        ...(loadedRevision !== null ? { expected_revision: loadedRevision } : {}),
      });
      invalidateVariantCaches();
      // Deploy-skew handshake (ревью 5.6 P0) — mirror create-путь.
      const sentListeningOnReplace =
        transcriptReady &&
        (Boolean(listeningAudioRef || listeningTranscript.trim()) || blocks.length > 0);
      if (sentListeningOnReplace && !replaceRes.block_fields_applied) {
        toast.error(
          'Задачи сохранены, но аудио/транскрипт НЕ сохранились — сервер ещё обновляется. Повторите сохранение чуть позже.',
          { duration: 10000 },
        );
      } else {
        toast.success('Вариант сохранён');
      }
    } catch (err) {
      // VARIANT_STALE (P0-4/P0-5 ревью 5.6): другая вкладка успела сохранить
      // вариант. Обычный toast тут мало — репетитор не должен продолжать
      // печатать в форму, которая гарантированно не сохранится.
      if (err instanceof MockExamApiError && err.code === 'VARIANT_STALE') {
        toast.error(err.message, {
          duration: 15000,
          action: { label: 'Обновить', onClick: () => window.location.reload() },
        });
        return;
      }
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
    listeningAudioRef,
    listeningTranscript,
    blocks,
    transcriptReady,
    audioUploading,
    loadedRevision,
    buildTasksPayload,
    buildBlocksPayload,
    invalidateVariantCaches,
    navigate,
  ]);

  const handleDuplicate = useCallback(async () => {
    if (!editId || isDuplicating) return;
    setIsDuplicating(true);
    try {
      const res = await duplicateMockExamVariant(editId);
      invalidateVariantCaches();
      // P1-2 ревью 5.6: у каталожного источника аудио скопировать нельзя
      // (blob в чужом namespace). Молчать об этом нельзя — репетитор назначил
      // бы копию, а ученик открыл аудирование без единого трека.
      if (res.dropped_audio_count) {
        toast.warning(
          `Копия создана, но аудио не скопировалось (${res.dropped_audio_count}) — каталожные треки принадлежат автору варианта. Загрузите записи в блоки заново.`,
          { duration: 12000 },
        );
      } else {
        toast.success('Копия создана — правьте её свободно');
      }
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
              <Label htmlFor="variant-subject" className="mb-1 block text-xs font-semibold text-slate-500">Предмет</Label>
              <SubjectSelect
                id="variant-subject"
                value={subject}
                disabled={contentLocked}
                onChange={(v) => {
                  subjectTouchedRef.current = true;
                  // Ф3 (ревью 5.6 P1 №3): экзамен не трогали (и не edit) →
                  // пересчёт под новый предмет — stale ЕГЭ прежнего предмета
                  // не должен молча уезжать в вариант и его last-used.
                  const nextExam =
                    !isEditMode && !examTouchedRef.current
                      ? resolveTutorDefaultExamEgeOge(v, tutorProfile?.exam_focus_by_subject) ?? 'ege'
                      : exam;
                  setSubject(v);
                  if (nextExam !== exam) setExam(nextExam);
                  reclassifyTasks(v, nextExam);
                }}
                className={cn(INPUT_CLASS, 'w-full')}
                profileSubjects={tutorProfile?.subjects}
                overrideTracking={isEditMode ? undefined : { surface: 'mock_exam' }}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs font-semibold text-slate-500">Экзамен</Label>
              <select
                value={exam}
                disabled={contentLocked}
                onChange={(e) => {
                  examTouchedRef.current = true;
                  const nextExam = e.target.value as 'ege' | 'oge';
                  setExam(nextExam);
                  reclassifyTasks(subject, nextExam);
                }}
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
                onChange={(e) => {
                  durationTouchedRef.current = true;
                  setDurationText(e.target.value.replace(/\D/g, ''));
                }}
                className={INPUT_CLASS}
                aria-label="Длительность в минутах"
              />
            </div>
          </div>
          {/* Ф6 (2026-07-23): честная пометка вместо тихих дефолтов — для
              предмета×экзамена нет карты ФИПИ (ExamProfile registry): баллы и
              режимы проверки Части 1 заполняются вручную. */}
          {getExamProfile(subject, exam) === null ? (
            <p className="mt-3 text-xs text-slate-500">
              Для «{getSubjectLabel(subject)}» ({exam === 'ege' ? 'ЕГЭ' : 'ОГЭ'}) карта
              баллов и режимов ФИПИ не заведена — баллы и режимы проверки задайте вручную.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Блоки заданий (2026-08-01): общий материал (текст / фото / аудиотрек)
          + привязанные вопросы. Обобщение variant-level трека 31.07 — у DELF
          каждый exercice свой документ, а на чтении общая преамбула иначе
          дублируется в каждый вопрос руками.
          Content-мета — заморожена вместе с задачами у назначенного варианта.
          Sync-гард пары (ревью 5.6 P1): пока prefill транскриптов не подъехал,
          секция заморожена целиком — save тогда не шлёт блоки вообще, и
          сохранённая пара «трек ↔ транскрипт» остаётся согласованной. */}
      {blocksExpanded ? (
      <TaskBlocksSection
        blocks={blocks}
        tasks={allTasks}
        disabled={contentLocked || isSubmitting || !transcriptReady}
        transcriptDisabled={contentLocked || isSubmitting || !transcriptReady}
        onBlocksChange={setBlocks}
        onBindTask={handleBindTaskToBlock}
        onUploadingChange={handleUploadingChange}
      />
      ) : !contentLocked ? (
        // Compact-состояние: одна строка вместо целой секции (Этап 0).
        // У заблокированного варианта без блоков строку не показываем —
        // развернуть можно, а сделать внутри ничего нельзя.
        <button
          type="button"
          onClick={() => setBlocksManuallyOpened(true)}
          disabled={isSubmitting}
          className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-left transition-colors hover:border-accent/40 disabled:opacity-50 [touch-action:manipulation]"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Plus className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            Блоки заданий: общий материал для нескольких вопросов
          </span>
          <span className="mt-0.5 block pl-6 text-xs text-slate-500">
            Текст, документ или аудио пишутся один раз — например, перечень веществ
            для №29–30 (химия) или текст для №17–20 (обществознание).
          </span>
        </button>
      ) : null}

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
              blockLabel={blockLabelFor(t.blockId)}
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
              blockLabel={blockLabelFor(t.blockId)}
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
              <Button variant="ghost" onClick={() => void handleDelete()} disabled={isSubmitting || audioUploading} className="gap-1.5 text-slate-500 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
                Удалить
              </Button>
            ) : null}
            {/* Ревью 5.6 P0 (HZ-4): disabled на upload аудио — дублирует гард
                в handleSubmit (кнопка = видимый сигнал, гард = авторитет). */}
            <Button onClick={() => void handleSubmit()} disabled={isSubmitting || audioUploading} className="gap-2 min-w-[180px]">
              {isSubmitting || audioUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {audioUploading ? 'Загружаем аудио…' : isEditMode ? 'Сохранить' : 'Создать вариант'}
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
