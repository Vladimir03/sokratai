import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

export const TUTOR_FEATURE_FLAGS_QUERY_KEY = ['tutor', 'feature-flags'] as const;

type TutorMockExamsFlagRow = {
  feature_mock_exams_enabled: boolean | null;
};

type TutorFeatureFlagSelect = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => Promise<{
        data: TutorMockExamsFlagRow | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

async function fetchTutorMockExamsFeatureFlag(): Promise<boolean> {
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

  // `feature_mock_exams_enabled` is added by the Mock Exams v1 migration, but
  // generated Supabase TS types may lag until the migration is applied remotely.
  const { data, error } = await (
    supabase.from('tutors') as unknown as TutorFeatureFlagSelect
  )
    .select('feature_mock_exams_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? 'Не удалось загрузить флаг пробников');
  }

  return data?.feature_mock_exams_enabled === true;
}

export function useTutorMockExamsFeatureFlag() {
  return useQuery<boolean>({
    queryKey: TUTOR_FEATURE_FLAGS_QUERY_KEY,
    queryFn: fetchTutorMockExamsFeatureFlag,
    staleTime: 60_000,
  });
}
