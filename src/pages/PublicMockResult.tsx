// PublicMockResult — public parent share-link result for a mock exam.
//
// Route: /p/mock-result/:slug  (App.tsx, mounted OUTSIDE AppFrame / AuthGuard)
// Backend: supabase/functions/mock-exam-public/index.ts → handleResultRead
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-7 + Section 3
//
// AC-7: 200 OK only when attempt.status ∈ { 'approved', 'manually_entered' };
// 403 not_ready, 404 not_found, 410 expired. Frontend renders matching state
// for each branch (UX-spelled-out errors instead of raw HTTP codes).
//
// Anti-leak (.claude/rules/45-mock-exams.md):
//   - tutor card whitelist (name, avatar_url, bio, subjects) — no
//     telegram_id / booking_link.
//   - rubric_text / rubric_image_urls NEVER render.
//   - solution_text / correct_answer present only after approval (backend
//     gates this; frontend just renders what comes back).
//
// Mobile-first: родители на телефонах. max-w 640px container, 16px text-base
// для CTA / inputs, 44×44 touch-targets, layout breaks down clean при 375px.

import { lazy, Suspense, useId } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Clock3,
  FileQuestion,
  GraduationCap,
  Hourglass,
  ChevronDown,
  Send,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  primaryToSecondary,
  getEgePhysicsBenchmarks,
  MAX_PRIMARY_EGE_PHYSICS_2025,
} from '@/lib/mockExamScaleEge2025';
import {
  fetchPublicMockResult,
  type PublicMockResultData,
  type PublicMockResultPart1Answer,
  type PublicMockResultPart2Solution,
  type PublicMockResultTutor,
} from '@/lib/mockExamPublicApi';

// MathText is heavy (KaTeX bundle). Lazy-load — most parents won't expand
// per-task drill-down, so we don't need to ship it on first paint.
const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

// ─── Date formatting ─────────────────────────────────────────────────────────

function formatRussianDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), 'd MMMM yyyy', { locale: ru });
  } catch {
    return null;
  }
}

// ─── EGE physics canonical thresholds ────────────────────────────────────────
//
// Единый источник со студенческим экраном — mockExamScaleEge2025 (ФИПИ-таблица
// 45 первичных → 100 тестовых). Порог 8 (= 36 тестовых), хорошо 27 (≈ 68 тестовых).
// Применяется, когда максимум варианта = 45 (канон ЕГЭ физика). Иначе — только
// первичный балл, без меток и тестового балла.

interface ScaleConfig {
  max: number;
  passingPrimary: number | null;
  goodPrimary: number | null;
  /** Predicted test score (out of 100). null = no conversion. */
  testScore: number | null;
}

function buildScaleConfig(
  totalScore: number | null,
  variantMax: number | null,
  examType: string | null,
): ScaleConfig {
  const max =
    variantMax && variantMax > 0 ? variantMax : MAX_PRIMARY_EGE_PHYSICS_2025;
  const benchmarks = getEgePhysicsBenchmarks({ totalMax: max, examType });
  if (benchmarks) {
    return {
      max,
      passingPrimary: benchmarks.pass,
      goodPrimary: benchmarks.good,
      testScore: primaryToSecondary(totalScore ?? 0),
    };
  }
  return {
    max,
    passingPrimary: null,
    goodPrimary: null,
    testScore: null,
  };
}

// ─── State screens (loading / error / not_ready / expired / not_found) ──────

function StateScreen({
  icon,
  title,
  description,
  iconClassName = 'text-slate-500 bg-slate-100',
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  iconClassName?: string;
}) {
  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto flex max-w-[560px] flex-col items-center text-center">
        <div className={`mb-4 rounded-full p-4 ${iconClassName}`} aria-hidden="true">
          {icon}
        </div>
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        <p className="mt-2 text-base text-slate-600">{description}</p>
      </div>
    </div>
  );
}

function FooterCaption() {
  return (
    <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
      Через платформу <strong className="text-slate-700">Сократ AI</strong> ·
      тестовый балл предварительный, окончательная шкала — после ЕГЭ-2026
    </p>
  );
}

// ─── Header (eyebrow + h1 student name + tutor sub-line) ─────────────────────

function ResultHeader({
  studentName,
  submittedAt,
  tutorName,
  isManualEntry,
  manualDate,
}: {
  studentName: string;
  submittedAt: string | null;
  tutorName: string | null;
  isManualEntry: boolean;
  manualDate: string | null;
}) {
  const dateLabel = isManualEntry
    ? formatRussianDate(manualDate)
    : formatRussianDate(submittedAt);

  return (
    <header className="mb-6">
      {/* Нейтрально без предмета: пробники мультипредметные (2026-07-22),
          а public-payload subject не несёт — «по физике» врал обществознанию. */}
      <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">
        Результат пробника
      </p>
      <h1 className="text-2xl font-semibold leading-tight text-slate-900 sm:text-3xl">
        {studentName}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {dateLabel ? <>Сдан {dateLabel}</> : 'Дата сдачи не указана'}
        {tutorName ? <> · проверил репетитор {tutorName}</> : null}
      </p>
    </header>
  );
}

