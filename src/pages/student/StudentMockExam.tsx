import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  UploadCloud,
  X,
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
  setMockExamAnswerMethod,
  startMockExamAttempt,
  submitMockExamAttempt,
  uploadMockExamBlankPhoto,
  uploadMockExamPart1FallbackPhoto,
  uploadMockExamPart2BulkPhoto,
  uploadMockExamPart2Photo,
  type StudentMockExamAssignmentView,
  type StudentMockExamVariantTask,
} from '@/lib/studentMockExamApi';
import { compressMockExamPhoto } from '@/lib/mockExamPhotoCompress';
import { cn } from '@/lib/utils';
import { useMockExamAutoSave } from '@/components/student/useMockExamAutoSave';
import type { MockExamAnswerMethod, MockExamCheckMode, MockExamMode } from '@/types/mockExam';
import { AnswerMethodSelectModal } from '@/components/student/mock-exam/AnswerMethodSelectModal';
import { useQueryClient } from '@tanstack/react-query';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);
// Lazy markdown stack — only loaded when task_text contains a markdown table
// (KIM 6/10/15/17 на соответствие). KaTeX-only path остаётся через MathText
// для подавляющего большинства задач — bundle remains lean.
const MarkdownTableRenderer = lazy(() =>
  import('@/components/student/mock-exam/MarkdownTaskText').then((m) => ({
    default: m.MarkdownTaskText,
  })),
);

// Phase 4 (2026-05-15) — заменён с `ege-physics-2025.pdf` (старый бланк требовал
// вписывать ФИО) на новый `ege-physics-2026.pdf` (4 страницы: бланк № 1 для
// кратких ответов + бланк № 2 лист 1 + бланк № 2 лист 2 для развёрнутых +
// дополнительный бланк № 2). Манualьно загружен через Supabase Studio.
const BLANK_PDF_URL =
  'https://api.sokratai.ru/storage/v1/object/public/mock-exam-blank-templates/ege-physics-2026.pdf';

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

