// PublicMockInvite — public anonymous lead-gen page for mock exams.
//
// Route: /p/mock-invite/:slug  (App.tsx)
// Mounted OUTSIDE AppFrame / TutorGuard / AuthGuard — true public surface.
//
// Flow (mockup Screen 7 + olympiad UX, mock-exams-v1 spec §5 + AC-6,
// mock-exams-v1-pilot-polish AC-P8):
//   1. GET /share/mock-invite/:slug → tutor card + offer + tasks meta
//   2. Form: имя ребёнка + Telegram/email + consent + privacy link
//   3. POST /share/mock-invite/:slug/start → returns { attempt_id, anonymous_id }
//   4. Auto-open confirm dialog «Готов начать? 4 часа» (self-serve, НЕ external
//      approval gate — Vladimir/tutor approval больше не требуется).
//   5. On confirm → navigate /student/mock-exams/:assignment_id (taking surface).
//      Anonymous students will be intercepted by AuthGuard → login → return.
//      Full anonymous taking flow остаётся out of scope (TASK-12).
//
// Branding (product-nuances #11): tutor identity primary, «через Сократ AI»
// в малом подвале. Privacy policy ссылка обязательна (#7 — юридический риск).
//
// Mobile-first: single-column 560-640px max-width, text-base (16px) на inputs,
// 44×44 touch-targets на checkbox/CTA.

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSubjectLabel } from '@/types/homework';
import {
  AlertCircle,
  Clock3,
  FileQuestion,
  GraduationCap,
  Loader2,
  CheckCircle2,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  fetchPublicMockInvite,
  startPublicMockInvite,
  type ContactType,
  type PublicMockInviteData,
} from '@/lib/mockExamPublicApi';
import { detectContactType } from '@/lib/mockExamContactType';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

const CONTACT_VALIDATION_MESSAGES: Record<string, string> = {
  required: 'Это поле обязательно',
  too_long: 'Слишком длинное значение',
  invalid: 'Неверный формат',
  consent_required: 'Нужно дать согласие, чтобы продолжить',
};

// ─── Status / wrapper components ─────────────────────────────────────────────

function StateScreen({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto flex max-w-[560px] flex-col items-center text-center">
        <div
          className="mb-4 rounded-full bg-slate-100 p-4 text-slate-500"
          aria-hidden="true"
        >
          {icon}
        </div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-base text-slate-600">{description}</p>
      </div>
    </div>
  );
}

function FooterCaption() {
  return (
    <p className="mt-6 text-center text-xs text-slate-500">
      Через платформу <strong className="text-slate-700">Сократ AI</strong> ·
      диагностика без надзора, не школьный экзамен
    </p>
  );
}

// ─── Post-submit ready-to-start panel ────────────────────────────────────────
//
// Olympiad-style flow (TASK-7, F8): после успешного POST на startPublicMockInvite
// — НЕ показываем «ждите репетитора», лид уже зафиксирован в
// `mock_exam_anonymous_leads` (AC-6 из mock-exams-v1) и tutor получает push
// независимо. Ученик сам решает когда начать; confirm dialog защищает от
// случайного клика по «Начать пробник» (4-часовой таймер).

function ReadyToStartPanel({
  leadName,
  onStart,
}: {
  leadName: string;
  onStart: () => void;
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
          aria-hidden="true"
        >
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-900">
            Готово, {leadName}! Можно начинать.
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Заявка сохранена. Когда нажмёшь «Начать пробник», запустится
            таймер на&nbsp;4&nbsp;часа — сразу откроется первая задача.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-md bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-600">
        <strong className="font-semibold text-slate-700">Как устроен пробник:</strong>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Часть&nbsp;1 (1–20) проверится автоматически — баллы сразу</li>
          <li>Часть&nbsp;2 (21–26) проверит репетитор и&nbsp;пришлёт разбор в&nbsp;течение&nbsp;24&nbsp;часов</li>
          <li>Перед стартом приготовь PDF бланка ответов — его дадим скачать на странице пробника</li>
        </ul>
      </div>

      <Button
        type="button"
        onClick={onStart}
        className="mt-4 min-h-[48px] w-full bg-accent text-base font-medium text-white hover:bg-accent/90"
        style={{ touchAction: 'manipulation' }}
      >
        <Play className="mr-2 h-4 w-4" aria-hidden="true" />
        Начать пробник
      </Button>
    </div>
  );
}

