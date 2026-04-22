import { useQuery } from '@tanstack/react-query';
import { useTutorStudents } from '@/hooks/useTutor';
import { supabase } from '@/lib/supabaseClient';
import { getCurrentTutor } from '@/lib/tutors';

export interface TutorChromeCounters {
  activeStudents: number | null;
  activeHomework: number | null;
}

async function fetchActiveHomeworkCount(): Promise<number> {
  const tutor = await getCurrentTutor();
  if (!tutor) return 0;
  const { count, error } = await supabase
    .from('homework_tutor_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('tutor_id', tutor.user_id)
    .eq('status', 'active');
  if (error) {
    console.warn('tutor_chrome_active_hw_count_failed', error.message);
    return 0;
  }
  return count ?? 0;
}

export function useTutorChromeCounters(): TutorChromeCounters {
  const { students, loading: studentsLoading } = useTutorStudents();

  const { data: activeHomework, isLoading: hwLoading } = useQuery({
    queryKey: ['tutor', 'chrome', 'active-hw-count'] as const,
    queryFn: fetchActiveHomeworkCount,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const activeStudents = studentsLoading
    ? null
    : students.filter((s) => s.status === 'active').length;

  return {
    activeStudents,
    activeHomework: hwLoading ? null : activeHomework ?? 0,
  };
}
