export interface Tutor {
  id: string;
  user_id: string;
  name: string;
  telegram_id: string | null;
  telegram_username: string | null;
  booking_link: string | null;
  invite_code: string | null;
  avatar_url: string | null;
  subjects: string[];
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export interface TutorStudent {
  id: string;
  tutor_id: string;
  student_id: string;
  target_score: number | null;
  start_score: number | null;
  current_score: number | null;
  exam_type: 'ege' | 'oge' | null;
  subject: string | null;
  notes: string | null;
  status: 'active' | 'paused' | 'completed';
  paid_until: string | null;
  last_activity_at: string | null;
  parent_contact: string | null;
  last_lesson_at: string | null;
  created_at: string;
  updated_at: string;
}

// С данными из profiles
export interface TutorStudentWithProfile extends TutorStudent {
  profiles: {
    id: string;
    username: string;
    telegram_username: string | null;
    telegram_user_id: number | null;
    grade: number | null;
    learning_goal?: string | null;
  };
}

// Для создания связи
export interface CreateTutorStudentInput {
  student_id: string;
  target_score?: number;
  start_score?: number;
  exam_type?: 'ege' | 'oge';
  subject?: string;
  notes?: string;
}

export interface ManualAddTutorStudentInput {
  name: string;
  telegram_username: string;
  learning_goal: string;
  grade?: number;
  exam_type?: 'ege' | 'oge';
  subject?: string;
  start_score?: number;
  target_score?: number;
  notes?: string;
  parent_contact?: string;
}

export interface ManualAddTutorStudentResponse {
  tutor_student_id: string;
  student_id: string;
  created: boolean;
}

export interface UpdateTutorStudentProfileInput {
  tutor_student_id: string;
  name: string;
  telegram_username: string;
  learning_goal: string;
  grade?: number;
  exam_type?: 'ege' | 'oge';
  subject?: string;
  start_score?: number;
  target_score?: number;
  parent_contact?: string;
  notes?: string;
}

export interface UpdateTutorStudentProfileResponse {
  success: boolean;
}

// Для обновления
export interface UpdateTutorStudentInput {
  target_score?: number;
  current_score?: number;
  notes?: string;
  status?: 'active' | 'paused' | 'completed';
  parent_contact?: string;
  last_lesson_at?: string;
}

// =============================================
// Пробники (Mock Exams)
// =============================================
export interface MockExam {
  id: string;
  tutor_student_id: string;
  date: string;
  score: number;
  max_score: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMockExamInput {
  tutor_student_id: string;
  date: string;
  score: number;
  max_score?: number;
  notes?: string;
}

export interface UpdateMockExamInput {
  date?: string;
  score?: number;
  max_score?: number;
  notes?: string;
}

// =============================================
// Чаты ученика (для репетитора)
// =============================================
export interface StudentChat {
  id: string;
  user_id: string;
  chat_type: string;
  title: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface StudentChatMessage {
  id: string;
  chat_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// Для обновления профиля репетитора
export interface UpdateTutorInput {
  name?: string;
  telegram_username?: string;
  avatar_url?: string;
  subjects?: string[];
  bio?: string;
}

// =============================================
// Оплаты (Tutor Payments A3)
// =============================================
export type TutorPaymentStatus = 'pending' | 'paid' | 'overdue';

export interface TutorPayment {
  id: string;
  tutor_student_id: string;
  amount: number;
  period: string | null;
  status: TutorPaymentStatus;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

// С данными об ученике (через tutor_students + profiles)
export interface TutorPaymentWithStudent extends TutorPayment {
  tutor_students: {
    id: string;
    student_id: string;
    parent_contact: string | null;
    profiles: {
      id: string;
      username: string;
      telegram_username: string | null;
    };
  };
}

export interface CreateTutorPaymentInput {
  tutor_student_id: string;
  amount: number;
  period?: string;
  status?: TutorPaymentStatus;
  due_date?: string;
}

export interface UpdateTutorPaymentInput {
  amount?: number;
  period?: string;
  status?: TutorPaymentStatus;
  due_date?: string;
  paid_at?: string;
}

// =============================================
// A1: Календарь (Weekly Slots & Lessons)
// =============================================

export interface TutorWeeklySlot {
  id: string;
  tutor_id: string;
  day_of_week: number; // 0=Mon, 6=Sun
  start_time: string; // HH:MM:SS
  duration_min: number;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateWeeklySlotInput {
  day_of_week: number;
  start_time: string;
  duration_min?: number;
  is_available?: boolean;
}

export interface UpdateWeeklySlotInput {
  is_available?: boolean;
  duration_min?: number;
}

export type LessonStatus = 'booked' | 'completed' | 'cancelled';
export type LessonSource = 'manual' | 'self_booking';
export type LessonPaymentStatus = 'unpaid' | 'paid' | 'pending' | 'paid_earlier';
export type LessonPaymentMethod = 'cash' | 'card' | 'transfer' | 'other';

export interface TutorLesson {
  id: string;
  tutor_id: string;
  tutor_student_id: string | null;
  student_id: string | null;
  start_at: string; // ISO timestamp
  duration_min: number;
  status: LessonStatus;
  source: LessonSource;
  notes: string | null;
  cancelled_at: string | null;
  cancelled_by: 'tutor' | 'student' | null;
  // Payment fields
  payment_status?: LessonPaymentStatus;
  payment_amount?: number | null;
  payment_method?: LessonPaymentMethod | null;
  paid_at?: string | null;
  payment_reminder_sent?: boolean;
  created_at: string;
  updated_at: string;
}

// Lesson with student info for display
export interface TutorLessonWithStudent extends TutorLesson {
  tutor_students: {
    id: string;
    student_id: string;
    profiles: {
      id: string;
      username: string;
      telegram_username: string | null;
    };
  } | null;
  profiles: {
    id: string;
    username: string;
    telegram_username: string | null;
  } | null;
}

export interface CreateLessonInput {
  tutor_student_id?: string;
  student_id?: string;
  start_at: string;
  duration_min?: number;
  notes?: string;
}

export interface UpdateLessonInput {
  status?: LessonStatus;
  notes?: string;
  cancelled_by?: 'tutor' | 'student';
}

// =============================================
// A2: Напоминания (Reminder Settings)
// =============================================

export interface TutorReminderSettings {
  id: string;
  tutor_id: string;
  enabled: boolean;
  remind_before_minutes: number[]; // e.g. [1440, 60] = 24h and 1h
  template_student: string;
  template_tutor: string;
  created_at: string;
  updated_at: string;
}

export interface UpdateReminderSettingsInput {
  enabled?: boolean;
  remind_before_minutes?: number[];
  template_student?: string;
  template_tutor?: string;
}

// =============================================
// Calendar Settings
// =============================================

export interface TutorCalendarSettings {
  id: string;
  tutor_id: string;
  default_duration: number;
  buffer_minutes: number;
  min_notice_hours: number;
  max_advance_days: number;
  auto_confirm: boolean;
  allow_student_cancel: boolean;
  cancel_notice_hours: number;
  timezone: string;
  // Payment reminder settings
  payment_reminder_enabled: boolean;
  payment_reminder_delay_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface UpdateCalendarSettingsInput {
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

// =============================================
// Availability Exceptions (отпуск, болезнь)
// =============================================

export interface TutorAvailabilityException {
  id: string;
  tutor_id: string;
  exception_date: string; // YYYY-MM-DD
  reason: string | null;
  created_at: string;
}

export interface CreateAvailabilityExceptionInput {
  exception_date: string;
  reason?: string;
}

// =============================================
// Public Booking (Calendly-like)
// =============================================

export interface BookingSlot {
  slot_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM:SS
  duration_min: number;
  is_booked: boolean;
}

export interface TutorPublicInfo {
  id: string;
  name: string;
  avatar_url: string | null;
  subjects: string[];
  bio: string | null;
}

// =============================================
// Feature Onboarding
// =============================================

export type FeatureKey = 'payment_tracking' | 'telegram_notifications';

export interface TutorFeatureOnboarding {
  id: string;
  tutor_id: string;
  feature_key: FeatureKey;
  shown_at: string;
  dismissed_at: string | null;
  completed_at: string | null;
}
