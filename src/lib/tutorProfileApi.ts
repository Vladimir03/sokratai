import { supabase } from '@/lib/supabaseClient';
import { normalizeExamFocusMap, type ExamFocusValue } from '@/lib/tutorSubjects';

/**
 * API client for the tutor's own profile (`tutors` row keyed by user_id).
 *
 * Spec:    docs/delivery/features/tutor-profile/spec.md (v0.2)
 * Tasks:   docs/delivery/features/tutor-profile/tasks.md TASK-2
 * RLS:     migration 20260506150000_tutor_profile_infrastructure.sql
 *          (own row INSERT/UPDATE; broad SELECT for authenticated)
 *
 * Single source of truth for the `['tutor','profile','card']` query — see
 * useTutorProfile.ts (этот ключ отдельно от `['tutor','profile']`, который
 * принадлежит useTutor()/getCurrentTutor(), полная строка tutors). All callers
 * go through the hook, never call these functions directly from a component.
 */

export class TutorProfileApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TutorProfileApiError';
  }
}

export type TutorGender = 'male' | 'female' | null;

export interface TutorProfile {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  subjects: string[];
  gender: TutorGender;
  /**
   * Экзамен-фокус ПО ПРЕДМЕТАМ (Ф3, миграция 20260723140000):
   * {"physics":["ege","oge"]}. Нормализуется на чтении (normalizeExamFocusMap).
   */
  exam_focus_by_subject: Record<string, ExamFocusValue[]>;
  /** Формат занятий: true = индивидуальные + мини-группы, false = только индивидуальные. */
  mini_groups_enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface UpsertTutorProfileInput {
  name: string;
  subjects: string[];
  gender: TutorGender;
  /** Опционально (Ф3): не передан → колонка не трогается (старые callsites целы). */
  exam_focus_by_subject?: Record<string, ExamFocusValue[]>;
}

const AVATARS_BUCKET = 'avatars';
const TUTOR_PROFILE_FIELDS =
  'id, user_id, name, avatar_url, subjects, gender, exam_focus_by_subject, mini_groups_enabled, created_at, updated_at';
// Ревью P1-1 (Фаза 3): fallback-набор БЕЗ exam_focus_by_subject — на 42703
// (миграция 20260723140000 не применена: Lovable-лаг / preview-фронт) профиль
// обязан читаться/сохраняться, иначе ломается весь кабинет (SideNav, дефолты).
const LEGACY_TUTOR_PROFILE_FIELDS =
  'id, user_id, name, avatar_url, subjects, gender, mini_groups_enabled, created_at, updated_at';

function isMissingFocusColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42703' || (error.message ?? '').includes('exam_focus_by_subject');
}

// Matches the public URL Supabase generates for objects in our 'avatars' bucket.
// Used to recover the storage object path from a stored avatar_url so we can
// delete the previous file when the tutor uploads a new one.
const AVATARS_PUBLIC_URL_RE = /\/storage\/v1\/object\/public\/avatars\/(.+)$/;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function getCurrentUserId(): Promise<string> {
  // getSession() reads the in-memory cache (instant, no network round-trip).
  // performance.md §2a forbids getUser() in hot-path code.
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) {
    throw new TutorProfileApiError(error.message);
  }
  if (!session?.user?.id) {
    throw new TutorProfileApiError('Пользователь не авторизован');
  }
  return session.user.id;
}

function generateAvatarObjectId(): string {
  // Prefer crypto.randomUUID() when available (≥ 122 bits of entropy).
  // Falls back to the repo's canonical Safari-safe ID for non-HTTPS dev hosts
  // and Safari < 15.4 — see studentHomeworkApi.ts::generateStorageObjectId.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to legacy generator on environments where the call throws
      // (very old Safari, locked-down WebViews).
    }
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pickExtension(file: Blob): string {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

function extractAvatarObjectPath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  const match = publicUrl.match(AVATARS_PUBLIC_URL_RE);
  return match ? match[1] : null;
}

function normalizeGender(value: unknown): TutorGender {
  return value === 'male' || value === 'female' ? value : null;
}