// ─── Olympiad-style confirm dialog ───────────────────────────────────────────
//
// Self-serve confirm (НЕ external approval gate). Защита от случайного клика
// по «Начать» — 4-часовой таймер запускается необратимо при заходе на
// taking surface. См. spec.md → «F8 «Готов начать» без подтверждения».

function ConfirmStartDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Готов начать?</DialogTitle>
          <DialogDescription className="text-slate-600">
            Тебе будет дано <strong>4 часа</strong> на прохождение пробника.
            Таймер запустится сразу — лучше начинать в спокойной обстановке.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="min-h-[44px]"
            style={{ touchAction: 'manipulation' }}
          >
            Позже
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className="min-h-[44px] bg-accent text-white hover:bg-accent/90"
            style={{ touchAction: 'manipulation' }}
          >
            Готов начать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tutor card ──────────────────────────────────────────────────────────────

function TutorCard({ tutor }: { tutor: PublicMockInviteData['tutor'] }) {
  if (!tutor) return null;

  // tutors.subjects хранит id ('physics') — ученику/родителю показываем лейблы.
  const subjectsLine =
    tutor.subjects && tutor.subjects.length > 0
      ? tutor.subjects.map(getSubjectLabel).join(', ')
      : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <UserAvatar
          avatarUrl={tutor.avatar_url}
          name={tutor.name}
          gender={null}
          size="md"
          className="flex-none"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5">
            <GraduationCap
              className="h-3.5 w-3.5 text-slate-500"
              aria-hidden="true"
            />
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Репетитор
            </span>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">
            {tutor.name || 'Репетитор'}
          </h2>
          {tutor.bio ? (
            <p className="mt-1 text-sm text-slate-600">{tutor.bio}</p>
          ) : subjectsLine ? (
            <p className="mt-1 text-sm text-slate-500">{subjectsLine}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Offer block ─────────────────────────────────────────────────────────────

function OfferBlock({ data }: { data: PublicMockInviteData }) {
  const { variant } = data;
  const subtitle =
    variant?.title ?? data.assignment.title ?? 'Тренировочный вариант';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold leading-tight text-slate-900 sm:text-[28px]">
          Бесплатный диагностический пробник по&nbsp;физике
        </h1>
        <p className="mt-2 text-sm text-slate-700">
          {subtitle}. После сдачи Часть&nbsp;1 (1–20) проверится автоматически
          и&nbsp;ты&nbsp;увидишь баллы сразу. Часть&nbsp;2 (21–26) репетитор
          лично проверит и&nbsp;пришлёт разбор в&nbsp;течение 24&nbsp;часов.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-sm">
        <Metric label="Время" value={formatDuration(variant?.duration_minutes ?? null)} />
        <Metric
          label="Заданий"
          value={variant?.task_count ? String(variant.task_count) : '—'}
        />
        <Metric
          label="Стоимость"
          value="Бесплатно"
          valueClassName="text-emerald-700"
        />
      </div>

      <p className="text-xs text-slate-500">
        Для прохождения нужны фото бланка ответов (Часть&nbsp;1) и&nbsp;решений
        Части&nbsp;2. PDF бланка дадим перед стартом.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-base font-medium text-slate-900 ${valueClassName ?? ''}`}>
        {value}
      </div>
    </div>
  );
}

// ─── Lead capture form ───────────────────────────────────────────────────────

interface LeadFormProps {
  slug: string;
  onSuccess: (data: {
    attempt_id: string;
    anonymous_id: string;
    leadName: string;
    contactType: ContactType;
  }) => void;
}

function LeadForm({ slug, onSuccess }: LeadFormProps) {
  const nameId = useId();
  const contactId = useId();
  const consentId = useId();

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    contact?: string;
    consent?: string;
    form?: string;
  }>({});

  const contactType = useMemo(() => detectContactType(contact), [contact]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    const nextErrors: typeof errors = {};
    const trimmedName = name.trim();
    const trimmedContact = contact.trim();
    if (!trimmedName) nextErrors.name = 'Укажи имя ребёнка';
    if (!trimmedContact) nextErrors.contact = 'Укажи Telegram или email';
    if (!consent) nextErrors.consent = 'Нужно согласие на обработку данных';

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);

    const result = await startPublicMockInvite(slug, {
      lead_name: trimmedName,
      lead_contact: trimmedContact,
      contact_type: contactType,
      consent: true,
    });

    setSubmitting(false);

    if (result.status === 'ok') {
      onSuccess({
        attempt_id: result.data.attempt_id,
        anonymous_id: result.data.anonymous_id,
        leadName: trimmedName,
        contactType,
      });
      return;
    }

    if (result.status === 'validation') {
      const message =
        CONTACT_VALIDATION_MESSAGES[result.message] ?? 'Проверьте поле';
      if (result.field === 'lead_name') setErrors({ name: message });
      else if (result.field === 'lead_contact') setErrors({ contact: message });
      else if (result.field === 'consent') setErrors({ consent: message });
      else setErrors({ form: message });
      return;
    }

    if (result.status === 'expired') {
      setErrors({
        form: 'Срок действия ссылки истёк. Попроси репетитора прислать новую.',
      });
      return;
    }
    if (result.status === 'not_available') {
      setErrors({
        form: 'Пробник пока недоступен. Свяжись с репетитором.',
      });
      return;
    }
    if (result.status === 'not_found' || result.status === 'invalid_slug') {
      setErrors({
        form: 'Ссылка не найдена. Возможно, она была удалена.',
      });
      return;
    }
    setErrors({
      form: result.message ?? 'Не удалось отправить форму. Попробуйте ещё раз.',
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-lg bg-slate-50 p-4"
    >
      <p className="mb-3 text-xs font-medium text-slate-700">
        Чтобы получить результат, оставь контакт:
      </p>
      <div className="space-y-3">
        <div>
          <label htmlFor={nameId} className="sr-only">
            Имя ребёнка
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя ребёнка"
            autoComplete="given-name"
            maxLength={200}
            disabled={submitting}
            aria-invalid={errors.name ? 'true' : undefined}
            aria-describedby={errors.name ? `${nameId}-error` : undefined}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-slate-100"
          />
          {errors.name ? (
            <p
              id={`${nameId}-error`}
              className="mt-1 text-xs text-red-600"
              role="alert"
            >
              {errors.name}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={contactId} className="sr-only">
            Telegram или email
          </label>
          <input
            id={contactId}
            type="text"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Telegram (@username) или email"
            autoComplete="email"
            inputMode="email"
            maxLength={200}
            disabled={submitting}
            aria-invalid={errors.contact ? 'true' : undefined}
            aria-describedby={
              errors.contact ? `${contactId}-error` : `${contactId}-hint`
            }
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-slate-100"
          />
          {errors.contact ? (
            <p
              id={`${contactId}-error`}
              className="mt-1 text-xs text-red-600"
              role="alert"
            >
              {errors.contact}
            </p>
          ) : (
            <p id={`${contactId}-hint`} className="mt-1 text-xs text-slate-500">
              Туда пришлём результат и&nbsp;разбор Части&nbsp;2 от&nbsp;репетитора.
            </p>
          )}
        </div>

        <label
          htmlFor={consentId}
          className="flex min-h-[44px] cursor-pointer items-start gap-2.5 py-1 text-xs text-slate-700"
        >
          <input
            id={consentId}
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (e.target.checked && errors.consent) {
                setErrors((prev) => ({ ...prev, consent: undefined }));
              }
            }}
            disabled={submitting}
            aria-invalid={errors.consent ? 'true' : undefined}
            aria-describedby={errors.consent ? `${consentId}-error` : undefined}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-accent"
            style={{ touchAction: 'manipulation' }}
          />
          <span>
            Согласен(на) на обработку персональных данных.{' '}
            <a
              href="/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:text-accent/80"
            >
              Политика конфиденциальности
            </a>
            .
          </span>
        </label>
        {errors.consent ? (
          <p
            id={`${consentId}-error`}
            className="-mt-2 text-xs text-red-600"
            role="alert"
          >
            {errors.consent}
          </p>
        ) : null}
      </div>

      {errors.form ? (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          <AlertCircle
            className="mt-0.5 h-4 w-4 flex-none"
            aria-hidden="true"
          />
          <span>{errors.form}</span>
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={submitting}
        className="mt-4 min-h-[48px] w-full bg-accent text-base font-medium text-white hover:bg-accent/90 disabled:bg-accent/60"
        style={{ touchAction: 'manipulation' }}
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Отправляем…
          </>
        ) : (
          'Начать пробник'
        )}
      </Button>
    </form>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

interface SuccessSnapshot {
  attempt_id: string;
  anonymous_id: string;
  leadName: string;
  contactType: ContactType;
}

export default function PublicMockInvite() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [success, setSuccess] = useState<SuccessSnapshot | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const query = useQuery({
    queryKey: ['public-mock-invite', slug],
    queryFn: () => fetchPublicMockInvite(slug),
    staleTime: 60_000,
    retry: 1,
  });

  // Olympiad flow (TASK-7, AC-P8): после успешного POST лид уже сохранён в
  // mock_exam_anonymous_leads (AC-6) → НЕ показываем «ждите репетитора»,
  // сразу открываем confirm dialog «Готов начать? 4 часа». Подтверждение →
  // navigate на taking surface (`/student/mock-exams/:assignment_id`).
  // Credentials в sessionStorage остаются как hook для будущего anonymous
  // taking flow (TASK-12), сейчас authenticated AuthGuard перехватит
  // anonymous и проведёт через login → возврат на тот же URL.
  const handleStartSuccess = (data: SuccessSnapshot) => {
    try {
      sessionStorage.setItem(
        `mock-exam-anon:${data.attempt_id}`,
        JSON.stringify({
          anonymous_id: data.anonymous_id,
          slug,
          started_at: new Date().toISOString(),
        }),
      );
    } catch {
      // sessionStorage может быть недоступен (Safari private mode) — игнор.
    }
    setSuccess(data);
    setConfirmOpen(true);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleStartNow = (assignmentId: string) => {
    setConfirmOpen(false);
    navigate(`/student/mock-exams/${encodeURIComponent(assignmentId)}`);
  };

  if (query.isLoading) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 px-4 py-8 text-slate-900">
        <div className="mx-auto max-w-[640px] space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <StateScreen
        icon={<AlertCircle className="h-6 w-6" />}
        title="Не удалось открыть ссылку"
        description="Проверьте интернет и обновите страницу. Если не помогает — попросите репетитора прислать новую ссылку."
      />
    );
  }

  const result = query.data;

  if (result.status === 'invalid_slug' || result.status === 'not_found') {
    return (
      <StateScreen
        icon={<FileQuestion className="h-6 w-6" />}
        title="Ссылка не найдена"
        description="Проверь адрес или попроси репетитора создать новую публичную ссылку."
      />
    );
  }

  if (result.status === 'expired') {
    return (
      <StateScreen
        icon={<Clock3 className="h-6 w-6" />}
        title="Срок действия ссылки истёк"
        description="Попроси репетитора прислать новую ссылку на этот пробник."
      />
    );
  }

  if (result.status === 'not_available') {
    return (
      <StateScreen
        icon={<CheckCircle2 className="h-6 w-6" />}
        title="Пробник недоступен"
        description="Назначение завершено или находится в архиве. Свяжись с репетитором, чтобы получить новый."
      />
    );
  }

  if (result.status === 'error') {
    return (
      <StateScreen
        icon={<AlertCircle className="h-6 w-6" />}
        title="Не удалось загрузить пробник"
        description={result.message}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-[640px] px-4 py-8 sm:py-12">
        <TutorCard tutor={result.tutor} />

        {success ? (
          <div className="mt-5 sm:mt-6">
            <ReadyToStartPanel
              leadName={success.leadName}
              onStart={() => setConfirmOpen(true)}
            />
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-slate-200 bg-white p-5 sm:mt-6 sm:p-6">
            <OfferBlock data={result} />
            <div className="mt-5">
              <LeadForm slug={slug} onSuccess={handleStartSuccess} />
            </div>
          </div>
        )}

        <FooterCaption />
      </div>

      <ConfirmStartDialog
        open={confirmOpen && success !== null}
        onOpenChange={setConfirmOpen}
        onConfirm={() => handleStartNow(result.assignment.id)}
      />
    </div>
  );
}
