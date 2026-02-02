import { supabase } from '@/lib/supabaseClient';
import type { 
  Tutor, 
  TutorStudent, 
  TutorStudentWithProfile,
  CreateTutorStudentInput,
  UpdateTutorStudentInput,
  UpdateTutorInput,
  MockExam,
  CreateMockExamInput,
  UpdateMockExamInput,
  StudentChat,
  StudentChatMessage,
  TutorPayment,
  TutorPaymentWithStudent,
  CreateTutorPaymentInput,
  UpdateTutorPaymentInput
} from '@/types/tutor';

// In-memory cache for tutor profile
let cachedTutor: Tutor | null = null;
let cachedTutorUserId: string | null = null;

/**
 * Clear tutor cache (call on logout)
 */
export function clearTutorCache() {
  cachedTutor = null;
  cachedTutorUserId = null;
}

/**
 * Получить профиль текущего репетитора (с кэшированием)
 */
export async function getCurrentTutor(): Promise<Tutor | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    clearTutorCache();
    return null;
  }

  // Return cached tutor if user_id matches
  if (cachedTutor && cachedTutorUserId === user.id) {
    return cachedTutor;
  }

  const { data, error } = await supabase
    .from('tutors')
    .select('*')
    .eq('user_id', user.id)
    .single();
  
  if (error) {
    console.error('Error fetching tutor:', error);
    return null;
  }
  
  // Cache the result
  cachedTutor = data as Tutor;
  cachedTutorUserId = user.id;
  
  return cachedTutor;
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
        telegram_user_id,
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
        telegram_user_id,
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

// =============================================
// Пробники (Mock Exams)
// =============================================

/**
 * Получить список пробников для ученика
 */
export async function getMockExams(tutorStudentId: string): Promise<MockExam[]> {
  const { data, error } = await supabase
    .from('tutor_student_mock_exams')
    .select('*')
    .eq('tutor_student_id', tutorStudentId)
    .order('date', { ascending: false });
  
  if (error) {
    console.error('Error fetching mock exams:', error);
    return [];
  }
  
  return data as MockExam[];
}

/**
 * Создать пробник
 */
export async function createMockExam(input: CreateMockExamInput): Promise<MockExam | null> {
  const { data, error } = await supabase
    .from('tutor_student_mock_exams')
    .insert(input)
    .select()
    .single();
  
  if (error) {
    console.error('Error creating mock exam:', error);
    return null;
  }
  
  return data as MockExam;
}

/**
 * Обновить пробник
 */
export async function updateMockExam(
  id: string, 
  input: UpdateMockExamInput
): Promise<MockExam | null> {
  const { data, error } = await supabase
    .from('tutor_student_mock_exams')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating mock exam:', error);
    return null;
  }
  
  return data as MockExam;
}

/**
 * Удалить пробник
 */
export async function deleteMockExam(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('tutor_student_mock_exams')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting mock exam:', error);
    return false;
  }
  
  return true;
}

// =============================================
// Чаты ученика (для просмотра репетитором)
// =============================================

/**
 * Получить список чатов ученика
 */
export async function getStudentChats(studentId: string): Promise<StudentChat[]> {
  const { data, error } = await supabase
    .from('chats')
    .select('id, user_id, chat_type, title, last_message_at, created_at')
    .eq('user_id', studentId)
    .order('last_message_at', { ascending: false, nullsFirst: false });
  
  if (error) {
    console.error('Error fetching student chats:', error);
    return [];
  }
  
  return data as StudentChat[];
}

/**
 * Получить сообщения чата (с пагинацией)
 */
export async function getStudentChatMessages(
  chatId: string,
  limit = 50,
  beforeTimestamp?: string
): Promise<StudentChatMessage[]> {
  let query = supabase
    .from('chat_messages')
    .select('id, chat_id, user_id, role, content, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (beforeTimestamp) {
    query = query.lt('created_at', beforeTimestamp);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error fetching chat messages:', error);
    return [];
  }
  
  // Возвращаем в хронологическом порядке
  return (data as StudentChatMessage[]).reverse();
}

// =============================================
// Оплаты (Tutor Payments A3)
// =============================================

/**
 * Получить все оплаты репетитора (через tutor_students)
 */
export async function getTutorPayments(): Promise<TutorPaymentWithStudent[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const { data, error } = await supabase
    .from('tutor_payments')
    .select(`
      *,
      tutor_students!inner (
        id,
        student_id,
        parent_contact,
        tutor_id,
        profiles (
          id,
          username,
          telegram_username
        )
      )
    `)
    .eq('tutor_students.tutor_id', tutor.id)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching tutor payments:', error);
    return [];
  }
  
  return data as TutorPaymentWithStudent[];
}

/**
 * Создать запись об оплате
 */
export async function createTutorPayment(
  input: CreateTutorPaymentInput
): Promise<TutorPayment | null> {
  const { data, error } = await supabase
    .from('tutor_payments')
    .insert(input)
    .select()
    .single();
  
  if (error) {
    console.error('Error creating tutor payment:', error);
    return null;
  }
  
  return data as TutorPayment;
}

/**
 * Обновить запись об оплате
 */
export async function updateTutorPayment(
  id: string,
  input: UpdateTutorPaymentInput
): Promise<TutorPayment | null> {
  const { data, error } = await supabase
    .from('tutor_payments')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating tutor payment:', error);
    return null;
  }
  
  return data as TutorPayment;
}

/**
 * Отметить оплату как оплаченную
 */
export async function markPaymentAsPaid(id: string): Promise<TutorPayment | null> {
  return updateTutorPayment(id, {
    status: 'paid',
    paid_at: new Date().toISOString()
  });
}

/**
 * Удалить запись об оплате
 */
export async function deleteTutorPayment(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('tutor_payments')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting tutor payment:', error);
    return false;
  }
  
  return true;
}
