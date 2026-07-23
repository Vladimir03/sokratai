// Mock Exams v1 — public (anonymous) API client.
//
// Backend: supabase/functions/mock-exam-public/index.ts
// Spec: docs/delivery/features/mock-exams-v1/spec.md §5 API public + AC-6/AC-7
//
// No JWT, no session — service_role на стороне edge function. Anti-leak
// контракт описан в spec и в самом edge-функции (column whitelists,
// status gates).
//
// HARDCODED SUPABASE_URL — RU bypass через Selectel VPS proxy. См.
// `src/lib/supabaseClient.ts` для rationale.

const SUPABASE_URL = 'https://api.sokratai.ru';
const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`;
const MOCK_INVITE_SLUG_RE = /^[a-z0-9]{8}$/i;

// ─── Public read shapes (mirrors edge function jsonResponse) ─────────────────

export interface PublicMockInviteTutor {
  name: string;
  avatar_url: string | null;
  bio: string | null;
  subjects: string[];
}

export interface PublicMockInviteVariant {
  title: string;
  exam_type: string;
  /**
   * Предмет варианта. Ревью 5.6 P1 #4: без него публичная страница-приглашение
   * была захардкожена физикой. `null` = легаси-строка (забэкфилена физикой) или
   * старый edge (deploy-skew) → клиент читает как physics.
   */
  subject: string | null;
  source: string;
  source_attribution: string | null;
  duration_minutes: number;
  total_max_score: number;
  part1_max: number;
  part2_max: number;
  task_count: number;
}

export interface PublicMockInviteAssignment {
  id: string;
  title: string;
  mode: 'blank' | 'form' | 'manual_entry';
}

export interface PublicMockInviteData {
  expired: boolean;
  assignment: PublicMockInviteAssignment;
  tutor: PublicMockInviteTutor | null;
  variant: PublicMockInviteVariant | null;
  // tasks отдаются эндпоинтом, но на invite-экране нам нужна только мета —
  // не вытягиваем их в типе, чтобы не плодить мусор.
  expires_at: string | null;
}

export type PublicMockInviteResult =
  | { status: 'invalid_slug' }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'not_available' }
  | { status: 'error'; message: string }
  | ({ status: 'ok' } & PublicMockInviteData);

export type ContactType = 'telegram' | 'email';

export interface StartMockInvitePayload {
  lead_name: string;
  lead_contact: string;
  contact_type: ContactType;
  consent: boolean;
}

export interface StartMockInviteSuccess {
  attempt_id: string;
  anonymous_id: string;
}

export type StartMockInviteResult =
  | { status: 'ok'; data: StartMockInviteSuccess }
  | { status: 'invalid_slug' }
  | { status: 'expired' }
  | { status: 'not_available' }
  | { status: 'not_found' }
  | { status: 'validation'; field: string; message: string }
  | { status: 'error'; message: string };

// ─── GET /share/mock-invite/:slug ────────────────────────────────────────────

export async function fetchPublicMockInvite(
  slug: string,
): Promise<PublicMockInviteResult> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!MOCK_INVITE_SLUG_RE.test(normalizedSlug)) {
    return { status: 'invalid_slug' };
  }

  let response: Response;
  try {
    response = await fetch(
      `${FUNCTIONS_BASE_URL}/mock-exam-public/share/mock-invite/${encodeURIComponent(normalizedSlug)}`,
    );
  } catch (err) {
    return {
      status: 'error',
      message:
        err instanceof Error
          ? err.message
          : 'Не удалось загрузить пробник. Проверьте интернет.',
    };
  }

  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (response.status === 400) return { status: 'invalid_slug' };
  if (response.status === 404) return { status: 'not_found' };
  if (payload?.expired === true) return { status: 'expired' };
  if (response.status === 410 && payload?.error === 'not_available') {
    return { status: 'not_available' };
  }

  if (!response.ok) {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : 'Не удалось загрузить пробник';
    return { status: 'error', message };
  }

  const assignment = payload?.assignment as PublicMockInviteAssignment | undefined;
  if (!assignment || typeof assignment.id !== 'string') {
    return { status: 'error', message: 'Неполный ответ сервера' };
  }

  return {
    status: 'ok',
    expired: payload?.expired === true,
    assignment,
    tutor: (payload?.tutor as PublicMockInviteTutor | null) ?? null,
    variant: (payload?.variant as PublicMockInviteVariant | null) ?? null,
    expires_at:
      typeof payload?.expires_at === 'string' ? payload.expires_at : null,
  };
}

// ─── POST /share/mock-invite/:slug/start ─────────────────────────────────────

export async function startPublicMockInvite(
  slug: string,
  payload: StartMockInvitePayload,
): Promise<StartMockInviteResult> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!MOCK_INVITE_SLUG_RE.test(normalizedSlug)) {
    return { status: 'invalid_slug' };
  }

  let response: Response;
  try {
    response = await fetch(
      `${FUNCTIONS_BASE_URL}/mock-exam-public/share/mock-invite/${encodeURIComponent(normalizedSlug)}/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
  } catch (err) {
    return {
      status: 'error',
      message:
        err instanceof Error
          ? err.message
          : 'Не удалось отправить форму. Проверьте интернет.',
    };
  }

  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (response.status === 400) {
    if (body?.error === 'invalid_slug') return { status: 'invalid_slug' };
    if (body?.error === 'validation') {
      return {
        status: 'validation',
        field: typeof body.field === 'string' ? body.field : 'unknown',
        message: typeof body.message === 'string' ? body.message : 'invalid',
      };
    }
    return {
      status: 'error',
      message:
        typeof body?.error === 'string' ? body.error : 'Некорректный запрос',
    };
  }
  if (response.status === 404) return { status: 'not_found' };
  if (body?.expired === true) return { status: 'expired' };
  if (response.status === 410 && body?.error === 'not_available') {
    return { status: 'not_available' };
  }

  if (!response.ok) {
    return {
      status: 'error',
      message:
        typeof body?.error === 'string' ? body.error : 'Не удалось отправить форму',
    };
  }

  if (
    !body ||
    typeof body.attempt_id !== 'string' ||
    typeof body.anonymous_id !== 'string'
  ) {
    return { status: 'error', message: 'Неполный ответ сервера' };
  }

  return {
    status: 'ok',
    data: {
      attempt_id: body.attempt_id,
      anonymous_id: body.anonymous_id,
    },
  };
}

