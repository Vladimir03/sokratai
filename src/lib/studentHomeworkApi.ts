import { parseISO } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import type {
  StudentHomeworkAssignment,
  StudentHomeworkAssignmentDetails,
  HomeworkThread,
  GuidedMessageKind,
  CheckAnswerResponse,
  RequestHintResponse,
} from '@/types/homework';
import {
  MAX_GUIDED_CHAT_ATTACHMENT_FILE_BYTES,
  serializeThreadAttachmentRefs,
} from '@/lib/homeworkThreadAttachments';
import { extractApiErrorMessage } from '@/lib/apiErrorMessage';
import { HeicDecodeError, compressForUpload } from '@/lib/imageCompression';

const HOMEWORK_IMAGES_BUCKET = 'homework-images';
const HOMEWORK_SUBMISSIONS_BUCKET = 'homework-submissions';
const HOMEWORK_TASK_IMAGES_BUCKET = 'homework-task-images';
const STORAGE_REF_PREFIX = 'storage://';
// HARDCODED — see src/lib/supabaseClient.ts for rationale (RU bypass, ignore Lovable auto-env).
const SUPABASE_URL = 'https://api.sokratai.ru';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

export class StudentHomeworkApiError extends Error {
  /**
   * Stable error code for branch-able callers. Currently used for
   * `SESSION_EXPIRED` (set by `requestStudentHomeworkApi` when a 401 cannot
   * be recovered via session refresh — caller should show a session-expired
   * message and rely on `AuthGuard.onAuthStateChange` to redirect to /login).
   * Free-form for future codes; backward-compat: undefined when not set.
   */
  code?: string;
  constructor(message: string, opts?: { code?: string }) {
    super(message);
    this.code = opts?.code;
    this.name = 'StudentHomeworkApiError';
  }
}

function ensureUserId(userId: string | undefined): string {
  if (!userId) {
    throw new StudentHomeworkApiError('Пользователь не авторизован');
  }
  return userId;
}

async function getCurrentUserId(): Promise<string> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) {
    throw new StudentHomeworkApiError(sessionError.message);
  }
  if (session?.user?.id) {
    return session.user.id;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }
  return ensureUserId(data.user?.id);
}

function translateSupabaseError(message: string): string {
  const lower = message.toLowerCase();
  if (message.includes('DEADLINE_PASSED')) return 'Дедлайн уже прошёл. Сдача недоступна.';
  if (lower.includes('row-level security')) {
    return 'Недостаточно прав для выполнения операции.';
  }
  if (lower.includes('permission denied')) {
    return 'Доступ запрещён для этой операции.';
  }
  return message;
}

