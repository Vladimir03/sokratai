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

// =============================================
// Weekly Slots
// =============================================

/**
 * Get all weekly slots for the current tutor
 */
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

/**
 * Create a new weekly slot
 */
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

/**
 * Update a weekly slot
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
 * Delete a weekly slot
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
 * Sync work hours settings to weekly slots in database
 * This creates hourly slots for each work day based on the tutor's schedule
 */
export async function syncWorkHoursToSlots(
  workDays: number[],
  workDayStart: number,
  workDayEnd: number,
  durationMin: number = 60
): Promise<boolean> {
  const tutor = await getCurrentTutor();
  if (!tutor) return false;

  // Delete all existing weekly slots
  const { error: deleteError } = await supabase
    .from('tutor_weekly_slots')
    .delete()
    .eq('tutor_id', tutor.id);

  if (deleteError) {
    console.error('Error deleting existing slots:', deleteError);
    return false;
  }

  // Generate new slots
  const slotsToInsert: CreateWeeklySlotInput[] = [];

  for (const dayOfWeek of workDays) {
    for (let hour = workDayStart; hour < workDayEnd; hour++) {
      slotsToInsert.push({
        tutor_id: tutor.id,
        day_of_week: dayOfWeek,
        start_time: `${hour.toString().padStart(2, '0')}:00:00`,
        duration_min: durationMin,
        is_available: true
      });
    }
  }

  if (slotsToInsert.length === 0) {
    return true; // No slots to insert
  }

  const { error: insertError } = await supabase
    .from('tutor_weekly_slots')
    .insert(slotsToInsert);

  if (insertError) {
    console.error('Error inserting slots:', insertError);
    return false;
  }

  return true;
}

// =============================================
// Lessons
// =============================================

/**
 * Get lessons for the current tutor within a date range
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
    .order('start_at', { ascending: true });
  
  if (error) {
    console.error('Error fetching lessons:', error);
    return [];
  }
  
  return data as TutorLessonWithStudent[];
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
  external_source?: string;
  external_event_id?: string;
  external_calendar_id?: string;
  external_event_updated_at?: string;
}

/**
 * Create a new lesson
 */
export async function createLesson(input: CreateLessonInput): Promise<TutorLessonWithStudent | null> {
  // Auto-populate tutor_id if not provided
  if (!input.tutor_id) {
    const tutor = await getCurrentTutor();
    if (!tutor) {
      console.error('Cannot create lesson: tutor not found');
      return null;
    }
    input.tutor_id = tutor.id;
  }

  const { data, error } = await supabase
    .from('tutor_lessons')
    .insert({
      ...input,
      source: input.source || 'manual'
    } as any)
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
    .single();
  
  if (error) {
    console.error('Error creating lesson:', error);
    return null;
  }
  
  return data as TutorLessonWithStudent;
}

/**
 * Create a recurring weekly lesson series.
 * Returns the root lesson (first in the series).
 * Max 60 instances per call for safety.
 */
