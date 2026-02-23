import { supabase } from '@/lib/supabaseClient';
import { getCurrentTutor } from '@/lib/tutors';
import type {
  TutorWeeklySlot,
  TutorLessonWithStudent,
  TutorReminderSettings,
  TutorCalendarSettings,
  TutorAvailabilityException,
  TutorPublicInfo,
  BookingSlot,
  LessonType
} from '@/types/tutor';

const LESSON_SELECT = `
  *,
  tutor_students (
    id,
    student_id,
    hourly_rate_cents,
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
`;

// =============================================
// Weekly Slots
// =============================================

export async function getTutorWeeklySlots(): Promise<TutorWeeklySlot[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const { data, error } = await supabase
    .from('tutor_weekly_slots')
    .select('*')
    .eq('tutor_id', tutor.id)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) {
    console.error('Error fetching weekly slots:', error);
    return [];
  }

  return data as TutorWeeklySlot[];
}

interface CreateWeeklySlotInput {
  tutor_id: string;
  day_of_week: number;
  start_time: string;
  duration_min?: number;
  is_available?: boolean;
}

export async function createWeeklySlot(input: CreateWeeklySlotInput): Promise<TutorWeeklySlot | null> {
  const { data, error } = await supabase
    .from('tutor_weekly_slots')
    .insert(input)
    .select()
    .single();

  if (error) {
    console.error('Error creating weekly slot:', error);
    return null;
  }

  return data as TutorWeeklySlot;
}

interface UpdateWeeklySlotInput {
  is_available?: boolean;
  duration_min?: number;
}

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

export async function toggleSlotAvailability(
  id: string,
  isAvailable: boolean
): Promise<TutorWeeklySlot | null> {
  return updateWeeklySlot(id, { is_available: isAvailable });
}

export async function syncWorkHoursToSlots(
  workDays: number[],
  workDayStart: number,
  workDayEnd: number,
  durationMin: number = 60
): Promise<boolean> {
  const tutor = await getCurrentTutor();
  if (!tutor) return false;

  const { error: deleteError } = await supabase
    .from('tutor_weekly_slots')
    .delete()
    .eq('tutor_id', tutor.id);

  if (deleteError) {
    console.error('Error deleting existing slots:', deleteError);
    return false;
  }

  const slots: CreateWeeklySlotInput[] = [];
  for (const day of workDays) {
    for (let hour = workDayStart; hour < workDayEnd; hour++) {
      slots.push({
        tutor_id: tutor.id,
        day_of_week: day,
        start_time: `${hour.toString().padStart(2, '0')}:00:00`,
        duration_min: durationMin,
        is_available: true,
      });
    }
  }

  if (slots.length === 0) return true;

  const { error: insertError } = await supabase
    .from('tutor_weekly_slots')
    .insert(slots);

  if (insertError) {
    console.error('Error inserting slots:', insertError);
    return false;
  }

  return true;
}

// =============================================
// Lessons
// =============================================

export async function getTutorLessons(
  startDate: string,
  endDate: string
): Promise<TutorLessonWithStudent[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const { data, error } = await supabase
    .from('tutor_lessons')
    .select(LESSON_SELECT)
    .eq('tutor_id', tutor.id)
    .gte('start_at', startDate)
    .lt('start_at', endDate)
    .order('start_at', { ascending: true });

  if (error) {
    console.error('Error fetching lessons:', error);
    return [];
  }

  return data as unknown as TutorLessonWithStudent[];
}

interface CreateLessonInput {
  tutor_id?: string;
  tutor_student_id?: string;
  student_id?: string;
  start_at: string;
  duration_min?: number;
  lesson_type?: LessonType;
  subject?: string;
  notes?: string;
  source?: 'manual' | 'self_booking';
  is_recurring?: boolean;
  recurrence_rule?: string;
  parent_lesson_id?: string;
}