export async function requestStudentHomeworkApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // Helper: build + fire the actual fetch using the current cached session
  // token. Used twice — first attempt, then retry after a refresh.
  const doFetch = async (): Promise<Response> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      throw new StudentHomeworkApiError('Нет активной сессии', {
        code: 'NO_SESSION',
      });
    }
    return fetch(`${SUPABASE_URL}/functions/v1/homework-api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_KEY,
        ...(options.headers ?? {}),
      },
    });
  };

  let response = await doFetch();

  // 401 → cached access_token expired between the local getSession() read
  // and the server-side GoTrue validation (autoRefreshToken can fall behind
  // after device sleep, network blips during background refresh, etc.).
  // Try a one-shot refreshSession() + retry before surfacing the error.
  // Bug 2026-05-12: previously this case bubbled up as "Invalid or expired
  // token" and the user was stuck on the error screen until manual reload.
  if (response.status === 401) {
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError || !refreshData?.session) {
      // Persistent 401 — refresh_token also dead or revoked. Sign out so
      // AuthGuard's `onAuthStateChange` listener redirects to /login. Throw
      // with stable code so the UI can show a session-expired hint instead
      // of the cryptic upstream message.
      await supabase.auth.signOut().catch(() => undefined);
      throw new StudentHomeworkApiError(
        'Сессия истекла. Перенаправляем на вход…',
        { code: 'SESSION_EXPIRED' },
      );
    }
    response = await doFetch();
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // ignore parse errors
    }
    // Status-based stable code so callers can branch without depending on the
    // (inconsistent across endpoints) body shape. 404 from edge endpoints like
    // GET /assignments/:id/student means "not assigned to you OR assignment
    // missing" — StudentHomeworkDetail uses NOT_FOUND to show an account-mismatch
    // hint instead of the generic "Не удалось загрузить задание" (2026-05-28).
    const code = response.status === 404
      ? 'NOT_FOUND'
      : response.status === 403
        ? 'FORBIDDEN'
        : undefined;
    throw new StudentHomeworkApiError(
      extractApiErrorMessage(body, `HTTP ${response.status}`),
      code ? { code } : undefined,
    );
  }

  return response.json() as Promise<T>;
}

export interface TranscribeThreadVoiceResult {
  text: string;
}

export async function transcribeThreadVoice(
  threadId: string,
  audioBlob: Blob,
  fileName = 'voice.webm',
  timeoutMs = 45_000,
): Promise<TranscribeThreadVoiceResult> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new StudentHomeworkApiError(sessionError.message);
  }

  const token = session?.access_token;
  if (!token) {
    throw new StudentHomeworkApiError('Нет активной сессии');
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const formData = new FormData();
    formData.append('file', audioBlob, fileName);

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/homework-api/threads/${encodeURIComponent(threadId)}/transcribe-voice`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_KEY,
        },
        body: formData,
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // ignore malformed error body
      }
      throw new StudentHomeworkApiError(
        extractApiErrorMessage(body, `HTTP ${response.status}`),
      );
    }

    const data = await response.json();
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) {
      throw new StudentHomeworkApiError('Не удалось распознать речь');
    }

    return { text };
  } catch (error) {
    if (error instanceof StudentHomeworkApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new StudentHomeworkApiError('Расшифровка заняла слишком много времени. Попробуй ещё раз.');
    }

    throw new StudentHomeworkApiError('Не удалось отправить голосовое сообщение на расшифровку.');
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function toStorageRef(bucket: string, objectPath: string): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${objectPath}`;
}

function generateStorageObjectId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sanitizeObjectPath(path: string): string {
  return path.replace(/^\/+/, '').trim();
}

function parseStorageRef(
  value: string | null | undefined,
  defaultBucket = HOMEWORK_TASK_IMAGES_BUCKET,
): { bucket: string; objectPath: string } | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(STORAGE_REF_PREFIX)) {
    const raw = trimmed.slice(STORAGE_REF_PREFIX.length);
    const slashIdx = raw.indexOf('/');
    if (slashIdx <= 0 || slashIdx === raw.length - 1) {
      return null;
    }
    const bucket = raw.slice(0, slashIdx);
    const objectPath = sanitizeObjectPath(raw.slice(slashIdx + 1));
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  const objectPath = sanitizeObjectPath(trimmed);
  if (!objectPath) return null;
  return { bucket: defaultBucket, objectPath };
}

export async function listStudentAssignments(): Promise<StudentHomeworkAssignment[]> {
  const studentId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('homework_tutor_student_assignments')
    .select(`
      id,
      assignment_id,
      tutor_overall_comment,
      homework_tutor_assignments!inner(
        id,
        title,
        subject,
        topic,
        description,
        deadline,
        status,
        created_at,
        work_mode
      )
    `)
    .eq('student_id', studentId);

  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }

  type AssignmentJoinRow = {
    id: string;
    assignment_id: string;
    // Phase 12: общий комментарий репетитора к ДЗ (per-student). Только для бейджа.
    tutor_overall_comment: string | null;
    homework_tutor_assignments: {
      id: string;
      title: string;
      subject: string;
      topic: string | null;
      description: string | null;
      deadline: string | null;
      status: string;
      created_at: string;
      // homework-work-modes (2026-07-25): вид работы для чипа «Самостоятельная».
      // Может отсутствовать при deploy-skew (старый бандл ← новая колонка).
      work_mode?: string | null;
    };
  };
  // `as unknown as` (не прямой каст): сгенерированный `integrations/supabase/
  // types.ts` ещё не знает колонку `work_mode` (Lovable регенерит типы после
  // применения миграции `20260724150000`), поэтому PostgREST-типизация отдаёт
  // на этот select `SelectQueryError`. Колонка в БД есть — рантайм корректен.
  // Убрать escape-hatch, когда types.ts будет перегенерирован.
  const assignmentRows = ((data ?? []) as unknown as AssignmentJoinRow[]).filter((row) => {
    const status = row?.homework_tutor_assignments?.status;
    return status === 'active' || status === 'closed';
  });

  const studentAssignmentIds = assignmentRows.map((row) => row.id);

  const threadMap = new Map<string, { status: string }>();
  if (studentAssignmentIds.length > 0) {
    const { data: threadRows } = await supabase
      .from('homework_tutor_threads')
      .select('student_assignment_id, status')
      .in('student_assignment_id', studentAssignmentIds);

    for (const t of threadRows ?? []) {
      threadMap.set(t.student_assignment_id as string, { status: t.status as string });
    }
  }

  return assignmentRows
    .map((row) => {
      const assignment = row.homework_tutor_assignments;
      const thread = threadMap.get(row.id);
      const latest_submission_status = thread
        ? (thread.status === 'completed' ? 'ai_checked' : 'in_progress')
        : null;

      return {
        id: assignment.id,
        title: assignment.title,
        subject: assignment.subject,
        topic: assignment.topic,
        description: assignment.description,
        deadline: assignment.deadline,
        status: assignment.status as StudentHomeworkAssignment['status'],
        latest_submission_status,
        created_at: assignment.created_at,
        // Phase 12: бейдж «есть комментарий репетитора» на карточке списка.
        has_tutor_comment: Boolean(row.tutor_overall_comment),
        work_mode: assignment.work_mode === 'independent' ? 'independent' : 'homework',
      } satisfies StudentHomeworkAssignment;
    })
    .sort((a, b) => {
      // Newest assignments first (by creation date descending)
      return parseISO(b.created_at).getTime() - parseISO(a.created_at).getTime();
    });
}