// ─── Score panel (big number, scale, part1/part2 split) ──────────────────────

function ScorePanel({
  data,
  scale,
}: {
  data: PublicMockResultData;
  scale: ScaleConfig;
}) {
  const totalScore = data.attempt.total_score ?? 0;
  const part1Score = data.attempt.total_part1_score;
  const part2Score = data.attempt.total_part2_score;
  const part1Max = data.variant?.part1_max ?? null;
  const part2Max = data.variant?.part2_max ?? null;

  const ratio = scale.max > 0 ? Math.min(1, Math.max(0, totalScore / scale.max)) : 0;
  const widthPct = `${(ratio * 100).toFixed(1)}%`;

  // Bar colour mirrors threshold logic from mockup: red < passing, amber
  // between passing and good, emerald >= good. Keep it visually quiet —
  // single colour is fine; the labels do the heavy lifting.
  const barColour =
    scale.passingPrimary !== null && totalScore < scale.passingPrimary
      ? 'bg-red-500'
      : scale.goodPrimary !== null && totalScore < scale.goodPrimary
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 text-center sm:p-6">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
        Первичный балл
      </div>
      <div
        className="mb-2 text-5xl font-semibold text-accent sm:text-6xl"
        aria-label={`Набрано ${totalScore} из ${scale.max} баллов`}
      >
        {totalScore}{' '}
        <span className="text-2xl font-normal text-slate-500 sm:text-3xl">
          / {scale.max}
        </span>
      </div>

      {scale.testScore !== null ? (
        <div className="mb-4 text-sm text-slate-500">
          Тестовый балл (предварительно): ~{scale.testScore} / 100
        </div>
      ) : null}

      <div className="my-5">
        <div
          className="relative h-3 rounded-full bg-slate-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={scale.max}
          aria-valuenow={totalScore}
          aria-label="Шкала первичных баллов"
        >
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${barColour}`}
            style={{ width: widthPct }}
          />
          {scale.passingPrimary !== null && scale.max > 0 ? (
            <span
              className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-amber-500"
              style={{ left: `${(scale.passingPrimary / scale.max) * 100}%` }}
              aria-hidden="true"
            />
          ) : null}
          {scale.goodPrimary !== null && scale.max > 0 ? (
            <span
              className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-emerald-700"
              style={{ left: `${(scale.goodPrimary / scale.max) * 100}%` }}
              aria-hidden="true"
            />
          ) : null}
        </div>
        {scale.passingPrimary !== null && scale.goodPrimary !== null && scale.max > 0 ? (
          <div className="relative mt-1.5 h-4 text-xs tabular-nums text-slate-400">
            <span className="absolute left-0">0</span>
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap text-amber-600"
              style={{ left: `${(scale.passingPrimary / scale.max) * 100}%` }}
            >
              {scale.passingPrimary} порог
            </span>
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap text-emerald-700"
              style={{ left: `${(scale.goodPrimary / scale.max) * 100}%` }}
            >
              {scale.goodPrimary} «хорошо»
            </span>
            <span className="absolute right-0">{scale.max}</span>
          </div>
        ) : (
          <div className="mt-1.5 flex justify-between text-xs tabular-nums text-slate-400">
            <span>0</span>
            <span>{scale.max}</span>
          </div>
        )}
      </div>

      {part1Score !== null || part2Score !== null ? (
        <div className="flex justify-center gap-6 text-sm">
          {part1Score !== null ? (
            <div>
              <div className="text-xs text-slate-500">Часть&nbsp;1</div>
              <div className="font-semibold text-slate-900 tabular-nums">
                {part1Score}
                {part1Max !== null ? ` / ${part1Max}` : null}
              </div>
            </div>
          ) : null}
          {part2Score !== null ? (
            <div>
              <div className="text-xs text-slate-500">Часть&nbsp;2</div>
              <div className="font-semibold text-slate-900 tabular-nums">
                {part2Score}
                {part2Max !== null ? ` / ${part2Max}` : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Tutor comment / manual_comment block ────────────────────────────────────

function TutorCommentBlock({ comment }: { comment: string }) {
  // Name intentionally omitted from heading — RU genitive case ('Егора',
  // 'Анны') varies per name and we can't reliably inflect; tutor identity
  // is shown in the card below in correct nominative form.
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 sm:p-5">
      <p className="mb-1 font-semibold">Комментарий репетитора</p>
      <p className="whitespace-pre-line">{comment}</p>
    </div>
  );
}

// ─── Tutor CTA card ──────────────────────────────────────────────────────────
//
// CTA «Связаться с репетитором» — деградирует gracefully. Если backend
// выдал `tutor.telegram_username` (out-of-current-anti-leak — потребует
// расширения loadTutorCard для scope='parent_result'), рендерим прямую
// markdown-ссылку на t.me/<username>. Иначе — reassurance-текст.

function TutorContactCard({
  tutor,
}: {
  tutor: PublicMockResultTutor;
}) {
  const telegramUsername = tutor.telegram_username?.trim().replace(/^@/, '') ?? '';
  const telegramHref =
    telegramUsername.length > 0
      ? `https://t.me/${encodeURIComponent(telegramUsername)}`
      : null;
  const bookingLink = tutor.booking_link?.trim() ?? '';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-4">
        <UserAvatar
          avatarUrl={tutor.avatar_url}
          name={tutor.name}
          gender={null}
          size="md"
          className="flex-none"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1.5">
            <GraduationCap
              className="h-3.5 w-3.5 text-slate-500"
              aria-hidden="true"
            />
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Репетитор
            </span>
          </div>
          <h3 className="text-base font-semibold text-slate-900">
            {tutor.name || 'Репетитор'}
          </h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Готов разобрать результат и&nbsp;составить план
          </p>
        </div>
      </div>

      {telegramHref ? (
        <Button
          asChild
          className="min-h-[48px] w-full bg-accent text-base font-medium text-white hover:bg-accent/90"
          style={{ touchAction: 'manipulation' }}
        >
          <a
            href={telegramHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Открыть чат с репетитором ${tutor.name || ''} в Telegram`}
          >
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            Написать репетитору в&nbsp;Telegram
          </a>
        </Button>
      ) : bookingLink ? (
        <Button
          asChild
          className="min-h-[48px] w-full bg-accent text-base font-medium text-white hover:bg-accent/90"
          style={{ touchAction: 'manipulation' }}
        >
          <a
            href={bookingLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Записаться к репетитору ${tutor.name || ''}`}
          >
            Записаться на занятие
          </a>
        </Button>
      ) : (
        <div className="rounded-md bg-slate-50 px-3 py-3 text-center text-sm text-slate-600">
          Репетитор сам свяжется с&nbsp;вами по&nbsp;контакту, который
          вы&nbsp;оставили при&nbsp;записи на&nbsp;пробник.
        </div>
      )}
    </div>
  );
}