export async function createLesson(input: CreateLessonInput): Promise<TutorLessonWithStudent | null> {
  if (!input.tutor_id) {
    const tutor = await getCurrentTutor();
    if (!tutor) {
      console.error('Cannot create lesson: tutor not found');
      return null;
    }
    input.tutor_id = tutor.id;
  }

  // Cast needed: Supabase insert types don't include all optional columns (e.g. parent_lesson_id)
  const { data, error } = await supabase
    .from('tutor_lessons')
    .insert({ ...input, source: input.source || 'manual' } as any)
    .select(LESSON_SELECT)
    .single();

  if (error) {
    console.error('Error creating lesson:', error);
    return null;
  }

  return data as unknown as TutorLessonWithStudent;
}

export async function createLessonSeries(
  input: CreateLessonInput,
  repeatUntil: string // ISO date string (inclusive)
): Promise<{ root: TutorLessonWithStudent | null; count: number }> {
  const MAX_INSTANCES = 60;
  const startDate = new Date(input.start_at);
  const untilDate = new Date(new Date(repeatUntil).setHours(23, 59, 59, 999));

  let tutorId = input.tutor_id;
  if (!tutorId) {
    const tutor = await getCurrentTutor();
    if (!tutor) {
      console.error('Cannot create lesson series: tutor not found');
      return { root: null, count: 0 };
    }
    tutorId = tutor.id;
  }

  // Generate weekly dates immutably (calendar-day addition preserves DST correctness)
  const dates: Date[] = [];
  for (let week = 0; dates.length < MAX_INSTANCES; week++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + week * 7);
    if (d > untilDate) break;
    dates.push(d);
  }

  if (dates.length === 0) {
    return { root: null, count: 0 };
  }

  const recurrenceRule = 'weekly';

  // A single generated date is not an actual series; create a regular lesson.
  if (dates.length === 1) {
    const singleLesson = await createLesson({
      ...input,
      tutor_id: tutorId,
      start_at: dates[0].toISOString(),
      is_recurring: false,
      recurrence_rule: undefined,
      parent_lesson_id: undefined,
    });
    return { root: singleLesson, count: singleLesson ? 1 : 0 };
  }

  // Create root lesson (first in series)
  const rootLesson = await createLesson({
    ...input,
    tutor_id: tutorId,
    start_at: dates[0].toISOString(),
    is_recurring: true,
    recurrence_rule: recurrenceRule,
  });

  if (!rootLesson) {
    return { root: null, count: 0 };
  }

  // Create remaining lessons in batch
  const childInputs = dates.slice(1).map(d => ({
    tutor_id: tutorId,
    tutor_student_id: input.tutor_student_id,
    student_id: input.student_id,
    start_at: d.toISOString(),
    duration_min: input.duration_min,
    lesson_type: input.lesson_type,
    subject: input.subject,
    notes: input.notes,
    source: input.source || 'manual' as const,
    is_recurring: true,
    recurrence_rule: recurrenceRule,
    parent_lesson_id: rootLesson.id,
  }));

  const { error } = await supabase
    .from('tutor_lessons')
    .insert(childInputs);

  if (error) {
    console.error('Error creating lesson series children:', error);
    // Root was created, return partial success
    return { root: rootLesson, count: 1 };
  }

  return { root: rootLesson, count: dates.length };
}

interface UpdateLessonInput {
  status?: 'booked' | 'completed' | 'cancelled';
  start_at?: string;
  lesson_type?: LessonType;
  subject?: string;
  notes?: string;
  cancelled_by?: 'tutor' | 'student';
  student_id?: string;
  tutor_student_id?: string;
}

export async function updateLesson(
  id: string,
  input: UpdateLessonInput
): Promise<TutorLessonWithStudent | null> {
  const updateData: Record<string, unknown> = {
    ...input,
    ...(input.status === 'cancelled' && { cancelled_at: new Date().toISOString() }),
  };

  const { data, error } = await supabase
    .from('tutor_lessons')
    .update(updateData)
    .eq('id', id)
    .select(LESSON_SELECT)
    .single();

  if (error) {
    console.error('Error updating lesson:', error);
    return null;
  }

  return data as unknown as TutorLessonWithStudent;
}

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

