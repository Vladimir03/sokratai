// Mock Exams v1 — TASK-9: tutor create wizard.
//
// Job: R1 (быстро назначить пробник за <2 минуты).
// AC-1: assignment + N attempts created в БД.
// Spec: docs/delivery/features/mock-exams-v1/spec.md §3 (бланк-режим default)
// Mockup: SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 2)
//
// Single-page wizard, 4 шага:
//   1. Вариант — Тренировочный 1 selected by default (Phase 1: 1 variant only)
//   2. Режим — blank / form (radio)
//   3. Кому — groups + individuals (checkboxes)
//   4. Параметры — title + deadline (datetime-local) + опц. lead-link
//
// Анти-патерны исключены (см. .claude/rules/90-design-system.md):
//   • Lucide icons only (нет emoji)
//   • shadcn Card / Button / Badge / Input / Label / Checkbox
//   • text-base (16px) на all inputs (iOS Safari auto-zoom prevention)
//   • Mobile-responsive (375px+): action bar collapses, recipient list scrolls

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { parseISO, isValid } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  GraduationCap,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateTimeField } from '@/components/ui/date-time-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { MockExamFeatureGate } from './MockExamFeatureGate';
import { MockExamVariantPreviewSheet } from '@/components/tutor/mock-exams/MockExamVariantPreviewSheet';
import { LeadLinkSuccessDialog } from '@/components/tutor/mock-exams/LeadLinkSuccessDialog';
import {
  createMockExamAssignment,
  createMockExamInviteLink,
  duplicateMockExamVariant,
  MockExamApiError,
} from '@/lib/mockExamApi';
import { useTutorStudents, useTutor, useTutorGroups } from '@/hooks/useTutor';
import {
  MOCK_EXAM_VARIANTS_KEY,
  useMockExamVariants,
  type MockExamVariantSummary,
} from '@/hooks/useMockExamVariants';
import { useQueryClient } from '@tanstack/react-query';
import type { TutorStudentWithProfile } from '@/types/tutor';
import type { MockExamMode } from '@/types/mockExam';
import { getSubjectLabel } from '@/types/homework';
import { cn } from '@/lib/utils';

// ─── Variant catalogue (Фаза 2, 2026-07-20: динамический) ────────────────────
// Хардкод VARIANT_LIBRARY заменён на useMockExamVariants (PostgREST под RLS
// «каталог ∪ мои», миграция 20260720170000). Репетитор видит две группы:
// «Мои варианты» (owner_id = я; Редактировать / Дублировать) и «Каталог»
// (Дублировать / Превью). ФИПИ-заглушка осталась статикой.

const DEFAULT_TITLE = 'Пробник';

const FIPI_PLACEHOLDER = {
  id: 'fipi-demo-2026-placeholder',
  title: 'Демоверсия ФИПИ-2026',
  attribution: 'Источник: ФИПИ',
  meta: 'Добавим позже',
  isAvailable: false,
  badge: 'скоро',
} as const;

function formatVariantDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

function formatVariantMeta(v: MockExamVariantSummary): string {
  return `${v.task_count} заданий · макс. ${v.total_max_score} баллов · ${formatVariantDuration(v.duration_minutes)}`;
}

function variantAttribution(v: MockExamVariantSummary): string {
  const subjectLabel = getSubjectLabel(v.subject ?? 'physics');
  const examLabel = v.exam_type.startsWith('oge') ? 'ОГЭ' : 'ЕГЭ';
  const source = v.owner_id !== null
    ? 'Ваш вариант'
    : v.source_attribution ?? 'Каталог Сократа';
  return `${subjectLabel} · ${examLabel} · ${source}`;
}

/** Дефолтный заголовок пробника для выбранного варианта. */
function variantDefaultTitle(v: MockExamVariantSummary | undefined): string {
  return v ? `Пробник ${v.title}`.slice(0, 200) : DEFAULT_TITLE;
}
const DURATION_HINT = 'Стандартный пробник занимает 3 ч 55 мин';

