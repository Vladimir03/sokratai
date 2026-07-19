// Аватар и пол УЧЕНИКА — profiles.avatar_url / profiles.gender.
//
// Зеркало tutorProfileApi.uploadAvatar/removeAvatar (см. кросс-линк там):
// та же механика (bucket 'avatars', путь {userId}/{objectId}.{ext}, getPublicUrl,
// rollback при сбое DB-update, best-effort удаление старого блоба), отличие
// одно — пишем profiles (не tutors). Отдельный файл, а не параметризация
// tutorProfileApi (rule 10: tutor-профиль не рефакторим ради студенческой фичи;
// изоляция модулей — студенческие страницы не тянут tutor-домен).
//
// RLS уже позволяет всё (миграций НЕТ): profiles UPDATE owner
// (20251004081630) + bucket 'avatars' insert/delete по owner-folder
// (20260506150000; колонки avatar_url/gender закладывались под эту фичу).
// URL публичный и RU-safe: SDK хардкодит https://api.sokratai.ru.

import { supabase } from '@/lib/supabaseClient';

const AVATARS_BUCKET = 'avatars';
const AVATARS_PUBLIC_URL_RE = /\/storage\/v1\/object\/public\/avatars\/(.+)$/;

export type StudentGender = 'male' | 'female';

export class StudentAvatarApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudentAvatarApiError';
  }
}

async function getCurrentUserId(): Promise<string> {
  // getSession() — локальный кэш, без сетевого запроса (performance.md §2a).
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) throw new StudentAvatarApiError(error.message);
  if (!session?.user?.id) throw new StudentAvatarApiError('Пользователь не авторизован');
  return session.user.id;
}

function generateAvatarObjectId(): string {
  // crypto.randomUUID — только HTTPS + Safari 15.4+ (rule 80) → fallback.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // старый Safari / не-HTTPS dev — падаем в legacy-генератор
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

async function rollbackUpload(objectPath: string): Promise<void> {
  await supabase.storage
    .from(AVATARS_BUCKET)
    .remove([objectPath])
    .catch(() => {
      /* best-effort — осиротевший блоб безвреден */
    });
}

/** Загружает аватар ученика (blob уже сжат AvatarUpload до 512×512 ≤2МБ). */
export async function uploadStudentAvatar(file: Blob): Promise<string> {
  const userId = await getCurrentUserId();

  const objectPath = `${userId}/${generateAvatarObjectId()}.${pickExtension(file)}`;
  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(objectPath, file, {
      upsert: false,
      contentType: file.type || 'image/jpeg',
      cacheControl: '3600',
    });
  if (uploadError) throw new StudentAvatarApiError(uploadError.message);

  const { data: publicUrlData } = supabase.storage
    .from(AVATARS_BUCKET)
    .getPublicUrl(objectPath);
  const newPublicUrl = publicUrlData.publicUrl;

  // Старый URL читаем ДО перезаписи — чтобы убрать прежний блоб после успеха.
  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (existingError) {
    await rollbackUpload(objectPath);
    throw new StudentAvatarApiError(existingError.message);
  }
  if (!existing) {
    // Zero-row UPDATE прошёл бы «успешно», оставив сироту (ревью 5.6 р.3 #5).
    await rollbackUpload(objectPath);
    throw new StudentAvatarApiError('Профиль не найден. Перезайдите в аккаунт.');
  }
  const previousObjectPath = extractAvatarObjectPath(
    typeof existing.avatar_url === 'string' ? existing.avatar_url : null,
  );

  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_url: newPublicUrl })
    .eq('id', userId)
    .select('avatar_url')
    .maybeSingle();
  if (updateError || !updated) {
    // RU-DPI может потерять ОТВЕТ уже закоммиченного UPDATE (ревью 5.6 р.3 #4):
    // прежде чем удалять блоб, перечитываем — если строка уже указывает на новый
    // URL, операция удалась. Не удалось подтвердить — блоб НЕ трогаем (сирота
    // безвредна, битый avatar_url в профиле — нет).
    const { data: recheck, error: recheckError } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .maybeSingle();
    if (!recheckError && recheck?.avatar_url === newPublicUrl) {
      // UPDATE закоммитился — продолжаем как успех.
    } else {
      if (!recheckError && recheck && recheck.avatar_url !== newPublicUrl) {
        await rollbackUpload(objectPath);
      }
      throw new StudentAvatarApiError(
        updateError?.message ?? 'Не удалось сохранить аватар. Попробуйте ещё раз.',
      );
    }
  }

  if (previousObjectPath && previousObjectPath !== objectPath) {
    await supabase.storage
      .from(AVATARS_BUCKET)
      .remove([previousObjectPath])
      .catch(() => {
        /* best-effort */
      });
  }

  return newPublicUrl;
}

/** Очищает profiles.avatar_url + best-effort удаляет блоб. */
export async function removeStudentAvatar(): Promise<void> {
  const userId = await getCurrentUserId();

  const { data: existing, error: selectError } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (selectError) throw new StudentAvatarApiError(selectError.message);
  const previousObjectPath = extractAvatarObjectPath(
    typeof existing?.avatar_url === 'string' ? existing.avatar_url : null,
  );

  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', userId)
    .select('id')
    .maybeSingle();
  if (updateError) throw new StudentAvatarApiError(updateError.message);
  if (!updated) throw new StudentAvatarApiError('Профиль не найден. Перезайдите в аккаунт.');

  if (previousObjectPath) {
    await supabase.storage
      .from(AVATARS_BUCKET)
      .remove([previousObjectPath])
      .catch(() => {
        /* best-effort */
      });
  }
}

/** Пол ученика — плейсхолдер-аватар мальчик/девочка, когда фото не загружено. */
export async function setStudentGender(gender: StudentGender | null): Promise<void> {
  const userId = await getCurrentUserId();
  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ gender })
    .eq('id', userId)
    .select('id')
    .maybeSingle();
  if (error) throw new StudentAvatarApiError(error.message);
  if (!updated) throw new StudentAvatarApiError('Профиль не найден. Перезайдите в аккаунт.');
}