// ─── Per-task drill-down (collapsible, mobile-friendly) ──────────────────────
//
// Показываем разбор Часть 1 + Часть 2 для approved attempt. Скрываем для
// manually_entered (там нет per-task разбора по дизайну).

function PerTaskBreakdown({ data }: { data: PublicMockResultData }) {
  const summaryId = useId();
  const part1 = data.part1_answers;
  const part2 = data.part2_solutions;
  if (part1.length === 0 && part2.length === 0) return null;

  return (
    <details className="group rounded-lg border border-slate-200 bg-white">
      <summary
        id={summaryId}
        className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-slate-900 [&::-webkit-details-marker]:hidden"
      >
        <span>Разбор по задачам ({part1.length + part2.length})</span>
        <ChevronDown
          className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-slate-100 px-4 pb-4 pt-3 sm:px-5">
        {part1.length > 0 ? (
          <section aria-labelledby={`${summaryId}-p1`}>
            <h2
              id={`${summaryId}-p1`}
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Часть 1
            </h2>
            <ul className="divide-y divide-slate-100">
              {part1.map((row) => (
                <Part1Row key={`p1-${row.kim_number}`} row={row} />
              ))}
            </ul>
          </section>
        ) : null}

        {part2.length > 0 ? (
          <section
            aria-labelledby={`${summaryId}-p2`}
            className={part1.length > 0 ? 'mt-5' : ''}
          >
            <h2
              id={`${summaryId}-p2`}
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Часть 2
            </h2>
            <ul className="space-y-3">
              {part2.map((row) => (
                <Part2Row key={`p2-${row.kim_number}`} row={row} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </details>
  );
}

function Part1Row({ row }: { row: PublicMockResultPart1Answer }) {
  const isCorrect =
    row.earned_score !== null && row.earned_score >= row.max_score && row.max_score > 0;
  const isWrong = row.earned_score === 0 || row.earned_score === null;
  const dotClass = isCorrect
    ? 'bg-emerald-500'
    : isWrong
    ? 'bg-red-500'
    : 'bg-amber-500';

  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <span
        className={`mt-1.5 inline-block h-2 w-2 flex-none rounded-full ${dotClass}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium text-slate-900">
            № {row.kim_number}
          </span>
          <span className="text-xs tabular-nums text-slate-500">
            {row.earned_score ?? 0} / {row.max_score}
          </span>
        </div>
        {row.student_answer || row.correct_answer ? (
          <div className="mt-0.5 text-xs text-slate-500">
            <span>Ответ: </span>
            <span className="text-slate-700">{row.student_answer || '—'}</span>
            {row.correct_answer && row.student_answer !== row.correct_answer ? (
              <>
                {' · '}
                <span>Верно: </span>
                <span className="text-emerald-700">{row.correct_answer}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Part2Row({ row }: { row: PublicMockResultPart2Solution }) {
  return (
    <li className="rounded-md border border-slate-100 bg-slate-50/40 p-3 text-sm">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="font-medium text-slate-900">№ {row.kim_number}</span>
        <span className="text-xs tabular-nums text-slate-500">
          {row.tutor_score ?? 0} / {row.max_score}
        </span>
      </div>
      {row.task_text ? (
        <Suspense fallback={<p className="text-xs text-slate-600">{row.task_text}</p>}>
          <MathText
            text={row.task_text}
            className="text-xs leading-relaxed text-slate-600"
          />
        </Suspense>
      ) : null}
      {row.tutor_comment ? (
        <p className="mt-2 rounded-md bg-emerald-50/80 p-2 text-xs text-emerald-900 whitespace-pre-line">
          <strong className="font-semibold">Комментарий репетитора: </strong>
          {row.tutor_comment}
        </p>
      ) : null}
    </li>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PublicMockResult() {
  const { slug = '' } = useParams<{ slug: string }>();

  const query = useQuery({
    queryKey: ['public-mock-result', slug],
    queryFn: () => fetchPublicMockResult(slug),
    staleTime: 60_000,
    retry: 1,
  });

  if (query.isLoading) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 px-4 py-8 text-slate-900">
        <div className="mx-auto max-w-[640px] space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-44" />
          <Skeleton className="h-24" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <StateScreen
        icon={<AlertCircle className="h-6 w-6" />}
        title="Не удалось загрузить результат"
        description="Проверьте интернет и обновите страницу. Если не помогает — попросите репетитора прислать ссылку ещё раз."
      />
    );
  }

  const result = query.data;

  if (result.status === 'invalid_slug' || result.status === 'not_found') {
    return (
      <StateScreen
        icon={<FileQuestion className="h-6 w-6" />}
        title="Ссылка не найдена"
        description="Проверьте адрес или попросите репетитора прислать новую ссылку."
      />
    );
  }

  if (result.status === 'expired') {
    return (
      <StateScreen
        icon={<Clock3 className="h-6 w-6" />}
        title="Срок действия ссылки истёк"
        description="Попросите репетитора отправить новую ссылку на этот результат."
      />
    );
  }

  if (result.status === 'not_ready') {
    return (
      <StateScreen
        icon={<Hourglass className="h-6 w-6" />}
        iconClassName="text-amber-600 bg-amber-50"
        title="Результат ещё проверяется"
        description="Репетитор завершит проверку Части 2 в течение 24 часов и пришлёт ссылку повторно."
      />
    );
  }

  if (result.status === 'error') {
    return (
      <StateScreen
        icon={<AlertCircle className="h-6 w-6" />}
        title="Не удалось загрузить результат"
        description={result.message}
      />
    );
  }

  // ─── status === 'ok' ───────────────────────────────────────────────────────

  const isManualEntry = result.attempt.status === 'manually_entered';
  const studentName =
    // Backend пока не возвращает student_display_name в публичном payload
    // (anti-leak — мы и не хотим). Заголовок строим из assignment title /
    // variant title — это безопасный, recognizable label для родителя.
    result.assignment.display_title || result.assignment.title || 'Результат';
  const scale = buildScaleConfig(
    result.attempt.total_score,
    result.variant?.total_max_score ?? null,
    result.variant?.exam_type ?? null,
  );

  const tutorComment =
    (isManualEntry ? result.attempt.manual_comment : null) ?? null;

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-[640px] px-4 py-6 sm:px-6 sm:py-10">
        <ResultHeader
          studentName={studentName}
          submittedAt={result.attempt.submitted_at}
          tutorName={result.tutor?.name ?? null}
          isManualEntry={isManualEntry}
          manualDate={result.attempt.manual_entered_date}
        />

        <div className="space-y-4">
          <ScorePanel data={result} scale={scale} />

          {tutorComment ? <TutorCommentBlock comment={tutorComment} /> : null}

          {!isManualEntry &&
          (result.part1_answers.length > 0 || result.part2_solutions.length > 0) ? (
            <PerTaskBreakdown data={result} />
          ) : null}

          {result.tutor ? <TutorContactCard tutor={result.tutor} /> : null}
        </div>

        <FooterCaption />
      </div>
    </div>
  );
}
