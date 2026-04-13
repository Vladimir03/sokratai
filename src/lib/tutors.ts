import { supabase } from '@/lib/supabaseClient';
import type {
  Tutor,
  TutorGroup,
  TutorGroupMembership,
  CreateTutorGroupInput,
  TutorStudent,
  TutorStudentWithProfile,
  CreateTutorStudentInput,
  ManualAddTutorStudentInput,
  ManualAddTutorStudentResponse,
  ResetStudentPasswordInput,
  ResetStudentPasswordResponse,
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
  UpdateTutorPaymentInput
} from '@/types/tutor';

// In-memory cache for tutor profile
let cachedTutor: Tutor | null = null;
let cachedTutorUserId: string | null = null;

type TutorStudentDebtRow = {
  tutor_student_id: string;
  pending_amount: number;
  overdue_amount: number;
  debt_amount: number;
};

type StudentContactInfoRow = {
  student_id: string;
  login_email: string | null;
  has_real_email: boolean;
};

const STUDENT_PROFILE_SELECT = `
  *,
  profiles (
    id,
    username,
    telegram_username,
    telegram_user_id,
    grade,
    last_sign_in_at
  )
`;

const STUDENT_PROFILE_DETAIL_SELECT = `
  *,
  profiles (
    id,
    username,
    telegram_username,
    telegram_user_id,
    grade,
    learning_goal,
    last_sign_in_at
  )
`;

function enrichWithDebt<T extends { id: string }>(
  students: T[],
  debtMap: Map<string, TutorStudentDebtRow>
): T[] {
  return students.map((student) => {
    const debt = debtMap.get(student.id);
    return {
      ...student,
      pending_amount: debt?.pending_amount ?? 0,
      overdue_amount: debt?.overdue_amount ?? 0,
      debt_amount: debt?.debt_amount ?? 0,
    };
  });
}

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
  // getSession() reads from local cache (instant, no network call)
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    clearTutorCache();
    return null;
  }
  const userId = session.user.id;

  if (cachedTutor && cachedTutorUserId === userId) {
    return cachedTutor;
  }

  const { data, error } = await supabase
    .from('tutors')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Error fetching tutor:', error);
    return null;
  }

  cachedTutor = data as Tutor;
  cachedTutorUserId = userId;
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
 * Batch-resolve student login email + has_real_email via RPC (SECURITY DEFINER reads auth.users).
 */
async function getStudentsContactInfo(
  studentIds: string[]
): Promise<Map<string, StudentContactInfoRow>> {
  const map = new Map<string, StudentContactInfoRow>();
  if (studentIds.length === 0) return map;

  const { data, error } = await supabase.rpc('get_students_contact_info', {
    student_ids: studentIds,
  });

  if (error) {
    console.error('Error fetching student contact info:', error);
    return map;
  }

  for (const row of data ?? []) {
    map.set(row.student_id, row);
  }
  return map;
}

/**
 * Enrich students with activation + channel flags.
 */
function enrichWithChannelFlags(
  students: TutorStudentWithProfile[],
  contactInfo: Map<string, StudentContactInfoRow>
): TutorStudentWithProfile[] {
  return students.map((s) => ({
    ...s,
    last_sign_in_at: s.profiles?.last_sign_in_at ?? null,
    login_email: contactInfo.get(s.student_id)?.login_email ?? null,
    has_real_email: contactInfo.get(s.student_id)?.has_real_email ?? false,
    has_telegram_bot: s.profiles?.telegram_user_id != null,
    has_telegram_username:
      s.profiles?.telegram_username != null &&
      s.profiles.telegram_username !== '',
  }));
}

/**
 * Получить список учеников репетитора
 */
export async function getTutorStudents(): Promise<TutorStudentWithProfile[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const { data, error } = await supabase
    .from('tutor_students')
    .select(STUDENT_PROFILE_SELECT)
    .eq('tutor_id', tutor.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching students:', error);
    return [];
  }

  const students = (data ?? []) as TutorStudentWithProfile[];

  // Parallel: debt map + email flags
  const studentIds = students.map((s) => s.student_id);
  const [debtMap, contactInfo] = await Promise.all([
    getTutorStudentsDebtMap(),
    getStudentsContactInfo(studentIds),
  ]);

  const withDebt = enrichWithDebt(students, debtMap);
  return enrichWithChannelFlags(withDebt, contactInfo);
}

