import { supabase } from '@/lib/supabaseClient';
import { getCurrentTutor } from '@/lib/tutors';
import type { 
  TutorWeeklySlot, 
  TutorLessonWithStudent, 
  TutorReminderSettings,
  TutorPublicInfo,
  BookingSlot
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
  tutor_id: string;
  tutor_student_id?: string;
  student_id?: string;
  start_at: string;
  duration_min?: number;
  notes?: string;
  source?: 'manual' | 'self_booking';
}

/**
 * Create a new lesson
 */
export async function createLesson(input: CreateLessonInput): Promise<TutorLessonWithStudent | null> {
  const { data, error } = await supabase
    .from('tutor_lessons')
    .insert({
      ...input,
      source: input.source || 'manual'
    })
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

interface UpdateLessonInput {
  status?: 'booked' | 'completed' | 'cancelled';
  notes?: string;
  cancelled_by?: 'tutor' | 'student';
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
