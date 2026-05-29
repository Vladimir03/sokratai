import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

/**
 * Per-tutor feature flag for voice-speaking-mvp (устные задания, task_kind='speaking').
 * Mirror of `useTutorMockExamsFeatureFlag` (column `feature_voice_speaking_enabled`,
 * migration `20260529120100`). Gates the «Устный ответ (монолог)» task-type option
 * in the homework constructor. MVP: enabled only for Эмилия.
 */
export const TUTOR_VOICE_SPEAKING_FLAG_QUERY_KEY = ['tutor', 'feature-flags', 'voice-speaking'] as const;

type TutorVoiceSpeakingFlagRow = {
  feature_voice_speaking_enabled: boolean | null;
};

type TutorFeatureFlagSelect = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => Promise<{
        data: TutorVoiceSpeakingFlagRow | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

async function fetchTutorVoiceSpeakingFeatureFlag(): Promise<boolean> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  const userId = session?.user?.id;
  if (!userId) {
    return false;
  }

  // `feature_voice_speaking_enabled` is added by migration 20260529120100, but
  // generated Supabase TS types may lag until the migration is applied remotely.
  const { data, error } = await (
    supabase.from('tutors') as unknown as TutorFeatureFlagSelect
  )
    .select('feature_voice_speaking_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? 'Не удалось загрузить флаг голосовых заданий');
  }

  return data?.feature_voice_speaking_enabled === true;
}

export function useTutorVoiceSpeakingFeatureFlag() {
  return useQuery<boolean>({
    queryKey: TUTOR_VOICE_SPEAKING_FLAG_QUERY_KEY,
    queryFn: fetchTutorVoiceSpeakingFeatureFlag,
    staleTime: 60_000,
  });
}