/**
 * Обновить глобальный feature toggle mini-groups
 */
export async function setTutorMiniGroupsEnabled(enabled: boolean): Promise<Tutor | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) {
    console.error('No tutor profile found');
    return null;
  }

  const { data, error } = await (supabase
    .from('tutors') as any)
    .update({ mini_groups_enabled: enabled })
    .eq('id', tutor.id)
    .select('*')
    .single();

  if (error) {
    console.error('Error updating mini groups toggle:', error);
    return null;
  }

  cachedTutor = data as Tutor;
  return cachedTutor;
}

/**
 * Получить список групп текущего репетитора
 */
export async function getTutorGroups(activeOnly = true): Promise<TutorGroup[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  let query = (supabase
    .from('tutor_groups') as any)
    .select('*')
    .eq('tutor_id', tutor.id)
    .order('created_at', { ascending: true });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching tutor groups:', error);
    return [];
  }

  return (data ?? []) as TutorGroup[];
}

/**
 * Создать группу текущего репетитора
 */
export async function createTutorGroup(
  input: CreateTutorGroupInput
): Promise<TutorGroup | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) {
    console.error('No tutor profile found');
    return null;
  }

  const name = input.name.trim();
  if (!name) {
    console.error('Group name cannot be empty');
    return null;
  }

  const { data, error } = await (supabase
    .from('tutor_groups') as any)
    .insert({
      tutor_id: tutor.id,
      name,
      short_name: input.short_name ?? null,
      color: input.color ?? null,
      is_active: true,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Error creating tutor group:', error);
    return null;
  }

  return data as TutorGroup;
}

/**
 * Получить memberships учеников по группам (с метаданными группы)
 */
export async function getTutorGroupMemberships(
  activeOnly = true
): Promise<TutorGroupMembership[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  let query = (supabase
    .from('tutor_group_memberships') as any)
    .select(`
      id,
      tutor_id,
      tutor_student_id,
      tutor_group_id,
      is_active,
      created_at,
      updated_at,
      tutor_group:tutor_groups (
        id,
        tutor_id,
        name,
        short_name,
        color,
        is_active,
        created_at,
        updated_at
      )
    `)
    .eq('tutor_id', tutor.id)
    .order('created_at', { ascending: true });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching tutor group memberships:', error);
    return [];
  }

  return (data ?? []) as unknown as TutorGroupMembership[];
}

/**
 * Назначить (или обновить) активный membership ученика в группе.
 * В MVP допускается только один активный membership на ученика.
 */
export async function upsertTutorGroupMembership(
  tutorStudentId: string,
  tutorGroupId: string
): Promise<TutorGroupMembership | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) {
    console.error('No tutor profile found');
    return null;
  }

  const { error: deactivateOthersError } = await (supabase
    .from('tutor_group_memberships') as any)
    .update({ is_active: false })
    .eq('tutor_id', tutor.id)
    .eq('tutor_student_id', tutorStudentId)
    .eq('is_active', true)
    .neq('tutor_group_id', tutorGroupId);

  if (deactivateOthersError) {
    console.error('Error deactivating previous memberships:', deactivateOthersError);
    return null;
  }

  const { data, error } = await (supabase
    .from('tutor_group_memberships') as any)
    .upsert(
      {
        tutor_id: tutor.id,
        tutor_student_id: tutorStudentId,
        tutor_group_id: tutorGroupId,
        is_active: true,
      },
      { onConflict: 'tutor_student_id,tutor_group_id' }
    )
    .select(`
      id,
      tutor_id,
      tutor_student_id,
      tutor_group_id,
      is_active,
      created_at,
      updated_at
    `)
    .single();

  if (error) {
    console.error('Error upserting tutor group membership:', error);
    return null;
  }

  return data as TutorGroupMembership;
}

/**
 * Деактивировать активный membership ученика в группе
 */
export async function deactivateTutorGroupMembership(
  tutorStudentId: string
): Promise<boolean> {
  const tutor = await getCurrentTutor();
  if (!tutor) {
    console.error('No tutor profile found');
    return false;
  }

  const { error } = await (supabase
    .from('tutor_group_memberships') as any)
    .update({ is_active: false })
    .eq('tutor_id', tutor.id)
    .eq('tutor_student_id', tutorStudentId)
    .eq('is_active', true);

  if (error) {
    console.error('Error deactivating tutor group membership:', error);
    return false;
  }

  return true;
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
    console.error("Error adding student manually:", error, "data:", data);
    const detail =
      (data && typeof data === "object" && typeof (data as any).error === "string")
        ? (data as any).error
        : error.message || "Не удалось добавить ученика";
    throw new Error(detail);
  }

  return data as ManualAddTutorStudentResponse;
}

