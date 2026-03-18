import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import {
  TUTOR_GC_TIME_MS,
  TUTOR_STALE_TIME_MS,
} from '@/hooks/tutorQueryOptions';

/**
 * Check if current user has 'moderator' role via has_role() DB function.
 * Uses getSession() (local cache, no network) for user id — safe for hot-path.
 * Result is cached per user (query key includes userId) to prevent stale
 * moderator status across account switches.
 */
async function checkIsModerator(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_role', {
    _user_id: userId,
    _role: 'moderator',
  });

  if (error) {
    console.error('useIsModerator: has_role RPC error', error);
    return false;
  }

  return data === true;
}

export function useIsModerator() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
  }, []);

  const { data: isModerator = false, isLoading } = useQuery<boolean>({
    queryKey: ['tutor', 'kb', 'isModerator', userId],
    queryFn: () => checkIsModerator(userId!),
    enabled: !!userId,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    refetchOnWindowFocus: false,
  });

  return { isModerator, isLoading: !userId || isLoading };
}
