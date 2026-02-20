import { supabase } from '@/lib/supabaseClient';
import type { 
  Tutor, 
  TutorStudent, 
  TutorStudentWithProfile,
  CreateTutorStudentInput,
  ManualAddTutorStudentInput,
  ManualAddTutorStudentResponse,
  UpdateTutorStudentProfileInput,
  UpdateTutorStudentProfileResponse,
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
  UpdateTutorPaymentInput,
  TutorWeeklySlot,
  CreateWeeklySlotInput,
  UpdateWeeklySlotInput,
  TutorLesson,
  TutorLessonWithStudent,
  CreateLessonInput,
  UpdateLessonInput,
  TutorReminderSettings,
  UpdateReminderSettingsInput,
  BookingSlot,
  TutorPublicInfo
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
  // Use getSession() (local cache, instant) instead of getUser() (network call)
  // We only need the user ID here, not a fresh server-side verification
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    clearTutorCache();
    return null;
  }
  const user = session.user;

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
 * Ручное добавление ученика (через edge function)
 */
export async function manualAddTutorStudent(
  input: ManualAddTutorStudentInput,
): Promise<ManualAddTutorStudentResponse> {
  const { data, error } = await supabase.functions.invoke("tutor-manual-add-student", {
    body: input,
  });

  if (error) {
    console.error("Error adding student manually:", error);
    throw new Error(error.message || "Не удалось добавить ученика");
  }

  return data as ManualAddTutorStudentResponse;
}

/**
 * Обновить профиль ученика (через edge function)
 */
export async function updateTutorStudentProfile(
  input: UpdateTutorStudentProfileInput,
): Promise<UpdateTutorStudentProfileResponse> {
  const { data, error } = await supabase.functions.invoke("tutor-update-student", {
    body: input,
  });

  if (error) {
    console.error("Error updating student profile:", error);
    throw new Error(error.message || "Не удалось обновить ученика");
  }

  return data as UpdateTutorStudentProfileResponse;
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
        grade,
        learning_goal
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
        hourly_rate_cents,
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

// =============================================
// A1: Недельные слоты (Weekly Slots)
// =============================================

/**
 * Получить все недельные слоты репетитора
 */
export async function getTutorWeeklySlots(): Promise<TutorWeeklySlot[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const { data, error } = await supabase
    .from('tutor_weekly_slots')
    .select('*')
    .eq('tutor_id', tutor.id)
    .order('day_of_week')
    .order('start_time');
  
  if (error) {
    console.error('Error fetching weekly slots:', error);
    return [];
  }
  
  return data as TutorWeeklySlot[];
}

/**
 * Создать недельный слот
 */
export async function createWeeklySlot(
  input: CreateWeeklySlotInput
): Promise<TutorWeeklySlot | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) return null;

  const { data, error } = await supabase
    .from('tutor_weekly_slots')
    .insert({
      tutor_id: tutor.id,
      ...input
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating weekly slot:', error);
    return null;
  }
  
  return data as TutorWeeklySlot;
}

/**
 * Обновить недельный слот
 */
export async function updateWeeklySlot(
  id: string,
  input: UpdateWeeklySlotInput
): Promise<TutorWeeklySlot | null> {
  const { data, error } = await supabase
    .from('tutor_weekly_slots')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating weekly slot:', error);
    return null;
  }
  
  return data as TutorWeeklySlot;
}

/**
 * Удалить недельный слот
 */
export async function deleteWeeklySlot(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('tutor_weekly_slots')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting weekly slot:', error);
    return false;
  }
  
  return true;
}

/**
 * Переключить доступность слота
 */
export async function toggleSlotAvailability(
  id: string,
  isAvailable: boolean
): Promise<TutorWeeklySlot | null> {
  return updateWeeklySlot(id, { is_available: isAvailable });
}

// =============================================
// A1: Занятия (Lessons)
// =============================================

/**
 * Получить занятия репетитора за период
 */
export async function getTutorLessons(
  startDate: string,
  endDate: string
): Promise<TutorLessonWithStudent[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const { data, error } = await supabase
    .from('tutor_lessons')
    .select(`
      *,
      tutor_students (
        id,
        student_id,
        profiles (
          id,
          username,
          telegram_username
        )
      ),
      profiles (
        id,
        username,
        telegram_username
      )
    `)
    .eq('tutor_id', tutor.id)
    .gte('start_at', startDate)
    .lt('start_at', endDate)
    .order('start_at');
  
  if (error) {
    console.error('Error fetching lessons:', error);
    return [];
  }
  
  return data as TutorLessonWithStudent[];
}

/**
 * Создать занятие вручную
 */
export async function createLesson(
  input: CreateLessonInput
): Promise<TutorLesson | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) return null;

  const { data, error } = await supabase
    .from('tutor_lessons')
    .insert({
      tutor_id: tutor.id,
      source: 'manual',
      ...input
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating lesson:', error);
    return null;
  }
  
  return data as TutorLesson;
}

