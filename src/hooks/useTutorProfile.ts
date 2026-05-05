import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTutorProfile,
  removeAvatar,
  uploadAvatar,
  upsertTutorProfile,
  type TutorProfile,
  type UpsertTutorProfileInput,
} from '@/lib/tutorProfileApi';

/**
 * React Query bindings for the tutor profile API.
 *
 * Spec:    docs/delivery/features/tutor-profile/spec.md (v0.2)
 * Tasks:   docs/delivery/features/tutor-profile/tasks.md TASK-2
 *
 * Query key convention: `['tutor', 'profile']` — see CLAUDE.md performance.md
 * §2c. tutorStudentCacheSync.ts and other tutor-side invalidators rely on the
 * `'tutor'` prefix; do not deviate.
 */

const TUTOR_PROFILE_QUERY_KEY = ['tutor', 'profile'] as const;
const TUTOR_PROFILE_STALE_TIME_MS = 5 * 60_000; // 5 minutes per spec.

/**
 * Fetches the current user's tutor profile.
 * Returns `null` (not `undefined`) when the row doesn't exist yet so callers
 * can distinguish "loading" (`isLoading === true`) from "first visit"
 * (`data === null`).
 */
export function useTutorProfile() {
  return useQuery<TutorProfile | null>({
    queryKey: TUTOR_PROFILE_QUERY_KEY,
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
      // Optimistically populate the cache with the server's view so any
      // surface that already mounted (Navigation avatar, profile page) re-
      // renders without waiting for the refetch round-trip.
      queryClient.setQueryData(TUTOR_PROFILE_QUERY_KEY, data);
      void queryClient.invalidateQueries({ queryKey: TUTOR_PROFILE_QUERY_KEY });
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
      void queryClient.invalidateQueries({ queryKey: TUTOR_PROFILE_QUERY_KEY });
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
      void queryClient.invalidateQueries({ queryKey: TUTOR_PROFILE_QUERY_KEY });
    },
  });
}