export async function cancelLesson(
  id: string,
  cancelledBy: 'tutor' | 'student' = 'tutor'
): Promise<TutorLessonWithStudent | null> {
  return updateLesson(id, {
    status: 'cancelled',
    cancelled_by: cancelledBy
  });
}

// =============================================
// Series Operations (bulk update/cancel)
// =============================================

function getSeriesRootId(lesson: { id: string; parent_lesson_id?: string | null }): string {
  return lesson.parent_lesson_id || lesson.id;
}

export async function getLessonSeriesCount(
  lesson: { id: string; parent_lesson_id?: string | null }
): Promise<number> {
  const rootId = getSeriesRootId(lesson);
  const { count, error } = await supabase
    .from('tutor_lessons')
    .select('id', { count: 'exact', head: true })
    .or(`id.eq.${rootId},parent_lesson_id.eq.${rootId}`);

  if (error) {
    console.error('Error counting lesson series:', error);
    return 0;
  }

  return count ?? 0;
}

export interface UpdateLessonSeriesResult {
  ok: boolean;
  updatedCount: number;
  error?: string;
}

export async function updateLessonSeries(
  lesson: { id: string; parent_lesson_id?: string | null; start_at: string },
  input: {
    lesson_type?: LessonType;
    subject?: string;
    notes?: string;
    student_id?: string;
    tutor_student_id?: string;
    applyTimeShift?: boolean;
    shiftMinutes?: number;
  }
): Promise<UpdateLessonSeriesResult> {
  const rootId = getSeriesRootId(lesson);
  const rpcArgs = {
    _root_lesson_id: rootId,
    _selected_lesson_id: lesson.id,
    _from_start_at: lesson.start_at,
    _apply_time_shift: input.applyTimeShift ?? false,
    _shift_minutes: input.shiftMinutes ?? 0,
    ...(input.lesson_type !== undefined && { _lesson_type: input.lesson_type }),
    ...(input.subject !== undefined && { _subject: input.subject }),
    ...(input.notes !== undefined && { _notes: input.notes }),
    ...(input.student_id !== undefined && { _student_id: input.student_id }),
    ...(input.tutor_student_id !== undefined && { _tutor_student_id: input.tutor_student_id }),
  };

  const { data, error } = await supabase.rpc('update_lesson_series', rpcArgs);

  if (error) {
    console.error('Error updating lesson series:', error);
    return { ok: false, updatedCount: 0, error: error.message };
  }

  const updatedCount = typeof data === 'number' ? data : Number(data ?? 0);
  if (!Number.isFinite(updatedCount) || updatedCount <= 0) {
    return { ok: false, updatedCount: 0, error: 'No lessons were updated' };
  }

  return { ok: true, updatedCount };
}

export async function cancelLessonSeries(
  lesson: { id: string; parent_lesson_id?: string | null }
): Promise<boolean> {
  const rootId = getSeriesRootId(lesson);

  const { error } = await supabase
    .from('tutor_lessons')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: 'tutor',
    })
    .or(`id.eq.${rootId},parent_lesson_id.eq.${rootId}`)
    .eq('status', 'booked');

  if (error) {
    console.error('Error cancelling lesson series:', error);
    return false;
  }

  return true;
}

export async function completeLessonAndCreatePayment(
  lessonId: string,
  amount: number,
  paymentStatus: string = 'pending'
): Promise<boolean> {
  const { data, error } = await supabase.rpc('complete_lesson_and_create_payment', {
    _lesson_id: lessonId,
    _amount: amount,
    _payment_status: paymentStatus,
  });

  if (error) {
    console.error('Error completing lesson and creating payment:', error);
    return false;
  }

  return !!data;
}

// =============================================
// Reminder Settings
// =============================================

export async function getReminderSettings(): Promise<TutorReminderSettings | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) return null;

  const { data, error } = await supabase
    .from('tutor_reminder_settings')
    .select('*')
    .eq('tutor_id', tutor.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error fetching reminder settings:', error);
    return null;
  }

  return data as TutorReminderSettings;
}