export async function getStudentAssignment(assignmentId: string): Promise<StudentHomeworkAssignmentDetails> {
  // ROOT FIX (2026-05-28) — Telegram «Открыть ДЗ» → «Не удалось загрузить задание».
  //
  //   Раньше тут был DIRECT PostgREST на `homework_tutor_assignments`, который
  //   упирался в RLS policy «HW students select assigned assignments»
  //   (`status IN ('active','closed')`, миграция 20260215100000). Для ДЗ в
  //   `status='draft'` (или любого RLS edge) `.single()` возвращал 0 строк →
  //   throw → ученик на `/homework/:id` (StudentHomeworkDetail) видел «Не удалось
  //   загрузить задание» ДО редиректа на рабочий problem-screen.
  //
  //   Архитектурная нестыковка: новый problem-screen (`handleGetStudentProblem`)
  //   грузит ВСЁ через service_role edge function (ownership по
  //   homework_tutor_student_assignments link, БЕЗ status-фильтра) → работал и
  //   для draft. А этот legacy redirect-entry ходил через RLS-bound клиент →
  //   падал на draft. Симптом видела Эмилия (DELF A2 PO) при тесте «как ученик».
  //
  //   Fix: ходим в существующий service_role endpoint
  //   `GET /assignments/:id/student` (handleGetStudentAssignment) — ownership по
  //   link, draft-tolerant, тот же anti-leak whitelist что и новый screen. 404
  //   только когда ученик реально не привязан (genuine «не найдено»).
  //   См. .claude/rules/40-homework-system.md «Student assignment load».
  //
  //   identity (name/gender) — отдельный service_role endpoint `/identity`
  //   (Phase 8.1, .claude/rules/40-homework-system.md), параллельно. Silent fail → neutral fallback.
  const [assignment, identityResult] = await Promise.all([
    requestStudentHomeworkApi<
      Omit<StudentHomeworkAssignmentDetails, 'studentDisplayName' | 'studentGender'>
    >(`/assignments/${encodeURIComponent(assignmentId)}/student`, { method: 'GET' }),
    requestStudentHomeworkApi<{
      name: string | null;
      gender: 'male' | 'female' | null;
    }>(`/assignments/${encodeURIComponent(assignmentId)}/identity`, { method: 'GET' }).catch(
      (err) => {
        console.warn('student_identity_fetch_failed', err);
        return { name: null, gender: null };
      },
    ),
  ]);

  return {
    ...assignment,
    studentDisplayName: identityResult.name,
    studentGender: identityResult.gender,
  };
}