// ─── GET /share/mock-result/:slug ────────────────────────────────────────────
//
// Parent share-link result. AC-7: 200 при `status='approved'` или
// `'manually_entered'`; 403 `not_ready` при `awaiting_review` / других
// non-terminal статусах; 410 `expired`; 404 `not_found`.
//
// Anti-leak (per .claude/rules/45-mock-exams.md + edge function):
//   - tutor card whitelist: name, avatar_url, bio, subjects (НЕ telegram_id /
//     booking_link / email).
//   - solution_text + correct_answer открываются только для approved
//     attempts; для manually_entered — нет per-task разбора.
//
// Note: tutor.telegram_username намеренно отсутствует в публичном payload
// (anti-leak invariant). Frontend CTA «Связаться в Telegram» рендерится
// gracefully degraded когда поля нет: показывается reassurance-текст
// «репетитор сам свяжется по оставленному контакту». Если когда-нибудь
// понадобится прямая ссылка — расширить loadTutorCard для scope='parent_result'
// (отдельная spec, не в текущем TASK).

export interface PublicMockResultTutor {
  name: string;
  avatar_url: string | null;
  bio: string | null;
  subjects: string[];
  // Optional: backend MAY add these in a future iteration for parent_result
  // scope only. Frontend handles their absence gracefully.
  telegram_username?: string | null;
  booking_link?: string | null;
}

export type PublicMockResultAttemptStatus =
  | 'approved'
  | 'manually_entered';

export interface PublicMockResultAttempt {
  id: string;
  status: PublicMockResultAttemptStatus;
  started_at: string | null;
  submitted_at: string | null;
  total_time_minutes: number | null;
  total_part1_score: number | null;
  total_part2_score: number | null;
  total_score: number | null;
  manual_entered_date: string | null;
  manual_comment: string | null;
  blank_photo_url: string | null;
}

