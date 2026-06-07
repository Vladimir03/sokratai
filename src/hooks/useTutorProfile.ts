import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  getTutorProfile,
  removeAvatar,
  uploadAvatar,
  upsertTutorProfile,
  type TutorProfile,
  type UpsertTutorProfileInput,
} from '@/lib/tutorProfileApi';
import { setTutorMiniGroupsEnabled } from '@/lib/tutors';
import type { Tutor } from '@/types/tutor';

/**
 * React Query bindings for the tutor profile API (profile-card view).
 *
 * Spec:    docs/delivery/features/tutor-profile/spec.md (v0.2)
 *
 * Query keys (P1 fix, 2026-06-07): этот хук использует СВОЙ ключ
 * `['tutor','profile','card']`, отдельный от `['tutor','profile']`, который
 * принадлежит `useTutor()`/`getCurrentTutor()` (полная строка `tutors`). Раньше
 * оба делили `['tutor','profile']` с РАЗНЫМИ shape (полный `Tutor` vs урезанный
 * `TutorProfile`): после захода на `/tutor/profile` (а tutor-chrome SideNav/
 * MobileTopBar монтируют этот хук на каждой странице) кэш мог содержать урезанный
 * объект без `invite_code`/`booking_link`, и `useTutor()` на других страницах
 * получал его как `Tutor` с undefined-полями. Теперь ключи разведены; мутации
 * профиля инвалидируют ОБА, чтобы и карточка, и app-wide `useTutor()`-консьюмеры
 * обновились. Оба ключа под префиксом `['tutor']` — prefix-инвалидации
 * tutorStudentCacheSync их видят.
 */

/** Ключ этого хука: профиль-карточка (имя/аватар/предметы/пол/mini_groups). */
const TUTOR_PROFILE_CARD_KEY = ['tutor', 'profile', 'card'] as const;
/** Ключ `useTutor()`/`getCurrentTutor()` — полная строка `tutors` (app-wide). */
const FULL_TUTOR_QUERY_KEY = ['tutor', 'profile'] as const;
const TUTOR_PROFILE_STALE_TIME_MS = 5 * 60_000; // 5 minutes per spec.

/** Инвалидирует ОБА профиль-ключа (карточка + полная строка `useTutor`). */
function invalidateTutorProfileEverywhere(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: TUTOR_PROFILE_CARD_KEY });
  void queryClient.invalidateQueries({ queryKey: FULL_TUTOR_QUERY_KEY });
}

/**
 * Fetches the current user's tutor profile.
 * Returns `null` (not `undefined`) when the row doesn't exist yet so callers
 * can distinguish "loading" (`isLoading === true`) from "first visit"
 * (`data === null`).
 */
export function useTutorProfile() {
  return useQuery<TutorProfile | null>({
    queryKey: TUTOR_PROFILE_CARD_KEY,
    queryFn: getTutorProfile,
    staleTime: TUTOR_PROFILE_STALE_TIME_MS,
  });
}

/**
 * Creates or updates name/subjects/gender on the current tutor profile.
 * Avatar is intentionally NOT in this mutation — see {@link useUploadAvatar}.
 */
export function useUpsertTutorProfile() {
  const queryClient = useQueryClient();
  return useMutation<TutorProfile, Error, UpsertTutorProfileInput>({
    mutationFn: upsertTutorProfile,
    onSuccess: (data) => {
      // Seed only the CARD key (data — TutorProfile-shape; класть его на полный
      // ключ нельзя, иначе затрём Tutor-shape для useTutor-консьюмеров).
      queryClient.setQueryData(TUTOR_PROFILE_CARD_KEY, data);
      invalidateTutorProfileEverywhere(queryClient);
    },
  });
}

/**
 * Sets the tutor's work mode (mini-groups on/off → `tutors.mini_groups_enabled`).
 * Инвалидирует оба профиль-ключа, чтобы и карточка профиля, и read-sites
 * (students/schedule/homework/mock-exam через `useTutor`) подхватили изменение.
 * Заменяет самовыключавшийся тумблер из шапки /tutor/students (2026-06-07).
 */
export function useSetTutorMiniGroupsEnabled() {
  const queryClient = useQueryClient();
  return useMutation<Tutor | null, Error, boolean>({
    mutationFn: (enabled) => setTutorMiniGroupsEnabled(enabled),
    onSuccess: () => {
      invalidateTutorProfileEverywhere(queryClient);
    },
  });
}

/**
 * Uploads a canvas-compressed avatar Blob (≤ 2 MB, 512×512 JPEG produced by
 * AvatarUpload from TASK-4) and updates `tutors.avatar_url`.
 * Returns the new public URL on success.
 */
export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation<string, Error, Blob>({
    mutationFn: uploadAvatar,
    onSuccess: () => {
      invalidateTutorProfileEverywhere(queryClient);
    },
  });
}

/**
 * Clears `tutors.avatar_url` and removes the previous file from storage.
 */
export function useRemoveAvatar() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: removeAvatar,
    onSuccess: () => {
      invalidateTutorProfileEverywhere(queryClient);
    },
  });
}