export async function getStudentTaskImageSignedUrl(taskImageRef: string): Promise<string | null> {
  const parsed = parseStorageRef(taskImageRef, HOMEWORK_TASK_IMAGES_BUCKET);
  if (!parsed) return null;

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.objectPath, 3600);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export async function getStudentTaskImageSignedUrlViaBackend(
  assignmentId: string,
  taskId: string,
): Promise<string | null> {
  try {
    const result = await requestStudentHomeworkApi<{ url: string }>(
      `/assignments/${encodeURIComponent(assignmentId)}/tasks/${encodeURIComponent(taskId)}/image-url`,
    );
    return result.url ?? null;
  } catch {
    return null;
  }
}

export async function getStudentTaskImagesSignedUrlsViaBackend(
  assignmentId: string,
  taskId: string,
): Promise<string[]> {
  // Mirror refresh+retry pattern из `requestStudentHomeworkApi` (Phase 3.1
  // Bug #3 fix). Раньше эта функция имела свой inline fetch без refresh —
  // при истечении токена в фоне (изображения load'ятся через signed URL
  // эндпоинт после auth fix endpoint'а), картинки не загружались до тех
  // пор пока юзер не сделает hard refresh. Phase 3.1 Bug #3 image-tail
  // hotfix 2026-05-13.
  const doFetch = async (): Promise<Response> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      throw new StudentHomeworkApiError('Нет активной сессии', {
        code: 'NO_SESSION',
      });
    }
    return fetch(
      `${SUPABASE_URL}/functions/v1/homework-api/assignments/${encodeURIComponent(assignmentId)}/tasks/${encodeURIComponent(taskId)}/images`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_KEY,
        },
      },
    );
  };

  let response = await doFetch();

  if (response.status === 401) {
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError || !refreshData?.session) {
      await supabase.auth.signOut().catch(() => undefined);
      throw new StudentHomeworkApiError(
        'Сессия истекла. Перенаправляем на вход…',
        { code: 'SESSION_EXPIRED' },
      );
    }
    response = await doFetch();
  }

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // ignore parse errors
    }
    throw new StudentHomeworkApiError(
      extractApiErrorMessage(body, `HTTP ${response.status}`),
    );
  }

  const result = await response.json() as { signed_urls?: unknown };
  return Array.isArray(result?.signed_urls)
    ? result.signed_urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : [];
}

export async function getStudentHomeworkThread(
  threadId: string,
): Promise<HomeworkThread> {
  return requestStudentHomeworkApi<HomeworkThread>(
    `/threads/${encodeURIComponent(threadId)}`,
  );
}

/**
 * Find the thread for a given assignment by looking up the student_assignment
 * and querying homework_tutor_threads directly via RLS.
 */
export async function getStudentThreadByAssignment(
  assignmentId: string,
): Promise<HomeworkThread | null> {
  // Routes through the edge function so the response includes tutor_profile
  // (display_name + avatar_url + gender) computed server-side via JOIN on
  // assignment.tutor_id → tutors. Direct PostgREST SELECT cannot compute
  // this — see ChatGPT-5.5 review BLOCKER 1 and the rationale comment in
  // homework-api/index.ts::fetchStudentThread.
  //
  // Endpoint also lazy-provisions the thread if it doesn't exist yet
  // (matches handleCheckAnswer / handleRequestHint behavior).
  return await requestStudentHomeworkApi<HomeworkThread | null>(
    `/assignments/${encodeURIComponent(assignmentId)}/thread`,
    { method: 'GET' },
  );
}

// ─── homework-work-modes (Ф1): самостоятельная работа ────────────────────────

export interface FinishStudentWorkResponse {
  completed: boolean;
  zeroed_count: number;
}

/**
 * «Сдать работу» (только work_mode='independent'): несданные задачи получают 0,
 * тред завершается → полный reveal вердиктов. Идемпотентно.
 */