function getAnswerHint(mode: MockExamCheckMode | null, kimNumber?: number): string {
  // Per-kim overrides (TASK-12 — priority over generic check_mode hints).
  // KIM 19 — динамометр + погрешность: значение и погрешность слитно (см.
  // инструкцию варианта «два числа, не разделяя пробелом, например 2,70,1»).
  if (kimNumber === 19) {
    return 'Два числа слитно: значение и погрешность, например 2,70,1';
  }
  switch (mode) {
    case 'ordered':
      return 'Запиши последовательность слитно: 132';
    case 'unordered':
      return 'Можно в любом порядке, слитно: 13';
    case 'multi_choice':
      return 'Номера вариантов слитно: 13';
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

// Detect a GFM markdown table inside task_text. Matching tasks (KIM 6/10/15/17)
// after pilot-polish TASK-6 contain a 2-column table with the standard
// `| header | header |\n|---|---|\n| ... |` structure. For all other tasks we
// keep the KaTeX-only fast path (MathText), so the markdown bundle stays lazy.
const MARKDOWN_TABLE_RE = /\n\s*\|.+\|\s*\n\s*\|\s*[:\-| ]+\|\s*\n/;

function MathBlock({ text, className }: { text: string; className?: string }) {
  const hasMarkdownTable = MARKDOWN_TABLE_RE.test(text);
  if (hasMarkdownTable) {
    return (
      <Suspense fallback={<div className={cn('whitespace-pre-wrap', className)}>{text}</div>}>
        <MarkdownTableRenderer text={text} className={className} />
      </Suspense>
    );
  }
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

/**
 * Phase 4 (2026-05-15) — полная Шапка ЕГЭ из официального демоварианта 2026
 * (источник: Шапка ЕГЭ.pdf от Vladimir, прислан 2026-05-15). Включает:
 *   - Инструкция по выполнению (3ч 55мин, 26 заданий, образцы записи ответов)
 *   - 10 справочных таблиц: десятичные приставки, константы, соотношения
 *     единиц, масса частиц, плотности, удельная теплоёмкость, удельная
 *     теплота, нормальные условия, молярная масса.
 *
 * `React.memo` — статические справочные данные, перерасчёт не нужен.
 * Single top-level `<details>` collapsible (text-base 16px для iOS).
 */
const ReferencesPanel = memo(function ReferencesPanel() {
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
          <p className="text-sm text-slate-500">
            Константы, плотности, теплоёмкости, молярная масса + инструкция по записи ответов
          </p>
        </div>
        <ChevronDown className={cn('h-5 w-5 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-5 text-[15px] leading-relaxed text-slate-700 space-y-5">
          {/* Инструкция по выполнению */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">
              Инструкция по выполнению
            </h3>
            <div className="mt-2 space-y-2">
              <p>
                На экзамен отводится <strong>3 часа 55 минут</strong> (235 минут). Работа состоит из двух частей,
                всего <strong>26 заданий</strong>.
              </p>
              <p className="text-slate-600">
                В заданиях <strong>1–4, 7, 8, 11–13 и 16</strong> ответом является целое число или конечная
                десятичная дробь. <strong>Единицы измерения писать не нужно.</strong> Пример:{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] font-mono">−2,5</code>
              </p>
              <p className="text-slate-600">
                В заданиях <strong>5, 6, 9, 10, 14, 15, 17, 18 и 20</strong> ответ — последовательность цифр
                без пробелов и других символов. В заданиях 5, 9, 14, 18 — два или три верных ответа. Пример:{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] font-mono">41</code>
              </p>
              <p className="text-slate-600">
                В задании <strong>19</strong> ответом являются <strong>два числа</strong>, не разделяй их
                пробелом. Пример для <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] font-mono">
                  (1,4±0,2) Н
                </code>
                {' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] font-mono">1,40,2</code>
              </p>
              <p className="text-slate-600">
                Задания <strong>21–26</strong> — развёрнутое решение, пишется на бланке № 2 с указанием номера
                задания.
              </p>
              <p className="text-slate-600">
                Разрешается линейка и непрограммируемый калькулятор. Записи в черновике не учитываются.
              </p>
            </div>
          </section>

          {/* Десятичные приставки */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">
              Десятичные приставки
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-md bg-slate-50 p-2.5 font-mono text-[13px]">гига (Г) — 10⁹</div>
              <div className="rounded-md bg-slate-50 p-2.5 font-mono text-[13px]">мега (М) — 10⁶</div>
              <div className="rounded-md bg-slate-50 p-2.5 font-mono text-[13px]">кило (к) — 10³</div>
              <div className="rounded-md bg-slate-50 p-2.5 font-mono text-[13px]">гекто (г) — 10²</div>
              <div className="rounded-md bg-slate-50 p-2.5 font-mono text-[13px]">деци (д) — 10⁻¹</div>
              <div className="rounded-md bg-slate-50 p-2.5 font-mono text-[13px]">санти (с) — 10⁻²</div>
              <div className="rounded-md bg-slate-50 p-2.5 font-mono text-[13px]">милли (м) — 10⁻³</div>
              <div className="rounded-md bg-slate-50 p-2.5 font-mono text-[13px]">микро (мк) — 10⁻⁶</div>
              <div className="rounded-md bg-slate-50 p-2.5 font-mono text-[13px]">нано (н) — 10⁻⁹</div>
              <div className="rounded-md bg-slate-50 p-2.5 font-mono text-[13px]">пико (п) — 10⁻¹²</div>
            </div>
          </section>

          {/* Константы */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Константы</h3>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              <p className="font-mono text-[13px]">π = 3,14</p>
              <p className="font-mono text-[13px]">g = 10 м/с²</p>
              <p className="font-mono text-[13px]">G = 6,7 · 10⁻¹¹ Н·м²/кг²</p>
              <p className="font-mono text-[13px]">R = 8,31 Дж/(моль·К)</p>
              <p className="font-mono text-[13px]">k = 1,38 · 10⁻²³ Дж/К</p>
              <p className="font-mono text-[13px]">N_A = 6 · 10²³ моль⁻¹</p>
              <p className="font-mono text-[13px]">c = 3 · 10⁸ м/с</p>
              <p className="font-mono text-[13px]">k_Кулона = 1/(4πε₀) = 9 · 10⁹ Н·м²/Кл²</p>
              <p className="font-mono text-[13px]">ε₀ = 8,85 · 10⁻¹² Ф/м</p>
              <p className="font-mono text-[13px]">e = 1,6 · 10⁻¹⁹ Кл</p>
              <p className="font-mono text-[13px]">h = 6,6 · 10⁻³⁴ Дж·с</p>
            </div>
          </section>

          {/* Соотношения единиц */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">
              Соотношения единиц
            </h3>
            <div className="mt-2 space-y-1.5">
              <p className="font-mono text-[13px]">0 К = −273 °C</p>
              <p className="font-mono text-[13px]">1 а.е.м. = 1,66 · 10⁻²⁷ кг</p>
              <p className="font-mono text-[13px]">1 а.е.м. эквивалентна 931,5 МэВ</p>
              <p className="font-mono text-[13px]">1 эВ = 1,6 · 10⁻¹⁹ Дж</p>
            </div>
          </section>

          {/* Масса частиц */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Масса частиц</h3>
            <div className="mt-2 space-y-1.5">
              <p className="font-mono text-[13px]">электрон: 9,1 · 10⁻³¹ кг ≈ 5,5 · 10⁻⁴ а.е.м.</p>
              <p className="font-mono text-[13px]">протон: 1,673 · 10⁻²⁷ кг ≈ 1,007 а.е.м.</p>
              <p className="font-mono text-[13px]">нейтрон: 1,675 · 10⁻²⁷ кг ≈ 1,008 а.е.м.</p>
            </div>
          </section>

          {/* Плотность */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">
              Плотность (кг/м³)
            </h3>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              <p className="font-mono text-[13px]">подсолнечное масло — 900</p>
              <p className="font-mono text-[13px]">вода — 1000</p>
              <p className="font-mono text-[13px]">алюминий — 2700</p>
              <p className="font-mono text-[13px]">древесина (сосна) — 400</p>
              <p className="font-mono text-[13px]">железо — 7800</p>
              <p className="font-mono text-[13px]">керосин — 800</p>
              <p className="font-mono text-[13px]">ртуть — 13 600</p>
            </div>
          </section>

          {/* Удельная теплоёмкость */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">
              Удельная теплоёмкость (Дж/(кг·К))
            </h3>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              <p className="font-mono text-[13px]">вода — 4,2 · 10³</p>
              <p className="font-mono text-[13px]">лёд — 2,1 · 10³</p>
              <p className="font-mono text-[13px]">железо — 460</p>
              <p className="font-mono text-[13px]">свинец — 130</p>
              <p className="font-mono text-[13px]">алюминий — 900</p>
              <p className="font-mono text-[13px]">медь — 380</p>
              <p className="font-mono text-[13px]">чугун — 500</p>
            </div>
          </section>

          {/* Удельная теплота */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Удельная теплота</h3>
            <div className="mt-2 space-y-1.5">
              <p className="font-mono text-[13px]">парообразования воды: 2,3 · 10⁶ Дж/кг</p>
              <p className="font-mono text-[13px]">плавления свинца: 2,5 · 10⁴ Дж/кг</p>
              <p className="font-mono text-[13px]">плавления льда: 3,3 · 10⁵ Дж/кг</p>
            </div>
          </section>

          {/* Нормальные условия */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">
              Нормальные условия
            </h3>
            <div className="mt-2">
              <p className="font-mono text-[13px]">давление — 10⁵ Па, температура — 0 °C</p>
            </div>
          </section>

          {/* Молярная масса */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">
              Молярная масса (кг/моль)
            </h3>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              <p className="font-mono text-[13px]">азот — 28 · 10⁻³</p>
              <p className="font-mono text-[13px]">гелий — 4 · 10⁻³</p>
              <p className="font-mono text-[13px]">аргон — 40 · 10⁻³</p>
              <p className="font-mono text-[13px]">кислород — 32 · 10⁻³</p>
              <p className="font-mono text-[13px]">водород — 2 · 10⁻³</p>
              <p className="font-mono text-[13px]">литий — 6 · 10⁻³</p>
              <p className="font-mono text-[13px]">воздух — 29 · 10⁻³</p>
              <p className="font-mono text-[13px]">неон — 20 · 10⁻³</p>
              <p className="font-mono text-[13px]">вода — 18 · 10⁻³</p>
              <p className="font-mono text-[13px]">углекислый газ — 44 · 10⁻³</p>
            </div>
          </section>
        </div>
      )}
    </Card>
  );
});

/**
 * Info-only banner для blank-режима (TASK-13, 2026-05-14): инструкция +
 * ссылка на PDF бланка. PhotoUploadBox для фото бланка перенесён в секцию
 * «Часть 1» (рядом с инструкцией к Часть 1) — там он семантически логичнее.
 */
function BlankModeBanner({ mode }: { mode: MockExamMode }) {
  if (mode !== 'blank') return null;

  return (
    <Card className="border-amber-200 bg-amber-50 shadow-none hover:shadow-sm">
      <CardContent className="p-4">
        <div className="space-y-2 text-sm text-amber-950">
          <div className="flex items-center gap-2 font-semibold">
            <FileText className="h-4 w-4" />
            Режим: С бланком
          </div>
          <p>
            Распечатай PDF официального бланка, заполни ручкой, потом сфотографируй бланк.
            Фото бланка загрузишь ниже в секции «Часть 1».
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
          </span>
          <span className="text-sm text-slate-500">{task.max_score} балл{task.max_score === 1 ? '' : 'а'}</span>
        </div>
        <MathBlock text={task.task_text} className="text-base leading-7 text-slate-800" />
        {imageUrls.length > 0 && (
          <div className="mt-4 grid gap-3">
            {imageUrls.map((url, index) => {
              // KIM 20 — выбор схем: gallery нумеруется «Схема 1..5» (TASK-12).
              // task_image_url порядок = canonical scheme order.
              const caption = task.kim_number === 20 ? `Схема ${index + 1}` : null;
              return (
                <figure key={`${task.kim_number}-${index}`} className="m-0">
                  <img
                    src={url}
                    alt={caption ?? `Иллюстрация к заданию ${task.kim_number}`}
                    loading="lazy"
                    className="max-h-80 w-full rounded-md border border-slate-200 bg-slate-50 object-contain"
                  />
                  {caption && (
                    <figcaption className="mt-1 text-center text-sm font-medium text-slate-700">
                      {caption}
                    </figcaption>
                  )}
                </figure>
              );
            })}
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
            <span className="text-sm text-slate-500">{getAnswerHint(task.check_mode, task.kim_number)}</span>
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

/**
 * Part 2 read-only preview (TASK-12, 2026-05-14). Phase 5 removed per-task
 * photo upload but Vladimir QA flagged that students couldn't SEE Часть 2
 * task conditions anymore — they need them to solve. This component renders
 * task number + max_score + task_text + task images, no upload. Bulk upload
 * is below the section.
 */
function Part2TaskPreviewCard({
  task,
  imageUrls,
}: {
  task: StudentMockExamVariantTask;
  imageUrls: string[];
}) {
  return (
    <Card className="shadow-none" id={`task-${task.kim_number}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-900">
            №{task.kim_number}
          </span>
          <span className="text-sm text-slate-500">
            {task.max_score} балл{task.max_score === 1 ? '' : task.max_score < 5 ? 'а' : 'ов'} · развёрнутое решение
          </span>
        </div>
        <MathBlock text={task.task_text} className="text-base leading-7 text-slate-800" />
        {imageUrls.length > 0 && (
          <div className="mt-4 grid gap-3">
            {imageUrls.map((url, index) => (
              <img
                key={`${task.kim_number}-${index}`}
                src={url}
                alt={`Иллюстрация к заданию ${task.kim_number}`}
                loading="lazy"
                className="max-h-80 w-full rounded-md border border-slate-200 bg-slate-50 object-contain"
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StudentMockExamWorkspace({ data }: { data: StudentMockExamAssignmentView }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [startedAt, setStartedAt] = useState(data.attempt.started_at);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [blankPhoto, setBlankPhoto] = useState<PhotoState>(() =>
    createEmptyPhoto(data.attempt.blank_photo_url),
  );
  // Phase 5 (2026-05-15): Часть 2 теперь только bulk-pack (до 7 фото общим
  // пакетом). Per-task `part2Photos` state остаётся для backward compat с
  // существующими (pilot) attempts — старые записи всё ещё имеют photo_url
  // per-kim, их рендерим в read-only viewer в TutorMockExamReview. Для новых
  // attempts pre-populate из data.part2_solutions всё ещё нужен — backend
  // может вернуть photo_url для backward compat. UI больше не рендерит
  // per-task слоты загрузки.
  const [part2Photos] = useState<Record<number, PhotoState>>(() => {
    const initial: Record<number, PhotoState> = {};
    for (const row of data.part2_solutions) {
      initial[row.kim_number] = createEmptyPhoto(row.photo_url);
    }
    return initial;
  });
  // Bulk pack Часть 2 — до 7 фото общим пакетом. URL'ы приходят resolved
  // signed-URL'ами от backend; локальное состояние держит uploading сторонние
  // лимиты и errors. Phase 5 — теперь это ЕДИНСТВЕННЫЙ путь загрузки Часть 2
  // (заменил 6 per-kim слотов + старый optional "общий пакет").
  const [part2BulkPhotos, setPart2BulkPhotos] = useState<string[]>(
    () => data.attempt.part2_bulk_photo_urls ?? [],
  );
  const [bulkUploadStatus, setBulkUploadStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [bulkUploadError, setBulkUploadError] = useState<string | null>(null);
  // Per-attempt answer method choice — null до выбора (modal появится).
  const [answerMethod, setAnswerMethod] = useState<MockExamAnswerMethod | null>(
    data.attempt.answer_method ?? null,
  );
  const [methodModalOpen, setMethodModalOpen] = useState<boolean>(
    data.attempt.answer_method === null,
  );
  const [methodSwitching, setMethodSwitching] = useState(false);
  const [methodError, setMethodError] = useState<string | null>(null);
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
        // Phase 6 review-fix P2 #1: client-side compress before upload.
        // Server inline cap = 5MB → real phone photos (3-8MB) terять при inline.
        const compressed = await compressMockExamPhoto(file);
        const result = await uploadMockExamBlankPhoto(data.attempt.id, compressed);
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

  const retryBlank = useCallback(() => {
    if (blankPhoto.file) void uploadBlank(blankPhoto.file);
  }, [blankPhoto.file, uploadBlank]);

  // Phase 5 (2026-05-15): removed `uploadPart2 / retryPart2 / uploadPart1Fallback /
  // retryPart1Fallback` callbacks — UI больше не рендерит per-task слоты Часть 2
  // и fallback-фото Часть 1. Backend endpoints (`uploadMockExamPart2Photo` +
  // `uploadMockExamPart1FallbackPhoto`) намеренно ОСТАВЛЕНЫ работающими для
  // backward compat с pilot attempts (Egor 2026-05-15) — TutorMockExamReview
  // продолжает читать их `photo_url` для read-only показа. Новые attempts
  // используют только bulk-pack (uploadPart2Bulk ниже).

  const MAX_BULK_PART2_PHOTOS = 7;

  const uploadPart2Bulk = useCallback(
    async (file: File) => {
      if (part2BulkPhotos.length >= MAX_BULK_PART2_PHOTOS) {
        setBulkUploadError(`Максимум ${MAX_BULK_PART2_PHOTOS} фото в общем пакете`);
        return;
      }
      setBulkUploadStatus('uploading');
      setBulkUploadError(null);
      try {
        // Phase 6 review-fix P2 #1: client-side compress before upload.
        // Real phone photo 3-8MB → server inline cap 5MB → AI Pass 1
        // assignment пропускает несжатые фото из пакета. Compress сохраняет
        // их в payload.
        const compressed = await compressMockExamPhoto(file);
        const result = await uploadMockExamPart2BulkPhoto(data.attempt.id, compressed);
        if (result.signed_url) {
          setPart2BulkPhotos((prev) => [...prev, result.signed_url as string]);
        }
        setBulkUploadStatus('idle');
      } catch (err) {
        setBulkUploadStatus('error');
        setBulkUploadError(err instanceof Error ? err.message : 'Не удалось загрузить фото');
      }
    },
    [data.attempt.id, part2BulkPhotos.length],
  );

  const handleAnswerMethodSelect = useCallback(
    async (method: MockExamAnswerMethod) => {
      setMethodSwitching(true);
      setMethodError(null);
      try {
        await setMockExamAnswerMethod(data.attempt.id, method);
        setAnswerMethod(method);
        setMethodModalOpen(false);
        // Refresh cache so subsequent reads (refetch) get latest server state.
        queryClient.setQueryData<StudentMockExamAssignmentView>(
          ['student', 'mock-exam', data.assignment.id],
          (prev) => (prev ? { ...prev, attempt: { ...prev.attempt, answer_method: method } } : prev),
        );
      } catch (err) {
        setMethodError(err instanceof Error ? err.message : 'Не удалось сохранить выбор');
      } finally {
        setMethodSwitching(false);
      }
    },
    [data.attempt.id, data.assignment.id, queryClient],
  );

  const answeredPart1Count = part1Tasks.filter((task) => {
    const value = autosave.answers[task.kim_number];
    return typeof value === 'string' && value.trim().length > 0;
  }).length;
  // Phase 5 (2026-05-15): upload счётчики основаны только на bulk Часть 2 +
  // blankPhoto Часть 1. Per-task `part2Photos[*]` остаются как backward-compat
  // read-only state для pilot attempts, но НЕ участвуют в submit / sticky footer.
  const failedUploadCount =
    (blankPhoto.status === 'error' ? 1 : 0) +
    (bulkUploadStatus === 'error' ? 1 : 0);
  const uploadingCount =
    (blankPhoto.status === 'uploading' ? 1 : 0) +
    (bulkUploadStatus === 'uploading' ? 1 : 0);

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

  const variantPdfUrl = data.variant?.variant_pdf_url ?? null;

  return (
    <div className="sokrat min-h-[100dvh] bg-slate-50" data-sokrat-mode="student">
      <AnswerMethodSelectModal
        open={methodModalOpen}
        currentMethod={answerMethod}
        confirmLabel={answerMethod ? 'Сохранить выбор' : 'Начать пробник'}
        isSubmitting={methodSwitching}
        onSelect={handleAnswerMethodSelect}
        // Если ученик ещё не выбрал — нельзя закрыть. Если открыли через
        // switcher (answerMethod !== null) — даём Cancel.
        onCancel={answerMethod ? () => setMethodModalOpen(false) : undefined}
      />
      <PageContent>
        <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 sm:pb-32">
          <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase text-slate-500">Пробник ЕГЭ по физике</p>
                <h1 className="mt-1 text-xl font-semibold leading-tight text-slate-900 sm:text-2xl">
                  {getExamTitle(data)}
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                  {getModeLabel(data.assignment.mode)} · {tasks.length} задач · Часть 1:{' '}
                  {answerMethod === 'form'
                    ? `${answeredPart1Count}/${part1Tasks.length}`
                    : (blankPhoto.url ? 'фото' : '—')}
                  {' · '}Часть 2: {part2BulkPhotos.length}/{MAX_BULK_PART2_PHOTOS} фото
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {answerMethod && (
                    <button
                      type="button"
                      onClick={() => setMethodModalOpen(true)}
                      className="inline-flex min-h-9 touch-manipulation items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-100"
                      aria-label="Сменить способ ответа"
                    >
                      {answerMethod === 'blank' ? <Pencil className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                      <span>Способ: {answerMethod === 'blank' ? 'Бланк ФИПИ' : 'Цифровой'}</span>
                      <span className="text-emerald-600">·</span>
                      <span className="text-emerald-700 underline-offset-2 hover:underline">Сменить</span>
                    </button>
                  )}
                  {variantPdfUrl && (
                    <a
                      href={variantPdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 touch-manipulation items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Скачать задачи (PDF)
                    </a>
                  )}
                </div>
                {methodError && (
                  <p className="mt-2 text-sm text-rose-700">{methodError}</p>
                )}
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
            {answerMethod === 'blank' && <BlankModeBanner mode="blank" />}
            <ReferencesPanel />
          </div>

          <section className="mt-6 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Часть 1</h2>
                <p className="text-sm text-slate-500">
                  {answerMethod === 'blank'
                    ? 'Заполняй на ФИПИ-бланке от руки и загрузи фото бланка ниже. Цифровые поля скрыты — репетитор проверит ответы Часть 1 по фото.'
                    : 'Вводи ответы сразу. Каждое изменение сохраняется автоматически.'}
                </p>
              </div>
              <span className="rounded-md bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                {answerMethod === 'form'
                  ? `${answeredPart1Count}/${part1Tasks.length}`
                  : (blankPhoto.url ? 'фото загружено' : 'фото не загружено')}
              </span>
            </div>

            {/* Blank-режим: PhotoUploadBox перенесён сюда из BlankModeBanner
                (TASK-13, 2026-05-14, Vladimir UX feedback). Семантически фото
                бланка относится к Часть 1, а не к header'у пробника. */}
            {answerMethod === 'blank' && (
              <Card className="border-amber-200 bg-white shadow-none">
                <CardContent className="p-4 sm:p-5">
                  <PhotoUploadBox
                    kind="blank"
                    kimNumber={null}
                    title="Фото заполненного бланка"
                    state={blankPhoto}
                    onFileSelected={(file) => void uploadBlank(file)}
                    onRetry={retryBlank}
                    disabled={isFinal}
                  />
                </CardContent>
              </Card>
            )}

            {answerMethod === 'form' && part1Tasks.map((task) => (
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
            {/* В режиме «Бланк ФИПИ» (answerMethod==='blank') цифровые поля СКРЫТЫ —
                ученик пишет ответы на распечатанном бланке и загружает фото в
                PhotoUploadBox выше. После Phase 6 (2026-05-15) AI auto-OCR
                Часть 1 запускается в `mock-exam-grade::runPart1OCR` на canonical
                `attempts.blank_photo_url` и pre-fills `mock_exam_attempt_part1_answers`.
                Tutor видит OCR результаты в `Part1BlankReviewPanel` с amber border
                для low-confidence cells и при необходимости корректирует через
                /part1-manual-score. См. CLAUDE.md §22. */}
          </section>

          <section className="mt-8 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Часть 2</h2>
                <p className="text-sm text-slate-500">
                  Прочитай условия задач № 21–26 ниже и реши их на бумаге. Затем
                  загрузи фото решений одним пакетом (до {MAX_BULK_PART2_PHOTOS} фото).
                  AI и репетитор сами разберут, где какая задача.
                </p>
              </div>
              <span className="rounded-md bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                {part2BulkPhotos.length}/{MAX_BULK_PART2_PHOTOS} фото
              </span>
            </div>

            {/* TASK-12 (2026-05-14): read-only условия задач Часть 2. Phase 5
                удалил per-task photo upload, но условия задач остались нужны —
                ученик ДОЛЖЕН видеть что решать. Карточки без upload UI.
                Photo upload остаётся bulk (ниже). */}
            <div className="space-y-3">
              {part2Tasks.map((task) => (
                <Part2TaskPreviewCard
                  key={task.id}
                  task={task}
                  imageUrls={imagesByKim[task.kim_number] ?? []}
                />
              ))}
            </div>

            {/* Phase 5 (2026-05-15): ОДНО bulk-поле Часть 2 — замена 6 per-kim слотов
                + старого "общего пакета". Backend AI grader получает все фото одним
                pass'ом, сам распределяет по задачам № 21-26. Tutor в review может
                перепривязать фото к нужной задаче если AI ошибся. */}
            <Card className="border-slate-200 bg-white shadow-none">
              <CardContent className="p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Фото решений Части 2 (задачи № 21–26)
                    </p>
                    <p className="text-xs text-slate-500">
                      До {MAX_BULK_PART2_PHOTOS} фото. JPG / PNG / WebP / HEIC, до 10 МБ каждое.
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                    {part2BulkPhotos.length}/{MAX_BULK_PART2_PHOTOS}
                  </span>
                </div>
                {part2BulkPhotos.length > 0 && (
                  <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {part2BulkPhotos.map((url, idx) => (
                      <div
                        key={url}
                        className="relative aspect-square overflow-hidden rounded-md border border-amber-200 bg-white"
                      >
                        <img
                          src={url}
                          alt={`Bulk фото ${idx + 1}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        <span className="absolute bottom-1 right-1 rounded bg-black/50 px-1.5 py-0.5 text-xs font-semibold text-white">
                          {idx + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {part2BulkPhotos.length < MAX_BULK_PART2_PHOTOS && (
                  <div>
                    <label
                      htmlFor={`bulk-upload-${data.attempt.id}`}
                      className={cn(
                        'inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-50',
                        (bulkUploadStatus === 'uploading' || isFinal) && 'pointer-events-none opacity-60',
                      )}
                    >
                      {bulkUploadStatus === 'uploading' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UploadCloud className="h-4 w-4" />
                      )}
                      {bulkUploadStatus === 'uploading' ? 'Загружаем…' : 'Добавить фото в общий пакет'}
                    </label>
                    <input
                      id={`bulk-upload-${data.attempt.id}`}
                      type="file"
                      // TASK-15 fix (ChatGPT-5.5 review): backend
                      // `ALLOWED_PHOTO_MIME` принимает только image/* —
                      // `.pdf` отклоняется как INVALID_MIME. UI accept
                      // matches backend.
                      accept="image/*"
                      className="sr-only"
                      disabled={isFinal || bulkUploadStatus === 'uploading'}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadPart2Bulk(file);
                        e.target.value = '';
                      }}
                    />
                  </div>
                )}
                {bulkUploadError && (
                  <p className="mt-2 text-sm text-rose-700">{bulkUploadError}</p>
                )}
              </CardContent>
            </Card>
          </section>
        </main>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              <span>
                Часть 1:{' '}
                <strong className="text-slate-900">
                  {answerMethod === 'form'
                    ? `${answeredPart1Count}/${part1Tasks.length}`
                    : (blankPhoto.url ? 'фото загружено' : 'нет фото')}
                </strong>
              </span>
              <span className="mx-2 text-slate-300">·</span>
              <span>
                Часть 2: <strong className="text-slate-900">{part2BulkPhotos.length}/{MAX_BULK_PART2_PHOTOS} фото</strong>
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
              <p>
                Способ: <strong>{answerMethod === 'blank' ? 'Бланк ФИПИ от руки' : answerMethod === 'form' ? 'Цифровой ввод' : 'не выбран'}</strong>.
              </p>
              {answerMethod === 'form' && (
                <p>Часть 1: {answeredPart1Count} из {part1Tasks.length} ответов введено.</p>
              )}
              {answerMethod === 'blank' && (
                <p>Часть 1 (ФИПИ бланк): {blankPhoto.url ? 'фото загружено' : 'фото пока не загружено'}.</p>
              )}
              <p>
                Часть 2: {part2BulkPhotos.length} из {MAX_BULK_PART2_PHOTOS} фото загружено.
              </p>
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
