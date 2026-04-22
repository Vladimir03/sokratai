import { useQuery } from '@tanstack/react-query';
import { useTutorStudents } from '@/hooks/useTutor';
import { supabase } from '@/lib/supabaseClient';
import { getCurrentTutor } from '@/lib/tutors';

export interface TutorChromeCounters {
  activeStudents: number | null;
  totalStudents: number | null;
  activeHomework: number | null;
  totalHomework: number | null;
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

async function fetchTotalHomeworkCount(): Promise<number> {
  const tutor = await getCurrentTutor();
  if (!tutor) return 0;
  const { count, error } = await supabase
    .from('homework_tutor_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('tutor_id', tutor.user_id);
  if (error) {
    console.warn('tutor_chrome_total_hw_count_failed', error.message);
    return 0;
  }
  return count ?? 0;
}

export function useTutorChromeCounters(): TutorChromeCounters {
  const { students, loading: studentsLoading } = useTutorStudents();

  const { data: activeHomework, isLoading: activeHwLoading } = useQuery({
    queryKey: ['tutor', 'chrome', 'active-hw-count'] as const,
    queryFn: fetchActiveHomeworkCount,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: totalHomework, isLoading: totalHwLoading } = useQuery({
    queryKey: ['tutor', 'chrome', 'total-hw-count'] as const,
    queryFn: fetchTotalHomeworkCount,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const activeStudents = studentsLoading
    ? null
    : students.filter((s) => s.status === 'active').length;
  const totalStudents = studentsLoading ? null : students.length;

  return {
    activeStudents,
    totalStudents,
    activeHomework: activeHwLoading ? null : activeHomework ?? 0,
    totalHomework: totalHwLoading ? null : totalHomework ?? 0,
  };
}