export async function createLessonSeries(
  input: CreateLessonInput,
  repeatUntil: string // ISO date string (inclusive)
): Promise<{ root: TutorLessonWithStudent | null; count: number }> {
  const MAX_INSTANCES = 60;
  const startDate = new Date(input.start_at);
  const untilDate = new Date(repeatUntil);
  untilDate.setHours(23, 59, 59, 999);

  // Resolve tutor_id upfront so all lessons in the series use it
  let tutorId = input.tutor_id;
  if (!tutorId) {
    const tutor = await getCurrentTutor();
    if (!tutor) {
      console.error('Cannot create lesson series: tutor not found');
      return { root: null, count: 0 };
    }
    tutorId = tutor.id;
  }

  // Generate dates: weekly from start_at until repeatUntil (inclusive)
  const dates: Date[] = [];
  const current = new Date(startDate);
  while (current <= untilDate && dates.length < MAX_INSTANCES) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }

  if (dates.length === 0) {
    return { root: null, count: 0 };
  }

  const recurrenceRule = 'weekly';

  // Create root lesson (first in series)
  const rootLesson = await createLesson({
    ...input,
    tutor_id: tutorId,
    start_at: dates[0].toISOString(),
    is_recurring: true,
    recurrence_rule: recurrenceRule,
  });

  if (!rootLesson || dates.length === 1) {
    return { root: rootLesson, count: rootLesson ? 1 : 0 };
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

/**
 * Update a lesson
 */
export async function updateLesson(
  id: string, 
  input: UpdateLessonInput
): Promise<TutorLessonWithStudent | null> {
  const updateData: Record<string, unknown> = { ...input };
  
  if (input.status === 'cancelled') {
    updateData.cancelled_at = new Date().toISOString();
  }
  
  const { data, error } = await supabase
    .from('tutor_lessons')
    .update(updateData)
    .eq('id', id)
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
    .single();
  
  if (error) {
    console.error('Error updating lesson:', error);
    return null;
  }
  
  return data as TutorLessonWithStudent;
}

/**
 * Delete a lesson
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
// Series Operations (bulk update/cancel)
// =============================================

/**
 * Determine root lesson id for a series.
 * If lesson has parent_lesson_id, that's the root; otherwise lesson itself is root.
 */
function getSeriesRootId(lesson: { id: string; parent_lesson_id?: string | null }): string {
  return lesson.parent_lesson_id || lesson.id;
}

/**
 * Update all lessons in a series (by root id).
 * Fields like lesson_type, subject, notes, student assignment are applied to all.
 * Time changes are NOT propagated (each lesson keeps its own time).
 */
export async function updateLessonSeries(
  lesson: { id: string; parent_lesson_id?: string | null },
  input: {
    lesson_type?: LessonType;
    subject?: string;
    notes?: string;
    student_id?: string;
    tutor_student_id?: string;
  }
): Promise<boolean> {
  const rootId = getSeriesRootId(lesson);

  const { error } = await supabase
    .from('tutor_lessons')
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .or(`id.eq.${rootId},parent_lesson_id.eq.${rootId}`);

  if (error) {
    console.error('Error updating lesson series:', error);
    return false;
  }

  return true;
}

/**
 * Cancel all booked lessons in a series.
 */
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

// =============================================
// Reminder Settings
// =============================================

/**
 * Get reminder settings for the current tutor
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
    if (error.code === 'PGRST116') {
      // No settings found, return null (will use defaults)
      return null;
    }
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

/**
 * Update or create reminder settings
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

/**
 * Get public tutor info by booking link
 */
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

/**
 * Get available booking slots for a tutor
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
    console.error('Error fetching available slots:', error);
    return [];
  }
  
  return data as BookingSlot[];
}

/**
 * Book a lesson slot
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
    console.error('Error booking lesson slot:', error);
    throw new Error(error.message);
  }
  
  return data as string;
}

// =============================================
// Google Calendar Integration (client helpers)
// =============================================

export async function getGoogleCalendarStatus(): Promise<{
  connected: boolean;
  google_email?: string;
  last_import_at?: string | null;
} | null> {
  try {
    const response = await supabase.functions.invoke('google-calendar-oauth', {
      body: { action: 'status' }
    });
    if (response.error) throw response.error;
    return response.data;
  } catch (err) {
    console.error('Error checking Google Calendar status:', err);
    return null;
  }
}

export async function getGoogleCalendarAuthUrl(): Promise<{ url: string | null; error?: string }> {
  try {
    const response = await supabase.functions.invoke('google-calendar-oauth', {
      body: { action: 'get_auth_url' }
    });
    if (response.error) {
      console.error('Google auth URL edge function error:', response.error);
      const msg = typeof response.error === 'object' && response.error !== null
        ? (response.error as any).message || JSON.stringify(response.error)
        : String(response.error);
      return { url: null, error: msg };
    }
    return { url: response.data?.url || null };
  } catch (err) {
    console.error('Error getting Google auth URL:', err);
    return { url: null, error: err instanceof Error ? err.message : 'Неизвестная ошибка' };
  }
}

export async function disconnectGoogleCalendar(): Promise<boolean> {
  try {
    const response = await supabase.functions.invoke('google-calendar-oauth', {
      body: { action: 'disconnect' }
    });
    if (response.error) throw response.error;
    return true;
  } catch (err) {
    console.error('Error disconnecting Google Calendar:', err);
    return false;
  }
}

export async function importGoogleCalendarEvents(
  startDate: string,
  endDate: string
): Promise<{ imported: number; updated: number; cancelled: number; skipped: number } | null> {
  try {
    const response = await supabase.functions.invoke('google-calendar-import', {
      body: { start_date: startDate, end_date: endDate }
    });
    if (response.error) throw response.error;
    return response.data;
  } catch (err) {
    console.error('Error importing Google Calendar events:', err);
    return null;
  }
}
