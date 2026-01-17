import { supabase } from '@/integrations/supabase/client';
import type { 
  Tutor, 
  TutorStudent, 
  TutorStudentWithProfile,
  CreateTutorStudentInput,
  UpdateTutorStudentInput,
  UpdateTutorInput
} from '@/types/tutor';

/**
 * Получить профиль текущего репетитора
 */
export async function getCurrentTutor(): Promise<Tutor | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('tutors')
    .select('*')
    .eq('user_id', user.id)
    .single();
  
  if (error) {
    console.error('Error fetching tutor:', error);
    return null;
  }
  
  return data as Tutor;
}

/**
 * Получить репетитора по booking_link (публичный доступ)
 */
export async function getTutorByBookingLink(bookingLink: string): Promise<Tutor | null> {
  const { data, error } = await supabase
    .from('tutors')
    .select('*')
    .eq('booking_link', bookingLink)
    .single();
  
  if (error) {
    console.error('Error fetching tutor by booking link:', error);
    return null;
  }
  
  return data as Tutor;
}

/**
 * Обновить профиль репетитора
 */
export async function updateTutor(
  id: string, 
  updates: UpdateTutorInput
): Promise<Tutor | null> {
  const { data, error } = await supabase
    .from('tutors')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating tutor:', error);
    return null;
  }
  
  return data as Tutor;
}

/**
 * Получить список учеников репетитора
 */
export async function getTutorStudents(): Promise<TutorStudentWithProfile[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const { data, error } = await supabase
    .from('tutor_students')
    .select(`
      *,
      profiles (
        id,
        username,
        telegram_username,
        grade
      )
    `)
    .eq('tutor_id', tutor.id)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching students:', error);
    return [];
  }
  
  return data as TutorStudentWithProfile[];
}

/**
 * Получить одного ученика по ID
 */
export async function getTutorStudent(
  id: string
): Promise<TutorStudentWithProfile | null> {
  const { data, error } = await supabase
    .from('tutor_students')
    .select(`
      *,
      profiles (
        id,
        username,
        telegram_username,
        grade
      )
    `)
    .eq('id', id)
    .single();
  
  if (error) {
    console.error('Error fetching student:', error);
    return null;
  }
  
  return data as TutorStudentWithProfile;
}

/**
 * Добавить ученика к репетитору
 */
export async function addStudentToTutor(
  input: CreateTutorStudentInput
): Promise<TutorStudent | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) {
    console.error('No tutor profile found');
    return null;
  }
  
  const { data, error } = await supabase
    .from('tutor_students')
    .insert({
      tutor_id: tutor.id,
      ...input
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error adding student:', error);
    return null;
  }
  
  return data as TutorStudent;
}

/**
 * Обновить данные ученика
 */
export async function updateTutorStudent(
  id: string,
  input: UpdateTutorStudentInput
): Promise<TutorStudent | null> {
  const { data, error } = await supabase
    .from('tutor_students')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating student:', error);
    return null;
  }
  
  return data as TutorStudent;
}

/**
 * Удалить связь с учеником
 */
export async function removeStudentFromTutor(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('tutor_students')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error removing student:', error);
    return false;
  }
  
  return true;
}