/**
 * Обновить занятие
 */
export async function updateLesson(
  id: string,
  input: UpdateLessonInput
): Promise<TutorLesson | null> {
  const updateData: Record<string, unknown> = { ...input };
  
  // Если отменяем, добавляем timestamp
  if (input.status === 'cancelled') {
    updateData.cancelled_at = new Date().toISOString();
  }
  
  const { data, error } = await supabase
    .from('tutor_lessons')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating lesson:', error);
    return null;
  }
  
  return data as TutorLesson;
}

/**
 * Отменить занятие
 */
export async function cancelLesson(
  id: string,
  cancelledBy: 'tutor' | 'student' = 'tutor'
): Promise<TutorLesson | null> {
  return updateLesson(id, {
    status: 'cancelled',
    cancelled_by: cancelledBy
  });
}

/**
 * Удалить занятие
 */
export async function deleteLesson(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('tutor_lessons')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting lesson:', error);
    return false;
  }
  
  return true;
}

// =============================================
// A2: Настройки напоминаний (Reminder Settings)
// =============================================

/**
 * Получить настройки напоминаний
 */
export async function getReminderSettings(): Promise<TutorReminderSettings | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) return null;

  const { data, error } = await supabase
    .from('tutor_reminder_settings')
    .select('*')
    .eq('tutor_id', tutor.id)
    .single();
  
  if (error) {
    // Если нет записи, возвращаем null (используем дефолты)
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Error fetching reminder settings:', error);
    return null;
  }
  
  return data as TutorReminderSettings;
}

/**
 * Создать или обновить настройки напоминаний
 */
export async function upsertReminderSettings(
  input: UpdateReminderSettingsInput
): Promise<TutorReminderSettings | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) return null;

  const { data, error } = await supabase
    .from('tutor_reminder_settings')
    .upsert({
      tutor_id: tutor.id,
      ...input
    }, {
      onConflict: 'tutor_id'
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error upserting reminder settings:', error);
    return null;
  }
  
  return data as TutorReminderSettings;
}

// =============================================
// Public Booking (Calendly-like)
// =============================================

/**
 * Получить публичную информацию о репетиторе по booking_link
 */
export async function getTutorPublicInfo(
  bookingLink: string
): Promise<TutorPublicInfo | null> {
  const { data, error } = await supabase
    .from('tutors')
    .select('id, name, avatar_url, subjects, bio')
    .eq('booking_link', bookingLink)
    .single();
  
  if (error) {
    console.error('Error fetching tutor public info:', error);
    return null;
  }
  
  return data as TutorPublicInfo;
}

/**
 * Получить доступные слоты для записи (публичная функция)
 */
export async function getAvailableBookingSlots(
  bookingLink: string,
  daysAhead: number = 7
): Promise<BookingSlot[]> {
  const { data, error } = await supabase
    .rpc('get_available_booking_slots', {
      _booking_link: bookingLink,
      _days_ahead: daysAhead
    });
  
  if (error) {
    console.error('Error fetching booking slots:', error);
    return [];
  }
  
  return (data || []) as BookingSlot[];
}

/**
 * Забронировать слот (для авторизованного ученика)
 */
export async function bookLessonSlot(
  bookingLink: string,
  slotDate: string,
  startTime: string,
  durationMin: number = 60
): Promise<string | null> {
  const { data, error } = await supabase
    .rpc('book_lesson_slot', {
      _booking_link: bookingLink,
      _slot_date: slotDate,
      _start_time: startTime,
      _duration_min: durationMin
    });
  
  if (error) {
    console.error('Error booking slot:', error);
    throw new Error(error.message);
  }
  
  return data as string;
}

/**
 * Генерирует уникальный booking_link для репетитора
 */
function generateBookingLink(tutorId: string): string {
  return `tutor-${tutorId.substring(0, 8)}`;
}

/**
 * Получить или создать ссылку для записи текущего репетитора
 */
export async function getBookingLink(): Promise<string | null> {
  let tutor = await getCurrentTutor();
  if (!tutor) return null;
  
  // Если booking_link не установлен - создаём автоматически
  if (!tutor.booking_link) {
    const newBookingLink = generateBookingLink(tutor.id);
    
    const { data, error } = await supabase
      .from('tutors')
      .update({ booking_link: newBookingLink })
      .eq('id', tutor.id)
      .select()
      .single();
    
    if (error) {
      console.error('Error creating booking link:', error);
      return null;
    }
    
    // Сбросить кэш чтобы получить новые данные
    clearTutorCache();
    tutor = data as Tutor;
  }
  
  return `${window.location.origin}/book/${tutor.booking_link}`;
}