function normalizeProfile(raw: Record<string, unknown>): TutorProfile {
  const subjects = Array.isArray(raw.subjects) ? (raw.subjects as unknown[]).filter(
    (item): item is string => typeof item === 'string',
  ) : [];

  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    name: typeof raw.name === 'string' ? raw.name : '',
    avatar_url:
      typeof raw.avatar_url === 'string' && raw.avatar_url.length > 0 ? raw.avatar_url : null,
    subjects,
    gender: normalizeGender(raw.gender),
    // Ф3: deploy-skew-safe (колонки нет в SELECT-ответе старого бэка → {}).
    exam_focus_by_subject: normalizeExamFocusMap(raw.exam_focus_by_subject),
    // По умолчанию ВКЛ (миграция 20260607120100) — defensive default true.
    mini_groups_enabled: raw.mini_groups_enabled !== false,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : null,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : null,
  };
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Returns the current user's tutor profile, or `null` if the row does not
 * exist yet (first visit, before {@link upsertTutorProfile} has run).
 */
export async function getTutorProfile(): Promise<TutorProfile | null> {
  const userId = await getCurrentUserId();

  let { data, error } = await supabase
    .from('tutors')
    .select(TUTOR_PROFILE_FIELDS)
    .eq('user_id', userId)
    .maybeSingle();

  // Ревью P1-1: колонки exam_focus_by_subject ещё нет в БД → одноразовый
  // retry legacy-набором (профиль обязан жить, focus = {} из normalizeProfile).
  if (error && isMissingFocusColumnError(error)) {
    ({ data, error } = await supabase
      .from('tutors')
      .select(LEGACY_TUTOR_PROFILE_FIELDS)
      .eq('user_id', userId)
      .maybeSingle());
  }

  if (error) {
    throw new TutorProfileApiError(error.message);
  }
  if (!data) {
    return null;
  }

  // through-unknown: generated types ещё не знают exam_focus_by_subject
  // (регенерация Lovable после миграции 20260723140000).
  return normalizeProfile(data as unknown as Record<string, unknown>);
}

/**
 * Creates or updates the tutor profile for the current user.
 * Avatar is managed by {@link uploadAvatar} / {@link removeAvatar} — this
 * call does NOT touch `avatar_url`.
 */
export async function upsertTutorProfile(input: UpsertTutorProfileInput): Promise<TutorProfile> {
  const userId = await getCurrentUserId();

  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new TutorProfileApiError('Имя обязательно');
  }
  if (input.gender !== null && input.gender !== 'male' && input.gender !== 'female') {
    throw new TutorProfileApiError('Некорректное значение пола');
  }

  // Cast to `never`: the `gender` column was added in migration
  // 20260506150000 but `src/integrations/supabase/types.ts` is regenerated by
  // Lovable Cloud after the migration applies. Until then the auto-generated
  // Insert type does not include `gender`. Single, well-scoped escape hatch.
  const basePayload = {
    user_id: userId,
    name: trimmedName,
    subjects: input.subjects,
    gender: input.gender,
  };
  const payload = {
    ...basePayload,
    // Ф3: ключ шлётся ТОЛЬКО когда передан; значения нормализуются.
    ...(input.exam_focus_by_subject !== undefined
      ? { exam_focus_by_subject: normalizeExamFocusMap(input.exam_focus_by_subject) }
      : {}),
  } as never;

  let { data, error } = await supabase
    .from('tutors')
    .upsert(payload, { onConflict: 'user_id' })
    .select(TUTOR_PROFILE_FIELDS)
    .single();

  // Ревью P1-1: до применения миграции 20260723140000 неизвестная колонка в
  // payload ИЛИ в RETURNING-списке роняет ВЕСЬ upsert (включая сохранения без
  // фокуса — .select() часть statement'а). Одноразовый retry без фокуса:
  // имя/пол/предметы обязаны сохраняться при любом skew.
  if (error && isMissingFocusColumnError(error)) {
    ({ data, error } = await supabase
      .from('tutors')
      .upsert(basePayload as never, { onConflict: 'user_id' })
      .select(LEGACY_TUTOR_PROFILE_FIELDS)
      .single());
  }

  if (error) {
    throw new TutorProfileApiError(error.message);
  }
  // through-unknown: generated types ещё не знают exam_focus_by_subject
  // (регенерация Lovable после миграции 20260723140000).
  return normalizeProfile(data as unknown as Record<string, unknown>);
}