// ─── Mode options ────────────────────────────────────────────────────────────

interface ModeOption {
  value: Exclude<MockExamMode, 'manual_entry'>;
  label: string;
  description: string;
  isDefault?: boolean;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: 'blank',
    label: 'С бланком ЕГЭ',
    description:
      'Ученик распечатывает PDF бланка, заполняет ручкой и параллельно вводит ответы Части 1 в форму на сайте. AI авто-проверяет Часть 1, делает черновик Части 2. Фото бланка хранится как proof.',
    isDefault: true,
  },
  {
    value: 'form',
    label: 'Стандартный (форма)',
    description:
      'Ученик заполняет ответы Части 1 в форме на сайте, AI авто-проверяет. Часть 2 — фото решений, AI делает черновик. Подходит, если ученик не может распечатать бланк.',
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStudentDisplayName(student: TutorStudentWithProfile): string {
  return (
    student.display_name?.trim() ||
    student.profiles?.username?.trim() ||
    'Ученик'
  );
}

function getStudentSubline(student: TutorStudentWithProfile): string {
  const grade = student.profiles?.grade ? `${student.profiles.grade} класс` : '';
  const examType = student.exam_type === 'ege' ? 'ЕГЭ' : student.exam_type === 'oge' ? 'ОГЭ' : '';
  return [grade, examType].filter(Boolean).join(' · ');
}

/**
 * Parse the datetime-local string into ISO 8601 (UTC).
 * Returns null if value is empty (no deadline) or unparseable.
 * Throws human-readable error if past — caller surfaces via toast.
 */
function parseDeadlineInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // datetime-local gives 'YYYY-MM-DDTHH:mm' — parseISO handles it.
  const parsed = parseISO(trimmed);
  if (!isValid(parsed)) {
    throw new Error('Неверный формат даты. Пример: 2026-05-14 23:59');
  }
  if (parsed.getTime() < Date.now()) {
    throw new Error('Дедлайн в прошлом — выбери будущую дату');
  }
  return parsed.toISOString();
}

function pluralStudents(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ученику';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'ученикам';
  return 'ученикам';
}

async function tryCopyLink(url: string): Promise<void> {
  // Primary: Async Clipboard API (requires secure context — HTTPS or localhost).
  // Fallback: legacy document.execCommand('copy') через скрытый textarea —
  // нужен для http preview и Safari < 15.4. См. .claude/rules/80-cross-browser.md.
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(url);
      return;
    } catch {
      // fall through to legacy fallback
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  } catch {
    // best-effort — user can copy from toast description manually
  }
}

// ─── Variant card (step 1) ───────────────────────────────────────────────────

interface VariantCardProps {
  title: string;
  attribution: string;
  meta: string;
  badge: string;
  isAvailable: boolean;
  isSelected: boolean;
  onSelect?: () => void;
  onPreview?: () => void;
  /** Фаза 2: действия карточки (Редактировать/Дублировать) — ряд с превью. */
  actions?: React.ReactNode;
}