export interface PublicMockResultVariant {
  title: string;
  exam_type: string;
  total_max_score: number;
  part1_max: number;
  part2_max: number;
}

export interface PublicMockResultAssignment {
  id: string;
  title: string;
  mode: 'blank' | 'form' | 'manual_entry';
  display_title: string;
}

/** Single Часть 1 answer with correct answer revealed post-approval. */
export interface PublicMockResultPart1Answer {
  kim_number: number;
  student_answer: string | null;
  earned_score: number | null;
  correct_answer: string | null;
  max_score: number;
  check_mode: string | null;
}

/** Single Часть 2 solution with tutor-confirmed score + AI/tutor comment. */
export interface PublicMockResultPart2Solution {
  kim_number: number;
  photo_url: string | null;
  tutor_score: number | null;
  tutor_comment: string | null;
  status: string;
  task_text: string | null;
  task_image_url: string | null;
  max_score: number;
  solution_text: string | null;
}

export interface PublicMockResultData {
  expired: boolean;
  tutor: PublicMockResultTutor | null;
  assignment: PublicMockResultAssignment;
  variant: PublicMockResultVariant | null;
  attempt: PublicMockResultAttempt;
  part1_answers: PublicMockResultPart1Answer[];
  part2_solutions: PublicMockResultPart2Solution[];
  expires_at: string | null;
}

export type PublicMockResultResult =
  | { status: 'invalid_slug' }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'not_ready'; attemptStatus: string | null }
  | { status: 'error'; message: string }
  | ({ status: 'ok' } & PublicMockResultData);

export async function fetchPublicMockResult(
  slug: string,
): Promise<PublicMockResultResult> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!MOCK_INVITE_SLUG_RE.test(normalizedSlug)) {
    return { status: 'invalid_slug' };
  }

  let response: Response;
  try {
    response = await fetch(
      `${FUNCTIONS_BASE_URL}/mock-exam-public/share/mock-result/${encodeURIComponent(normalizedSlug)}`,
    );
  } catch (err) {
    return {
      status: 'error',
      message:
        err instanceof Error
          ? err.message
          : 'Не удалось загрузить результат. Проверьте интернет.',
    };
  }

  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (response.status === 400) return { status: 'invalid_slug' };
  if (response.status === 404) return { status: 'not_found' };
  if (payload?.expired === true) return { status: 'expired' };
  if (response.status === 403 && payload?.error === 'not_ready') {
    return {
      status: 'not_ready',
      attemptStatus:
        typeof payload.status === 'string' ? payload.status : null,
    };
  }

  if (!response.ok) {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : 'Не удалось загрузить результат';
    return { status: 'error', message };
  }

  const attempt = payload?.attempt as PublicMockResultAttempt | undefined;
  const assignment = payload?.assignment as PublicMockResultAssignment | undefined;
  if (!attempt || !assignment) {
    return { status: 'error', message: 'Неполный ответ сервера' };
  }

  // Belt-and-suspenders: backend already gates на 403 для не-approved/manual,
  // но фронтенд тоже не должен показывать частичные результаты. Если backend
  // когда-нибудь вернёт что-то вроде 'submitted' — UI трактует как not_ready.
  if (
    attempt.status !== 'approved' &&
    attempt.status !== 'manually_entered'
  ) {
    return { status: 'not_ready', attemptStatus: attempt.status };
  }

  return {
    status: 'ok',
    expired: payload?.expired === true,
    tutor: (payload?.tutor as PublicMockResultTutor | null) ?? null,
    assignment,
    variant: (payload?.variant as PublicMockResultVariant | null) ?? null,
    attempt,
    part1_answers: Array.isArray(payload?.part1_answers)
      ? (payload.part1_answers as PublicMockResultPart1Answer[])
      : [],
    part2_solutions: Array.isArray(payload?.part2_solutions)
      ? (payload.part2_solutions as PublicMockResultPart2Solution[])
      : [],
    expires_at:
      typeof payload?.expires_at === 'string' ? payload.expires_at : null,
  };
}