interface UpdateReminderSettingsInput {
  enabled?: boolean;
  remind_before_minutes?: number[];
  template_student?: string;
  template_tutor?: string;
}

export async function upsertReminderSettings(
  input: UpdateReminderSettingsInput
): Promise<TutorReminderSettings | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) return null;

  const { data, error } = await supabase
    .from('tutor_reminder_settings')
    .upsert({ tutor_id: tutor.id, ...input })
    .select()
    .single();

  if (error) {
    console.error('Error upserting reminder settings:', error);
    return null;
  }

  return data as TutorReminderSettings;
}

// =============================================
// Calendar Settings
// =============================================

export async function getCalendarSettings(): Promise<TutorCalendarSettings | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) return null;

  const { data, error } = await supabase
    .from('tutor_calendar_settings')
    .select('*')
    .eq('tutor_id', tutor.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error fetching calendar settings:', error);
    return null;
  }

  return data as TutorCalendarSettings;
}

interface UpdateCalendarSettingsInput {
  default_duration?: number;
  buffer_minutes?: number;
  min_notice_hours?: number;
  max_advance_days?: number;
  auto_confirm?: boolean;
  allow_student_cancel?: boolean;
  cancel_notice_hours?: number;
  timezone?: string;
  payment_reminder_enabled?: boolean;
  payment_reminder_delay_minutes?: number;
  payment_details_text?: string | null;
}

export async function upsertCalendarSettings(
  input: UpdateCalendarSettingsInput
): Promise<{ data: TutorCalendarSettings | null; error: string | null }> {
  const tutor = await getCurrentTutor();
  if (!tutor) {
    return { data: null, error: 'Tutor profile not found' };
  }

  const { data, error } = await supabase
    .from('tutor_calendar_settings')
    .upsert({
      tutor_id: tutor.id,
      ...input
    }, {
      onConflict: 'tutor_id'
    })
    .select()
    .single();

  if (error) {
    console.error('Error upserting calendar settings:', error);
    return { data: null, error: error.message };
  }

  return { data: data as TutorCalendarSettings, error: null };
}

// =============================================
// Availability Exceptions
// =============================================

export async function getAvailabilityExceptions(): Promise<TutorAvailabilityException[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const { data, error } = await supabase
    .from('tutor_availability_exceptions')
    .select('*')
    .eq('tutor_id', tutor.id)
    .order('exception_date', { ascending: true });

  if (error) {
    console.error('Error fetching exceptions:', error);
    return [];
  }

  return data as TutorAvailabilityException[];
}

export async function createAvailabilityException(
  exceptionDate: string,
  reason?: string
): Promise<TutorAvailabilityException | null> {
  const tutor = await getCurrentTutor();
  if (!tutor) return null;

  const { data, error } = await supabase
    .from('tutor_availability_exceptions')
    .insert({
      tutor_id: tutor.id,
      exception_date: exceptionDate,
      reason: reason || null
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating exception:', error);
    return null;
  }

  return data as TutorAvailabilityException;
}

export async function deleteAvailabilityException(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('tutor_availability_exceptions')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting exception:', error);
    return false;
  }

  return true;
}

// =============================================
// Public Booking Functions
// =============================================

export async function getTutorPublicInfo(bookingLink: string): Promise<TutorPublicInfo | null> {
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

export async function getAvailableBookingSlots(
  bookingLink: string,
  daysAhead: number = 7
): Promise<BookingSlot[]> {
  const { data, error } = await supabase
    .rpc('get_available_booking_slots', {
      _booking_link: bookingLink,
      _days_ahead: daysAhead,
    });

  if (error) {
    console.error('Error fetching available slots:', error);
    return [];
  }

  return data as BookingSlot[];
}

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
      _duration_min: durationMin,
    });

  if (error) {
    console.error('Error booking lesson slot:', error);
    throw new Error(error.message);
  }

  return data as string;
}