const VariantCard = memo(function VariantCard({
  title,
  attribution,
  meta,
  badge,
  isAvailable,
  isSelected,
  onSelect,
  onPreview,
  actions,
}: VariantCardProps) {
  const selectable = isAvailable && !isSelected && Boolean(onSelect);
  return (
    <div
      className={cn(
        'rounded-lg border-2 p-4 transition-[border-color,background-color] duration-200 ease-out',
        isSelected && isAvailable && 'border-accent bg-accent/5',
        !isSelected && isAvailable && 'border-slate-200 hover:border-slate-300 cursor-pointer',
        !isAvailable && 'border-slate-200 opacity-60 cursor-not-allowed',
      )}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={selectable ? onSelect : undefined}
      onKeyDown={
        selectable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
      aria-pressed={isAvailable ? isSelected : undefined}
      aria-disabled={!isAvailable || undefined}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'h-10 w-10 rounded-md flex items-center justify-center flex-shrink-0',
            isSelected && isAvailable
              ? 'bg-accent text-white'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
          )}
          aria-hidden="true"
        >
          <GraduationCap className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <h3
              className={cn(
                'font-semibold text-base leading-snug',
                isAvailable
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {title}
            </h3>
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] uppercase tracking-wide font-medium border-transparent',
                isAvailable
                  ? 'bg-accent/10 text-accent'
                  : 'bg-slate-100 text-slate-500',
              )}
            >
              {badge}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{attribution}</p>
          <p className="text-xs text-muted-foreground/80 mt-0.5">{meta}</p>
          {isAvailable && (onPreview || actions) ? (
            <div
              className="mt-2 flex flex-wrap items-center gap-2"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {onPreview ? (
                <button
                  type="button"
                  onClick={onPreview}
                  className="inline-flex min-h-9 touch-manipulation items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-accent/40 hover:text-accent dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  aria-label="Посмотреть условия задач этого варианта"
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  Посмотреть условия задач
                </button>
              ) : null}
              {actions}
            </div>
          ) : null}
        </div>
        {isSelected && isAvailable && (
          <div
            className="text-accent flex-shrink-0"
            aria-label="Выбран"
            title="Выбран"
          >
            <Check className="h-5 w-5" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Step section wrapper ────────────────────────────────────────────────────

interface StepSectionProps {
  index: number;
  title: string;
  children: React.ReactNode;
}

function StepSection({ index, title, children }: StepSectionProps) {
  return (
    <Card animate={false}>
      <CardContent className="p-5 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Шаг {index} · {title}
        </p>
        {children}
      </CardContent>
    </Card>
  );
}

// ─── Mode option (step 2) ────────────────────────────────────────────────────

interface ModeRadioProps {
  option: ModeOption;
  isSelected: boolean;
  onSelect: (value: ModeOption['value']) => void;
}

const ModeRadio = memo(function ModeRadio({
  option,
  isSelected,
  onSelect,
}: ModeRadioProps) {
  const inputId = `mode-${option.value}`;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex items-start gap-3 p-3 rounded-md border-2 cursor-pointer transition-[border-color,background-color] duration-200 ease-out',
        isSelected
          ? 'border-accent bg-accent/5'
          : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
      )}
    >
      <input
        id={inputId}
        type="radio"
        name="mock-exam-mode"
        value={option.value}
        checked={isSelected}
        onChange={() => onSelect(option.value)}
        className="mt-1 h-4 w-4 accent-accent flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-slate-900 dark:text-slate-100">
            {option.label}
          </span>
          {option.isDefault && (
            <Badge
              variant="outline"
              className="bg-accent/10 text-accent border-transparent text-[10px] uppercase tracking-wide font-medium"
            >
              по умолчанию
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {option.description}
        </p>
      </div>
    </label>
  );
});

// ─── Recipient row (step 3) ──────────────────────────────────────────────────

interface RecipientRowProps {
  id: string;
  primary: string;
  secondary?: string;
  isSelected: boolean;
  isDisabled?: boolean;
  onToggle: (id: string, next: boolean) => void;
}

const RecipientRow = memo(function RecipientRow({
  id,
  primary,
  secondary,
  isSelected,
  isDisabled,
  onToggle,
}: RecipientRowProps) {
  const checkboxId = `recipient-${id}`;
  return (
    <label
      htmlFor={checkboxId}
      className={cn(
        'flex items-start gap-3 p-2.5 rounded-md transition-colors duration-150',
        isDisabled
          ? 'bg-slate-50 dark:bg-slate-900 opacity-60 cursor-not-allowed'
          : 'hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer',
      )}
    >
      <Checkbox
        id={checkboxId}
        checked={isSelected}
        disabled={isDisabled}
        onCheckedChange={(checked) =>
          onToggle(id, checked === true)
        }
        className="mt-1"
      />
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'font-medium text-sm',
            isDisabled
              ? 'text-slate-500 dark:text-slate-400'
              : 'text-slate-900 dark:text-slate-100',
          )}
        >
          {primary}
        </div>
        {secondary && (
          <div className="text-xs text-muted-foreground">{secondary}</div>
        )}
      </div>
    </label>
  );
});

