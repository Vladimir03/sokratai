import { useQuery } from '@tanstack/react-query';
import type { UserIdentity } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabaseClient';

/**
 * Reads the current user's auth identities from Supabase Auth.
 *
 * Spec:    docs/delivery/features/tutor-profile/spec.md (v0.4 §3 п.5)
 * Tasks:   docs/delivery/features/tutor-profile/tasks.md TASK-18
 *
 * Source of truth for "которыми способами этот user может войти". Used by
 * SecuritySection to branch into 3 states (A: email-only, B: google-only,
 * C: mixed) and (in TASK-19) by LoginProvidersSection to surface link/unlink
 * affordances. We deliberately do NOT mirror this into a tutors column —
 * Supabase Auth is the canonical store; sync would only create drift.
 *
 * Query key convention: `['auth', 'identities']` — auth-domain scope, NOT
 * `['tutor', ...]`, because identities are user-level (student or tutor),
 * not tutor-specific (see CLAUDE.md performance.md §2c).
 */

const AUTH_IDENTITIES_QUERY_KEY = ['auth', 'identities'] as const;

export const AUTH_IDENTITIES_KEY = AUTH_IDENTITIES_QUERY_KEY;

// 60s — identities change only on link/unlink/sign-up, all of which we
// invalidate explicitly. Longer staleTime would not pay off.
const STALE_TIME_MS = 60_000;

export interface UseUserIdentitiesResult {
  identities: UserIdentity[];
  hasEmailPassword: boolean;
  hasGoogle: boolean;
  hasTelegram: boolean;
  isLoading: boolean;
  error: Error | null;
}

async function fetchUserIdentities(): Promise<UserIdentity[]> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;
  return data?.identities ?? [];
}

export function useUserIdentities(): UseUserIdentitiesResult {
  const query = useQuery<UserIdentity[]>({
    queryKey: AUTH_IDENTITIES_QUERY_KEY,
    queryFn: fetchUserIdentities,
    staleTime: STALE_TIME_MS,
  });

  const identities = query.data ?? [];

  // Telegram in this project is a custom flow that does NOT register a
  // Supabase identity (deep-link bot login mints a session via verifyOtp).
  // `hasTelegram` is therefore always false here; the canonical signal for
  // "Telegram is linked" remains `profiles.telegram_user_id`. Keep the
  // field on the return shape for forward-compat with TASK-19 if Telegram
  // ever migrates to a real OAuth provider.
  return {
    identities,
    hasEmailPassword: identities.some((identity) => identity.provider === 'email'),
    hasGoogle: identities.some((identity) => identity.provider === 'google'),
    hasTelegram: identities.some((identity) => identity.provider === 'telegram'),
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
