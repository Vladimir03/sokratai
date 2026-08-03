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
    // Тело несёт машинный код (`internal_error`), а не фразу — показывать его
    // ученику нельзя. Тот же контракт, что у /claim.
    const code = typeof payload?.error === 'string' ? payload.error : null;
    return {
      status: 'error',
      message:
        (code && CLAIM_ERROR_MESSAGES[code]) ||
        'Не удалось загрузить пробник. Обновите страницу или попросите репетитора прислать ссылку заново.',
    };
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

// ─── POST /share/mock-invite/:slug/claim ─────────────────────────────────────
//
// Привязка анонимной попытки к аккаунту после входа/регистрации (решение
// владельца 2026-08-02, вариант «б»).
//
// Раньше страница приглашения после лид-формы вела прямо на
// `/student/mock-exams/:assignment_id`, а тот эндпоинт ищет попытку по
// `student_id = auth.uid()`. У анонимной попытки `student_id` NULL, поэтому
// КАЖДЫЙ, кто заполнил форму, получал «Пробник не найден или не назначен
// этому ученику». Теперь между формой и пробником стоит шаг привязки.
//
// `anonymous_id` — bearer-секрет из ответа /start: держим его в localStorage
// (а не в sessionStorage), потому что вход через Yandex/VK уводит браузер на
// внешний домен и обратно — sessionStorage переживает это не на всех
// платформах.

const PENDING_CLAIM_KEY = 'pending_mock_invite_claim';
/** Потолок ожидания привязки: дольше — показываем «Повторить», а не спиннер. */
const CLAIM_TIMEOUT_MS = 20_000;

/** Машинные коды edge-роута → фразы для ученика (сырой код показывать нельзя). */
const CLAIM_ERROR_MESSAGES: Record<string, string> = {
  internal_error: 'Не удалось связать пробник с аккаунтом. Попробуйте ещё раз.',
  invalid_body: 'Данные заявки повреждены. Откройте ссылку от репетитора заново.',
  validation: 'Данные заявки повреждены. Откройте ссылку от репетитора заново.',
  invalid_slug: 'Ссылка на пробник некорректна. Попросите репетитора прислать новую.',
};

export interface PendingMockInviteClaim {
  slug: string;
  assignment_id: string;
  attempt_id: string;
  anonymous_id: string;
}

/**
 * Зеркало в памяти модуля (внешнее ревью 2026-08-02, P0).
 *
 * Прежний код глотал сбой `localStorage.setItem` с комментарием «данные придут
 * пропсами» — но такого пути не существовало. В приватном режиме / урезанном
 * WebView запись бросает `QuotaExceededError`, лид и попытка на сервере УЖЕ
 * созданы, а экран привязки честно отвечает «Заявка не найдена»: тупик после
 * успешно отправленной формы.
 *
 * Память переживает SPA-навигацию (форма → экран привязки → вход по паролю
 * без перезагрузки), то есть закрывает основной сценарий. Полную перезагрузку
 * и OAuth-редирект она не переживёт — на этот случай `persist…` возвращает
 * `false`, и вызывающий обязан предупредить пользователя ДО перехода.
 */
let inMemoryClaim: PendingMockInviteClaim | null = null;

/** @returns `true`, если запись переживёт перезагрузку страницы. */
export function persistPendingMockInviteClaim(
  claim: PendingMockInviteClaim,
): boolean {
  inMemoryClaim = claim;
  try {
    localStorage.setItem(PENDING_CLAIM_KEY, JSON.stringify(claim));
    // Проверяем чтением: часть WebView «принимает» setItem молча, ничего не
    // сохраняя, — тогда мы бы соврали пользователю про надёжность.
    return localStorage.getItem(PENDING_CLAIM_KEY) !== null;
  } catch {
    return false;
  }
}

export function readPendingMockInviteClaim(
  slug?: string,
): PendingMockInviteClaim | null {
  try {
    const raw = localStorage.getItem(PENDING_CLAIM_KEY);
    if (!raw) return matchSlug(inMemoryClaim, slug);
    const parsed = JSON.parse(raw) as Partial<PendingMockInviteClaim> | null;
    if (
      !parsed ||
      typeof parsed.slug !== 'string' ||
      typeof parsed.assignment_id !== 'string' ||
      typeof parsed.attempt_id !== 'string' ||
      typeof parsed.anonymous_id !== 'string'
    ) {
      return matchSlug(inMemoryClaim, slug);
    }
    return matchSlug(parsed as PendingMockInviteClaim, slug);
  } catch {
    return matchSlug(inMemoryClaim, slug);
  }
}

/** Чужой slug — не наш пробник (ученик открыл вторую ссылку). */
function matchSlug(
  claim: PendingMockInviteClaim | null,
  slug?: string,
): PendingMockInviteClaim | null {
  if (!claim) return null;
  if (slug && claim.slug.toLowerCase() !== slug.trim().toLowerCase()) return null;
  return claim;
}

export function clearPendingMockInviteClaim(): void {
  inMemoryClaim = null;
  try {
    localStorage.removeItem(PENDING_CLAIM_KEY);
  } catch {
    // ignore
  }
}