/**
 * Uploads a (canvas-compressed, ≤ 2 MB, 512×512 JPEG) avatar Blob, writes its
 * public URL into `tutors.avatar_url`, and best-effort deletes the previous
 * file if it lived in our bucket. Returns the new public URL.
 *
 * Order: upload → write previous-URL lookup → UPDATE tutors → cleanup old file.
 * Failure of UPDATE rolls back the storage upload to avoid orphan blobs.
 * Failure of cleanup is swallowed (orphan in storage is acceptable, broken
 * profile UX is not).
 */
export async function uploadAvatar(file: Blob): Promise<string> {
  const userId = await getCurrentUserId();

  const ext = pickExtension(file);
  const objectId = generateAvatarObjectId();
  // Path convention from spec: avatars/<user_id>/<uuid>.<ext>
  // The first folder of `name` must equal auth.uid() for our storage RLS
  // policy ("Avatars insert by owner folder") to permit the write.
  const objectPath = `${userId}/${objectId}.${ext}`;
  const contentType = file.type || 'image/jpeg';

  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(objectPath, file, {
      upsert: false,
      contentType,
      cacheControl: '3600',
    });
  if (uploadError) {
    throw new TutorProfileApiError(uploadError.message);
  }

  const { data: publicUrlData } = supabase.storage
    .from(AVATARS_BUCKET)
    .getPublicUrl(objectPath);
  const newPublicUrl = publicUrlData.publicUrl;

  // Read previous avatar URL BEFORE we overwrite it, so we can delete the old
  // blob after a successful UPDATE. Also serves as a guard: if the tutor row
  // doesn't exist yet, we cannot UPSERT just `avatar_url` (NOT NULL constraint
  // on `name`), so we surface a friendly error and roll back the upload.
  const { data: existing, error: existingError } = await supabase
    .from('tutors')
    .select('avatar_url')
    .eq('user_id', userId)
    .maybeSingle();
  if (existingError) {
    await rollbackUpload(objectPath);
    throw new TutorProfileApiError(existingError.message);
  }
  if (!existing) {
    await rollbackUpload(objectPath);
    throw new TutorProfileApiError('Сначала заполните имя и сохраните профиль');
  }
  const previousObjectPath = extractAvatarObjectPath(
    typeof existing.avatar_url === 'string' ? existing.avatar_url : null,
  );

  const updatePayload = { avatar_url: newPublicUrl } as never;
  const { error: updateError } = await supabase
    .from('tutors')
    .update(updatePayload)
    .eq('user_id', userId);
  if (updateError) {
    await rollbackUpload(objectPath);
    throw new TutorProfileApiError(updateError.message);
  }

  // Best-effort cleanup of the previous file. Don't fail the call if the
  // delete errors out — the new avatar is already pointed at by the row.
  if (previousObjectPath && previousObjectPath !== objectPath) {
    await supabase.storage
      .from(AVATARS_BUCKET)
      .remove([previousObjectPath])
      .catch(() => {
        /* swallowed — orphan blob will be cleaned up later or remain harmless */
      });
  }

  return newPublicUrl;
}

/**
 * Clears `tutors.avatar_url` and best-effort deletes the previous file from
 * storage. Safe to call when no avatar is set (no-op for the storage call).
 */
export async function removeAvatar(): Promise<void> {
  const userId = await getCurrentUserId();

  const { data: existing, error: selectError } = await supabase
    .from('tutors')
    .select('avatar_url')
    .eq('user_id', userId)
    .maybeSingle();
  if (selectError) {
    throw new TutorProfileApiError(selectError.message);
  }
  if (!existing) {
    // No row, nothing to remove. Silent no-op so first-visit UX never trips.
    return;
  }
  const previousObjectPath = extractAvatarObjectPath(
    typeof existing.avatar_url === 'string' ? existing.avatar_url : null,
  );

  const updatePayload = { avatar_url: null } as never;
  const { error: updateError } = await supabase
    .from('tutors')
    .update(updatePayload)
    .eq('user_id', userId);
  if (updateError) {
    throw new TutorProfileApiError(updateError.message);
  }

  if (previousObjectPath) {
    await supabase.storage
      .from(AVATARS_BUCKET)
      .remove([previousObjectPath])
      .catch(() => {
        /* swallowed — see uploadAvatar comment */
      });
  }
}

async function rollbackUpload(objectPath: string): Promise<void> {
  await supabase.storage
    .from(AVATARS_BUCKET)
    .remove([objectPath])
    .catch(() => {
      /* swallowed — leaving orphan is preferable to masking the original error */
    });
}