export async function finishStudentWork(
  assignmentId: string,
): Promise<FinishStudentWorkResponse> {
  return await requestStudentHomeworkApi<FinishStudentWorkResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/student/finish`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export interface StudentHomeworkResultTask {
  task_id: string;
  order_num: number;
  task_text: string;
  max_score: number;
  task_kind?: string | null;
  final_score: number;
  /** Есть ли сдача ученика по задаче (false = «Без ответа», занулено finish'ем). */
  answered: boolean;
  /**
   * «% самостоятельности» по задаче (2026-07-25). `null` = данных нет (работа
   * до релиза / задача закрыта массово) → в UI не показываем.
   */
  independence_pct?: number | null;
  /** true → «≈»: процент оценён по legacy-счётчикам (работа до 26.07). */
  independence_is_estimate?: boolean;
  /** Сырое число обращений к помощи AI по задаче. */
  ai_help_events?: number | null;
}

export type StudentHomeworkResult =
  | {
      completed: false;
      work_mode: 'homework' | 'independent';
      assignment: { id: string; title: string; subject: string };
    }
  | {
      completed: true;
      work_mode: 'homework' | 'independent';
      assignment: {
        id: string;
        title: string;
        subject: string;
        deadline: string | null;
        status: string;
        tutor_overall_comment: string | null;
        tutor_overall_comment_at: string | null;
      };
      tasks: StudentHomeworkResultTask[];
      total_score: number;
      total_max: number;
      /**
       * Агрегат «% самостоятельности» по работе — средневзвешенный по max_score
       * задач. `null` в самостоятельной работе (AI выключен → метрика
       * бессмысленна) и когда ни по одной задаче нет данных.
       */
      independence_pct?: number | null;
      /** true → показывать «≈»: часть задач оценена по legacy-счётчикам. */
      independence_is_estimate?: boolean;
      /** Σ обращений к помощи AI по работе. */
      ai_help_total?: number;
    };

/** Экран «Результат работы» (Т6) — один round-trip, state-aware reveal. */
export async function getStudentHomeworkResult(
  assignmentId: string,
): Promise<StudentHomeworkResult> {
  return await requestStudentHomeworkApi<StudentHomeworkResult>(
    `/assignments/${encodeURIComponent(assignmentId)}/student/result`,
    { method: 'GET' },
  );
}

/**
 * Итоги по каждой работе ученика для СПИСКА ДЗ (2026-07-27, решение владельца:
 * «показывать ученикам итоговый балл и самостоятельность, но не раздувать
 * карточки»). Отдельный запрос, а не часть `listStudentAssignments`: список
 * должен нарисоваться сразу, а числа догрузиться — на телефоне это важнее.
 *
 * Балл считает СЕРВЕР (`computeFinalScore`) — на клиенте формулу не дублируем.
 * Незавершённые работы приходят с `completed: false` и без баллов.
 */
export interface StudentAssignmentScore {
  assignment_id: string;
  completed: boolean;
  final_score: number | null;
  total_max: number;
  independence_pct: number | null;
  independence_is_estimate: boolean;
}

export async function getStudentAssignmentScores(): Promise<StudentAssignmentScore[]> {
  const res = await requestStudentHomeworkApi<{ items?: StudentAssignmentScore[] }>(
    '/student/assignments/scores',
    { method: 'GET' },
  );
  return res.items ?? [];
}

/**
 * Upload a file from guided chat to Supabase Storage.
 * Returns a storage:// ref suitable for persisting in thread messages.
 */
export async function uploadStudentThreadImage(
  file: File,
  assignmentId: string,
  _threadId: string,
  taskOrder: number,
): Promise<string> {
  if (file.size > MAX_GUIDED_CHAT_ATTACHMENT_FILE_BYTES) {
    throw new StudentHomeworkApiError('Файл слишком большой. Максимум 5 МБ');
  }

  // Phase 7 (2026-05-16) — client-side compress перед upload (mirror
  // mock-exams pattern). HEIC конвертируется в JPEG всегда: native decode
  // (Safari 17+) или wasm-фолбэк внутри compressForUpload (2026-07-30).
  // Битый HEIC → fail-closed: сырой .heic НЕ загружаем — репетитор его не
  // откроет, а AI проверил бы решение не видя фото (rule 40).
  // Прочие сбои компрессии (JPEG/PNG) — raw-fallback как раньше.
  // Не-image files (PDF) автоматически pass-through (см. compressForUpload).
  let uploadFile: File;
  try {
    uploadFile = await compressForUpload(file, {
      maxBytes: 4 * 1024 * 1024,
      maxLongSide: 2048,
    });
  } catch (compressErr) {
    if (compressErr instanceof HeicDecodeError) {
      throw new StudentHomeworkApiError(compressErr.message);
    }
    console.warn('[studentHomeworkApi] compression failed, uploading original', {
      fileName: file.name,
      fileSize: file.size,
      error: compressErr instanceof Error ? compressErr.message : String(compressErr),
    });
    uploadFile = file;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new StudentHomeworkApiError(sessionError.message);
  }

  const studentId = ensureUserId(sessionData.session?.user?.id);
  const ext = uploadFile.name.split('.').pop()?.toLowerCase() || 'jpg';
  const fileId = generateStorageObjectId();
  const objectPath = `${studentId}/${assignmentId}/threads/${taskOrder}/${fileId}.${ext}`;
  // Остаточный сырой HEIC (raw-fallback не-HEIC ветки сюда не приводит, но
  // страхуемся): корректный MIME вместо octet-stream, чтобы вьюер/AI могли
  // его детектировать.
  const contentType =
    uploadFile.type ||
    (/\.(heic|heif)$/i.test(uploadFile.name) ? 'image/heic' : 'application/octet-stream');

  const { error: primaryError } = await supabase.storage
    .from(HOMEWORK_SUBMISSIONS_BUCKET)
    .upload(objectPath, uploadFile, { upsert: false, contentType });

  if (!primaryError) {
    return toStorageRef(HOMEWORK_SUBMISSIONS_BUCKET, objectPath);
  }

  const isBucketMissing =
    primaryError.message?.toLowerCase().includes('bucket not found') ||
    (primaryError as unknown as { statusCode?: number }).statusCode === 404;

  if (!isBucketMissing) {
    throw new StudentHomeworkApiError(
      `Ошибка загрузки файла: ${translateSupabaseError(primaryError.message)}`,
    );
  }

  const fallbackPath = `${studentId}/${assignmentId}/threads/${taskOrder}/${fileId}.${ext}`;
  const { error: fallbackError } = await supabase.storage
    .from(HOMEWORK_IMAGES_BUCKET)
    .upload(fallbackPath, uploadFile, { upsert: false, contentType });

  if (fallbackError) {
    throw new StudentHomeworkApiError(
      `Ошибка загрузки файла: ${translateSupabaseError(fallbackError.message)}`,
    );
  }

  return toStorageRef(HOMEWORK_IMAGES_BUCKET, fallbackPath);
}

/**
 * Max audio upload size for voice-speaking submissions (voice-speaking-mvp).
 * Mirrors the server-side `MAX_VOICE_BYTES` in `_shared/voice-transcribe.ts`
 * (20 МБ) — covers a 7-min monologue worst-case (iOS AAC 256kbps ≈ 13 МБ) and
 * stays under Groq's 25 МБ hard limit.
 */
export const MAX_STUDENT_VOICE_BYTES = 20 * 1024 * 1024;

/**
 * Upload a recorded voice monologue (task_kind='speaking') to the SAME bucket +
 * namespace as photo attachments (`homework-submissions/{studentId}/{assignmentId}/threads/{taskOrder}/...`)
 * so the backend `extractStudentThreadAttachmentRefs` validator accepts it
 * without changes (voice-speaking-mvp TASK-6 bucket decision).
 *
 * Unlike `uploadStudentThreadImage`, NO compression — `compressForUpload` is
 * image-only and would corrupt audio. Returns a `storage://...` ref.
 */
export async function uploadStudentThreadVoice(
  blob: Blob,
  assignmentId: string,
  taskOrder: number,
  fileName = 'voice.webm',
): Promise<string> {
  if (blob.size === 0) {
    throw new StudentHomeworkApiError('Пустая запись. Запиши ответ ещё раз.');
  }
  if (blob.size > MAX_STUDENT_VOICE_BYTES) {
    throw new StudentHomeworkApiError('Запись слишком длинная. Сократи ответ и запиши ещё раз.');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new StudentHomeworkApiError(sessionError.message);
  }

  const studentId = ensureUserId(sessionData.session?.user?.id);
  const ext = fileName.split('.').pop()?.toLowerCase() || 'webm';
  const fileId = generateStorageObjectId();
  const objectPath = `${studentId}/${assignmentId}/threads/${taskOrder}/${fileId}.${ext}`;
  const contentType = blob.type || 'audio/webm';

  const { error: primaryError } = await supabase.storage
    .from(HOMEWORK_SUBMISSIONS_BUCKET)
    .upload(objectPath, blob, { upsert: false, contentType });

  if (!primaryError) {
    return toStorageRef(HOMEWORK_SUBMISSIONS_BUCKET, objectPath);
  }

  const isBucketMissing =
    primaryError.message?.toLowerCase().includes('bucket not found') ||
    (primaryError as unknown as { statusCode?: number }).statusCode === 404;

  if (!isBucketMissing) {
    throw new StudentHomeworkApiError(
      `Ошибка загрузки записи: ${translateSupabaseError(primaryError.message)}`,
    );
  }

  const fallbackPath = `${studentId}/${assignmentId}/threads/${taskOrder}/${fileId}.${ext}`;
  const { error: fallbackError } = await supabase.storage
    .from(HOMEWORK_IMAGES_BUCKET)
    .upload(fallbackPath, blob, { upsert: false, contentType });

  if (fallbackError) {
    throw new StudentHomeworkApiError(
      `Ошибка загрузки записи: ${translateSupabaseError(fallbackError.message)}`,
    );
  }

  return toStorageRef(HOMEWORK_IMAGES_BUCKET, fallbackPath);
}

/**
 * Save a message to a thread via the homework-api edge function.
 */
export async function saveThreadMessage(
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
  taskOrder?: number,
  messageKind?: GuidedMessageKind,
  taskId?: string,
  attachmentRefs?: string[],
): Promise<{ id: string }> {
  const normalizedAttachmentRefs = (attachmentRefs ?? []).map((ref) => ref.trim()).filter(Boolean);
  const serializedAttachments = serializeThreadAttachmentRefs(normalizedAttachmentRefs);
  return requestStudentHomeworkApi<{ id: string }>(
    `/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        content,
        role,
        task_order: taskOrder,
        task_id: taskId,
        message_kind: messageKind,
        image_url: serializedAttachments,
        image_urls: normalizedAttachmentRefs.length > 0 ? normalizedAttachmentRefs : undefined,
      }),
    },
  );
}

/**
 * @deprecated RETIRED 2026-07-24 (ревью-фикс P0 homework-work-modes).
 *
 * Сервер отвечает 410 `ADVANCE_RETIRED`. Client-controlled advance закрывал
 * задачу БЕЗ записи балла, а `computeFinalScore` трактует completed-без-баллов
 * как полный `max_score` → ученик мог выбить максимум за нерешённую задачу.
 * Продвижение выполняет сервер после реального грейдинга (`performTaskAdvance`).
 *
 * Не вызывать. Оставлено только чтобы старые импорты не падали на сборке.
 */
export async function advanceTask(
  threadId: string,
  score?: number,
): Promise<HomeworkThread> {
  return requestStudentHomeworkApi<HomeworkThread>(
    `/threads/${encodeURIComponent(threadId)}/advance`,
    {
      method: 'POST',
      body: JSON.stringify(score !== undefined ? { score } : {}),
    },
  );
}

/**
 * Phase 3: Submit answer for AI evaluation.
 * Server checks correctness, updates scores, auto-advances on correct.
 */
export async function checkAnswer(
  threadId: string,
  answer: string,
  taskOrder?: number,
  taskId?: string,
  attachmentRefs?: string[],
): Promise<CheckAnswerResponse> {
  const normalizedAttachmentRefs = (attachmentRefs ?? []).map((ref) => ref.trim()).filter(Boolean);
  const serializedAttachments = serializeThreadAttachmentRefs(normalizedAttachmentRefs);
  return requestStudentHomeworkApi<CheckAnswerResponse>(
    `/threads/${encodeURIComponent(threadId)}/check`,
    {
      method: 'POST',
      body: JSON.stringify({
        answer,
        ...(taskOrder != null && { task_order: taskOrder }),
        ...(taskId != null && { task_id: taskId }),
        ...(serializedAttachments && { image_url: serializedAttachments }),
        ...(normalizedAttachmentRefs.length > 0 && { image_urls: normalizedAttachmentRefs }),
      }),
    },
  );
}

/**
 * Phase 3: Request a hint for the current task.
 * Server generates hint, degrades available_score.
 */
export async function requestHint(
  threadId: string,
  taskOrder?: number,
  taskId?: string,
): Promise<RequestHintResponse> {
  return requestStudentHomeworkApi<RequestHintResponse>(
    `/threads/${encodeURIComponent(threadId)}/hint`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...(taskOrder != null ? { task_order: taskOrder } : {}),
        ...(taskId != null ? { task_id: taskId } : {}),
      }),
    },
  );
}