export type ClaimMockInviteResult =
  | {
    status: 'claimed' | 'already_claimed' | 'already_has_attempt';
    assignment_id: string;
  }
  | { status: 'unauthorized' }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export async function claimMockInviteAttempt(
  claim: PendingMockInviteClaim,
  accessToken: string,
): Promise<ClaimMockInviteResult> {
  const normalizedSlug = claim.slug.trim().toLowerCase();
  if (!MOCK_INVITE_SLUG_RE.test(normalizedSlug)) {
    return { status: 'not_found' };
  }

  // Таймаут обязателен (rule 95: «зависшая загрузка обязана иметь выход»).
  // Под РФ-DPI соединение устанавливается, а ответ не приходит никогда — без
  // AbortController промис не резолвится, и экран навсегда застревает на
  // «Готовим пробник…» без кнопки «Повторить» (P1 внешнего ревью).
  // `AbortSignal.timeout()` НЕ используем — Safari < 16 (rule 80).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLAIM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${FUNCTIONS_BASE_URL}/mock-exam-public/share/mock-invite/${encodeURIComponent(normalizedSlug)}/claim`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          attempt_id: claim.attempt_id,
          anonymous_id: claim.anonymous_id,
        }),
        signal: controller.signal,
      },
    );
  } catch (err) {
    // Таймаут/обрыв — RETRYABLE: bearer-секрет НЕ трогаем, пользователь жмёт
    // «Повторить». Отличаем от терминального 404 намеренно.
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      status: 'error',
      message: aborted
        ? 'Сервер не ответил вовремя. Проверьте интернет и нажмите «Повторить».'
        : err instanceof Error
          ? err.message
          : 'Не удалось связать пробник с аккаунтом. Проверьте интернет.',
    };
  } finally {
    clearTimeout(timeoutId);
  }

  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (response.status === 401) return { status: 'unauthorized' };
  if (response.status === 404) return { status: 'not_found' };
  if (!response.ok) {
    // Тело этого edge-роута несёт МАШИННЫЕ коды (`internal_error`,
    // `invalid_body`…), а не готовую фразу — исторический контракт функции,
    // русские тексты живут на клиенте. Показывать код пользователю нельзя
    // (P2 внешнего ревью: юзер видел буквальное «internal_error»).
    const code = typeof body?.error === 'string' ? body.error : null;
    return {
      status: 'error',
      message:
        code && CLAIM_ERROR_MESSAGES[code]
          ? CLAIM_ERROR_MESSAGES[code]
          : 'Не удалось связать пробник с аккаунтом. Попробуйте ещё раз.',
    };
  }
  if (typeof body?.assignment_id !== 'string') {
    return { status: 'error', message: 'Неполный ответ сервера' };
  }
  const status = body.status;
  return {
    status:
      status === 'already_claimed' || status === 'already_has_attempt'
        ? status
        : 'claimed',
    assignment_id: body.assignment_id,
  };
}

/**
 * Self-heal привязки (зеркало `ensurePushSubscriptionSaved`, main.tsx).
 *
 * Экран `/p/mock-invite/:slug/start` — основной путь, но он не покрывает два
 * случая: регистрация с подтверждением email (возврат идёт через `email-verify`
 * мимо `?next=`) и OAuth-провайдеры, которые не несут наш `next`. Без этой
 * сети попытка навсегда осталась бы анонимной и не появилась бы в «Моих
 * пробниках», хотя аккаунт уже создан.
 *
 * Идемпотентно (сервер отвечает `already_claimed`), тихо, без навигации.
 * `supabase` импортируется динамически: публичная страница приглашения не
 * должна тянуть auth-клиент в свой чанк.
 *
 * ⚠️ НЕ запускается на самом экране привязки (P0 внешнего ревью): там тот же
 * `INITIAL_SESSION` получал бы и экран, и фон, оба читали бы ещё анонимную
 * попытку и оба слали бы CAS-UPDATE. Проигравший получал бы отказ, хотя
 * попытка уже принадлежит тому же пользователю, и экран отправлял бы ученика
 * заполнять форму заново. Фон здесь не нужен: экран сам всё сделает и покажет.
 */
export function ensurePendingMockInviteClaimed(): void {
  if (!readPendingMockInviteClaim()) return;
  if (
    typeof window !== 'undefined' &&
    /^\/p\/mock-invite\/[^/]+\/start\/?$/.test(window.location.pathname)
  ) {
    return;
  }

  void (async () => {
    try {
      const { supabase } = await import('@/lib/supabaseClient');
      let done = false;
      // rule 96 §1: ждём INITIAL_SESSION — синхронный getSession() на старте
      // приложения вернёт null до разбора `#access_token=…` из редиректа.
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (done) return;
        if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN') return;
        const token = session?.access_token;
        if (!token) return;
        const claim = readPendingMockInviteClaim();
        if (!claim) {
          done = true;
          data.subscription.unsubscribe();
          return;
        }
        done = true;
        void claimMockInviteAttempt(claim, token)
          .then((result) => {
            // Чистим ТОЛЬКО на реальном успехе. Раньше сюда попадал и
            // `not_found` — фон стирал bearer-секрет, и открытый в соседней
            // вкладке экран привязки терял единственный шанс (P0 ревью).
            if (
              result.status === 'claimed' ||
              result.status === 'already_claimed' ||
              result.status === 'already_has_attempt'
            ) {
              clearPendingMockInviteClaim();
            }
          })
          .catch(() => {
            // фон — молча, повторим на следующем старте
          })
          .finally(() => data.subscription.unsubscribe());
      });
    } catch {
      // фон — молча
    }
  })();
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