/**
 * Сбросить пароль ученика и вернуть новые данные для входа.
 */
export async function resetStudentPassword(
  input: ResetStudentPasswordInput,
): Promise<ResetStudentPasswordResponse> {
  const { data, error } = await supabase.functions.invoke("tutor-manual-add-student", {
    body: {
      action: "reset-student-password",
      ...input,
    },
  });

  if (error) {
    console.error("Error resetting student password:", error, "data:", data);
    const detail =
      (data && typeof data === "object" && typeof (data as any).error === "string")
        ? (data as any).error
        : error.message || "Не удалось сбросить пароль ученика";
    throw new Error(detail);
  }

  return data as ResetStudentPasswordResponse;
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
    .select(STUDENT_PROFILE_DETAIL_SELECT)
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching student:', error);
    return null;
  }

  const student = data as TutorStudentWithProfile;
  const [debtMap, contactInfo] = await Promise.all([
    getTutorStudentsDebtMap(),
    getStudentsContactInfo([student.student_id]),
  ]);

  const withDebt = enrichWithDebt([student], debtMap);
  return enrichWithChannelFlags(withDebt, contactInfo)[0];
}

async function getTutorStudentsDebtMap(): Promise<Map<string, TutorStudentDebtRow>> {
  const { data, error } = await supabase.rpc('get_tutor_students_debt');
  if (error) {
    console.error('Error fetching students debt:', error);
    return new Map<string, TutorStudentDebtRow>();
  }

  const rows = (data || []) as TutorStudentDebtRow[];
  return new Map(rows.map((row) => [row.tutor_student_id, row]));
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
    .insert({ tutor_id: tutor.id, ...input })
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

  return (data as StudentChatMessage[]).reverse();
}

// =============================================
// Оплаты (Tutor Payments A3)
// =============================================

export async function getTutorPayments(): Promise<TutorPaymentWithStudent[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const { data, error } = await supabase
    .from('tutor_payments')
    .select(`
      *,
      tutor_lessons (
        id,
        start_at
      ),
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

  return data as unknown as TutorPaymentWithStudent[];
}

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

export async function markPaymentAsPaid(id: string): Promise<TutorPayment | null> {
  return updateTutorPayment(id, {
    status: 'paid',
    paid_at: new Date().toISOString()
  });
}

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
// Re-export schedule functions (source of truth)
// =============================================
// Weekly slots, lessons, reminder settings, and public booking functions
// are now defined exclusively in tutorSchedule.ts to eliminate duplication
export {
  getTutorWeeklySlots,
  createWeeklySlot,
  updateWeeklySlot,
  deleteWeeklySlot,
  toggleSlotAvailability,
  syncWorkHoursToSlots,
  getTutorLessons,
  createLesson,
  createLessonSeries,
  updateLesson,
  deleteLesson,
  cancelLesson,
  getLessonSeriesCount,
  updateLessonSeries,
  cancelLessonSeries,
  completeLessonAndCreatePayment,
  getReminderSettings,
  upsertReminderSettings,
  getCalendarSettings,
  upsertCalendarSettings,
  getAvailabilityExceptions,
  createAvailabilityException,
  deleteAvailabilityException,
  getTutorPublicInfo,
  getAvailableBookingSlots,
  bookLessonSlot
} from './tutorSchedule';

function generateBookingLink(tutorId: string): string {
  return `tutor-${tutorId.substring(0, 8)}`;
}

export async function getBookingLink(): Promise<string | null> {
  let tutor = await getCurrentTutor();
  if (!tutor) return null;

  if (!tutor.booking_link) {
    const { data, error } = await supabase
      .from('tutors')
      .update({ booking_link: generateBookingLink(tutor.id) })
      .eq('id', tutor.id)
      .select()
      .single();

    if (error) {
      console.error('Error creating booking link:', error);
      return null;
    }

    clearTutorCache();
    tutor = data as Tutor;
  }

  return `${window.location.origin}/book/${tutor.booking_link}`;
}