// ─── Main wizard content ─────────────────────────────────────────────────────

function TutorMockExamCreateContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const { tutor } = useTutor();
  const miniGroupsEnabled = Boolean(tutor?.mini_groups_enabled);
  const { students, loading: studentsLoading } = useTutorStudents();
  const { groups, loading: groupsLoading } = useTutorGroups(miniGroupsEnabled);
  // Фаза 2: варианты из БД (каталог ∪ мои) вместо хардкода.
  const {
    variants,
    loading: variantsLoading,
    error: variantsError,
    refetch: refetchVariants,
  } = useMockExamVariants();

  // `?variant=` — deep-link из редактора варианта («Создать вариант» → сразу
  // выбран в списке). Пустая строка = ждём авто-выбор после загрузки списка.
  const [variantId, setVariantId] = useState<string>(() => searchParams.get('variant') ?? '');
  // TASK-11: mode чooser скрыт. Default 'form' — пробник создаётся в нейтральном
  // режиме, ученик выбирает blank/form сам на taking page. Tutor НЕ навязывает.
  // assignment.mode остаётся в схеме для manual_entry flow + backward compat.
  const [mode] = useState<Exclude<MockExamMode, 'manual_entry'>>('form');
  const [title, setTitle] = useState(DEFAULT_TITLE);
  // Текущий АВТО-заголовок: если поле всё ещё равно ему (тутор не правил) —
  // смена варианта подставляет новый дефолт (замена прежнего DEFAULT_TITLE_VALUES).
  const autoTitleRef = useRef<string>(DEFAULT_TITLE);
  const [deadlineInput, setDeadlineInput] = useState('');
  const [createLeadLink, setCreateLeadLink] = useState(false);
  // AC-P10 Phase 2 (PAUSE-7, 2026-05-25): default execution mode для new attempts.
  // Tutor recommendation — ученик может override в start modal (PAUSE-4).
  const [defaultExamMode, setDefaultExamMode] = useState<'training' | 'simulation'>(
    'training',
  );

  // Selected group ids (UI). Toggling a group expands/collapses its
  // active members in `selectedStudentIds`. Individual students can also
  // be toggled directly.
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
    new Set(),
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  // FIX-2: variant preview drawer.
  const [previewVariantId, setPreviewVariantId] = useState<string | null>(null);

  // Выбор варианта. Если репетитор не редактировал заголовок вручную (поле всё
  // ещё равно текущему авто-заголовку) — подставляем дефолт нового варианта.
  const applyAutoTitle = useCallback((variant: MockExamVariantSummary | undefined) => {
    const nextDefault = variantDefaultTitle(variant);
    setTitle((prev) =>
      prev.trim() === autoTitleRef.current || prev.trim() === '' ? nextDefault : prev,
    );
    autoTitleRef.current = nextDefault;
  }, []);

  const handleSelectVariant = useCallback(
    (nextId: string) => {
      setVariantId(nextId);
      applyAutoTitle(variants.find((v) => v.id === nextId));
    },
    [variants, applyAutoTitle],
  );

  // Авто-выбор после загрузки списка (один раз): `?variant=` из редактора →
  // иначе первый каталожный → иначе первый. Set-once ref — НЕ клоббер
  // (конвенция конструкторов: никаких эффектов, перетирающих выбор тутора).
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current || variantsLoading || variants.length === 0) return;
    autoSelectedRef.current = true;
    const requested = variantId ? variants.find((v) => v.id === variantId) : undefined;
    if (requested) {
      applyAutoTitle(requested);
      return;
    }
    const first = variants.find((v) => v.owner_id === null) ?? variants[0];
    setVariantId(first.id);
    applyAutoTitle(first);
  }, [variantsLoading, variants, variantId, applyAutoTitle]);

  // Дублировать вариант (каталожный или свой) → сразу в редактор копии.
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const handleDuplicateVariant = useCallback(
    async (id: string) => {
      if (duplicatingId) return;
      setDuplicatingId(id);
      try {
        const res = await duplicateMockExamVariant(id);
        void queryClient.invalidateQueries({ queryKey: MOCK_EXAM_VARIANTS_KEY });
        toast.success('Копия создана — правьте её свободно');
        navigate(`/tutor/mock-exams/variants/${res.variant_id}/edit`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось создать копию');
      } finally {
        setDuplicatingId(null);
      }
    },
    [duplicatingId, queryClient, navigate],
  );

  // FIX-4a: lead-link success dialog. После создания пробника+invite-link мы
  // навигируем на detail только когда репетитор закроет модалку (или нажмёт
  // «Перейти к пробнику»). До этого модалка показывает ссылку и copy button.
  const [leadLink, setLeadLink] = useState<{
    url: string;
    assignmentId: string;
    studentCount: number;
  } | null>(null);

  // Index: tutor_student_id → student_id (auth.users.id).
  // Backend API expects student_id (auth.users.id), but groups reference
  // tutor_student_id. Resolve via this map.
  const studentIdByTutorStudentId = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students) {
      map.set(s.id, s.student_id);
    }
    return map;
  }, [students]);

  const activeStudents = useMemo(
    () => students.filter((s) => s.status === 'active'),
    [students],
  );

  // ─── Group toggle: expands/collapses members ─────────────────────────────

  const handleGroupToggle = useCallback(
    (groupId: string, next: boolean) => {
      setSelectedGroupIds((prev) => {
        const updated = new Set(prev);
        if (next) updated.add(groupId);
        else updated.delete(groupId);
        return updated;
      });

      const group = groups.find((g) => g.id === groupId);
      if (!group) return;

      const memberStudentIds = group.members
        .filter((m) => m.is_active)
        .map((m) => studentIdByTutorStudentId.get(m.tutor_student_id))
        .filter((sid): sid is string => Boolean(sid));

      setSelectedStudentIds((prev) => {
        const updated = new Set(prev);
        if (next) {
          memberStudentIds.forEach((sid) => updated.add(sid));
        } else {
          memberStudentIds.forEach((sid) => updated.delete(sid));
        }
        return updated;
      });
    },
    [groups, studentIdByTutorStudentId],
  );

  const handleStudentToggle = useCallback(
    (studentId: string, next: boolean) => {
      setSelectedStudentIds((prev) => {
        const updated = new Set(prev);
        if (next) updated.add(studentId);
        else updated.delete(studentId);
        return updated;
      });
    },
    [],
  );

  // ─── Submit ──────────────────────────────────────────────────────────────

  const trimmedTitle = title.trim();
  const studentIds = useMemo(() => Array.from(selectedStudentIds), [selectedStudentIds]);

  const isValidForSubmit =
    !isSubmitting &&
    trimmedTitle.length > 0 &&
    studentIds.length > 0 &&
    Boolean(variantId);

  const handleSubmit = useCallback(async () => {
    if (!isValidForSubmit) return;

    let deadlineIso: string | null = null;
    try {
      deadlineIso = parseDeadlineInput(deadlineInput);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Неверный дедлайн');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createMockExamAssignment({
        variant_id: variantId,
        title: trimmedTitle,
        mode,
        deadline: deadlineIso,
        student_ids: studentIds,
        // AC-P10 Phase 2 (PAUSE-7): tutor recommendation для start modal.
        default_exam_mode: defaultExamMode,
      });

      const assignmentId = created.assignment_id;
      const studentCount = created.attempts_created ?? studentIds.length;

      toast.success(
        `Пробник назначен ${studentCount} ${pluralStudents(studentCount)}`,
      );

      // Optional lead-link. При успехе вместо toast'а показываем модалку с
      // явной ссылкой + copy button + объяснением — она НЕ автоматически
      // редиректит на detail, чтобы репетитор успел скопировать ссылку и
      // отправить её родителю/ученику. Закрытие модалки → navigate.
      if (createLeadLink) {
        try {
          const link = await createMockExamInviteLink(assignmentId, {});
          // Best-effort copy в буфер: модалка всё равно показывает ссылку,
          // если writeText заблокирован браузером.
          void tryCopyLink(link.url);
          setLeadLink({ url: link.url, assignmentId, studentCount });
          // НЕ navigate — это сделает onClose модалки.
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Не удалось создать lead-ссылку';
          toast.error(`Публичная ссылка не создана: ${msg}`);
          // Fallback: навигируем на detail без модалки — пробник уже создан.
        }
      }

      navigate(`/tutor/mock-exams/${assignmentId}`, { replace: true });
    } catch (err) {
      const msg =
        err instanceof MockExamApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : 'Не удалось назначить пробник';
      toast.error(msg);
      setIsSubmitting(false);
    }
  }, [
    isValidForSubmit,
    defaultExamMode,
    deadlineInput,
    variantId,
    trimmedTitle,
    mode,
    studentIds,
    createLeadLink,
    navigate,
  ]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Breadcrumb */}
      <nav
        className="flex items-center gap-2 text-sm text-muted-foreground"
        aria-label="Хлебные крошки"
      >
        <Link
          to="/tutor/mock-exams"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Пробники
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Назначить пробник</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Назначить пробник</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Готовый вариант от Егора · Часть 1 авто, Часть 2 AI-черновик с твоим подтверждением
        </p>
      </div>

      {/* Шаг 1 — Вариант (Фаза 2: динамический — «Мои» + «Каталог») */}
      <StepSection index={1} title="Вариант">
        {variantsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : variantsError && variants.length === 0 ? (
          // Ревью 5.6 P2 #9: ошибка загрузки НЕ маскируется под пустой каталог —
          // нейтральный текст (rule 95: без обвинения сети) + повтор.
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 text-center">
            <p className="text-sm text-muted-foreground">
              Не удалось загрузить варианты. Попробуйте ещё раз.
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetchVariants()}>
              Повторить
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {(() => {
              const myVariants = variants.filter((v) => v.owner_id !== null);
              const catalogVariants = variants.filter((v) => v.owner_id === null);
              const renderVariant = (variant: MockExamVariantSummary, isMine: boolean) => (
                <VariantCard
                  key={variant.id}
                  title={variant.title}
                  attribution={variantAttribution(variant)}
                  meta={formatVariantMeta(variant)}
                  badge={isMine ? 'Мой' : 'Каталог'}
                  isAvailable
                  isSelected={variantId === variant.id}
                  onSelect={() => handleSelectVariant(variant.id)}
                  onPreview={() => setPreviewVariantId(variant.id)}
                  actions={
                    <>
                      {isMine ? (
                        <Link
                          to={`/tutor/mock-exams/variants/${variant.id}/edit`}
                          className="inline-flex min-h-9 touch-manipulation items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-accent/40 hover:text-accent dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          Редактировать
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        disabled={duplicatingId !== null}
                        onClick={() => void handleDuplicateVariant(variant.id)}
                        className="inline-flex min-h-9 touch-manipulation items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        aria-label="Создать редактируемую копию варианта"
                      >
                        {duplicatingId === variant.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Дублировать
                      </button>
                    </>
                  }
                />
              );
              return (
                <>
                  {myVariants.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Мои варианты
                      </p>
                      {myVariants.map((v) => renderVariant(v, true))}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    {myVariants.length > 0 ? (
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Каталог
                      </p>
                    ) : null}
                    {catalogVariants.map((v) => renderVariant(v, false))}
                    <VariantCard
                      title={FIPI_PLACEHOLDER.title}
                      attribution={FIPI_PLACEHOLDER.attribution}
                      meta={FIPI_PLACEHOLDER.meta}
                      badge={FIPI_PLACEHOLDER.badge}
                      isAvailable={FIPI_PLACEHOLDER.isAvailable}
                      isSelected={false}
                    />
                  </div>
                </>
              );
            })()}
            <Link
              to="/tutor/mock-exams/variants/new"
              className="flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600 transition-colors hover:border-accent/40 hover:text-accent"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Создать свой вариант
            </Link>
          </div>
        )}
      </StepSection>

      {/* Шаг 2 — Режим прохождения СКРЫТ (TASK-11): ученик выбирает способ ответа
          сам через AnswerMethodSelectModal на taking page (TASK-10). Tutor больше
          не навязывает «бланк vs цифровой» при создании. assignment.mode остаётся
          'form' по умолчанию для backward-compat (см. tutor-bugs-fix-spec.md). */}

      {/* Шаг 3 — Кому назначить */}
      <StepSection index={3} title="Кому назначить">
        {studentsLoading || (miniGroupsEnabled && groupsLoading) ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {miniGroupsEnabled && groups.length > 0 && (() => {
              // Учебные группы и метки разделены (паритет с HWAssignSection, review P3).
              const renderRow = (group: (typeof groups)[number]) => {
                const activeMembers = group.members.filter((m) => m.is_active);
                return (
                  <RecipientRow
                    key={group.id}
                    id={group.id}
                    primary={group.short_name?.trim() || group.name}
                    secondary={`${activeMembers.length} ${pluralStudents(activeMembers.length)}`}
                    isSelected={selectedGroupIds.has(group.id)}
                    onToggle={handleGroupToggle}
                  />
                );
              };
              const primaryList = groups.filter((g) => g.is_primary);
              const tagList = groups.filter((g) => !g.is_primary);
              return (
                <>
                  {primaryList.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {tagList.length > 0 ? 'Учебные группы' : 'Группы'}
                      </p>
                      {primaryList.map(renderRow)}
                    </div>
                  )}
                  {tagList.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Метки
                      </p>
                      {tagList.map(renderRow)}
                    </div>
                  )}
                </>
              );
            })()}

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Индивидуально
              </p>
              {activeStudents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  Нет активных учеников. Сначала добавь ученика на странице «Ученики».
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-md border border-slate-100 dark:border-slate-800 p-1">
                  {activeStudents.map((student) => (
                    <RecipientRow
                      key={student.student_id}
                      id={student.student_id}
                      primary={getStudentDisplayName(student)}
                      secondary={getStudentSubline(student) || undefined}
                      isSelected={selectedStudentIds.has(student.student_id)}
                      onToggle={handleStudentToggle}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Выбрано:{' '}
              <span className="font-semibold text-foreground tabular-nums">
                {studentIds.length} {pluralStudents(studentIds.length)}
              </span>
            </div>
          </div>
        )}
      </StepSection>

      {/* Шаг 4 — Параметры (название + дедлайн) */}
      <StepSection index={4} title="Название и дедлайн">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mock-exam-title">Название</Label>
            <Input
              id="mock-exam-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Пробник для группы пн/чт"
              maxLength={200}
              className="text-base"
            />
            <p className="text-xs text-muted-foreground">
              Видят ученики и репетитор в списке пробников.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mock-exam-deadline">Дедлайн (опционально)</Label>
            <DateTimeField
              id="mock-exam-deadline"
              value={deadlineInput}
              onChange={setDeadlineInput}
              clearable
              className="sm:max-w-xs"
            />
            <p className="text-xs text-muted-foreground">{DURATION_HINT}</p>
          </div>

          {/* AC-P10 Phase 2 (PAUSE-7, 2026-05-25): default exam mode picker.
              Tutor recommendation для start modal — ученик может override (PAUSE-4). */}
          <div className="space-y-2">
            <Label>Режим прохождения по умолчанию</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label
                htmlFor="exam-mode-training"
                className={`flex items-start gap-3 rounded-md border-2 p-3 cursor-pointer transition-colors ${
                  defaultExamMode === 'training'
                    ? 'border-accent bg-accent/5'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  id="exam-mode-training"
                  name="default-exam-mode"
                  value="training"
                  checked={defaultExamMode === 'training'}
                  onChange={() => setDefaultExamMode('training')}
                  className="mt-1 h-4 w-4 cursor-pointer accent-accent"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    📚 Тренировка (рекомендуется)
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Ученик может прерывать. Таймер останавливается на паузе —
                    можно вернуться позже и продолжить.
                  </div>
                </div>
              </label>

              <label
                htmlFor="exam-mode-simulation"
                className={`flex items-start gap-3 rounded-md border-2 p-3 cursor-pointer transition-colors ${
                  defaultExamMode === 'simulation'
                    ? 'border-accent bg-accent/5'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  id="exam-mode-simulation"
                  name="default-exam-mode"
                  value="simulation"
                  checked={defaultExamMode === 'simulation'}
                  onChange={() => setDefaultExamMode('simulation')}
                  className="mt-1 h-4 w-4 cursor-pointer accent-accent"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    ⚡ Симуляция ЕГЭ
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    4 часа подряд без пауз — как реальный экзамен.
                    Для финальной подготовки.
                  </div>
                </div>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Ученик увидит этот режим как рекомендованный, но сможет переключить
              перед началом пробника.
            </p>
          </div>
        </div>
      </StepSection>

      {/* Опц. lead-link */}
      <Card animate={false} className="border-2 border-dashed border-slate-300 dark:border-slate-700">
        <CardContent className="p-5">
          <label
            htmlFor="mock-exam-lead-link"
            className="flex items-start gap-3 cursor-pointer"
          >
            <Checkbox
              id="mock-exam-lead-link"
              checked={createLeadLink}
              onCheckedChange={(checked) => setCreateLeadLink(checked === true)}
              className="mt-1"
            />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link2 className="h-4 w-4 text-accent" aria-hidden="true" />
                <span className="font-medium text-sm text-slate-900 dark:text-slate-100">
                  Опционально · Создать публичную ссылку для лидов
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Родители и ученики смогут пройти этот пробник без регистрации.
                Часть 1 они увидят сразу, Часть 2 — после твоего подтверждения. Ты получишь их контакт.
                Ссылка скопируется в буфер обмена после создания пробника.
              </p>
            </div>
          </label>
        </CardContent>
      </Card>

      {/* Action bar */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 bg-background sm:bg-transparent border-t sm:border-0 z-10">
        <Button variant="outline" asChild>
          <Link to="/tutor/mock-exams">
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
            Назад
          </Link>
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!isValidForSubmit}
          className="min-w-[200px]"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
          ) : null}
          {isSubmitting
            ? 'Назначаем…'
            : studentIds.length > 0
            ? `Назначить пробник ${studentIds.length} ${pluralStudents(studentIds.length)}`
            : 'Выбери учеников'}
        </Button>
      </div>

      {/* FIX-2 — variant preview drawer. */}
      <MockExamVariantPreviewSheet
        open={previewVariantId !== null}
        onOpenChange={(next) => {
          if (!next) setPreviewVariantId(null);
        }}
        variantId={previewVariantId}
      />

      {/* FIX-4a — lead-link success dialog. */}
      <LeadLinkSuccessDialog
        open={leadLink !== null}
        url={leadLink?.url ?? ''}
        studentCount={leadLink?.studentCount ?? 0}
        onClose={() => {
          const target = leadLink;
          setLeadLink(null);
          if (target) {
            navigate(`/tutor/mock-exams/${target.assignmentId}`, {
              replace: true,
            });
          }
        }}
      />
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function TutorMockExamCreate() {
  return (
    <MockExamFeatureGate>
      <TutorMockExamCreateContent />
    </MockExamFeatureGate>
  );
}
