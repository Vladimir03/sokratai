import { useState, useEffect, useCallback } from 'react';
import { getCurrentTutor, getTutorStudents } from '@/lib/tutors';
import type { Tutor, TutorStudentWithProfile } from '@/types/tutor';

export function useTutor() {
  const [tutor, setTutor] = useState<Tutor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTutor = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCurrentTutor();
      setTutor(data);
    } catch (err) {
      console.error('Error in useTutor:', err);
      setError('Не удалось загрузить профиль');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTutor();
  }, [fetchTutor]);

  return { tutor, loading, error, refetch: fetchTutor };
}

export function useTutorStudents() {
  const [students, setStudents] = useState<TutorStudentWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTutorStudents();
      setStudents(data);
    } catch (err) {
      console.error('Error in useTutorStudents:', err);
      setError('Не удалось загрузить учеников');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  return { students, loading, error, refetch: fetchStudents };
}
