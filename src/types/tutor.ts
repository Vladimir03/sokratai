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
export type PaymentStatus = 'pending' | 'paid' | 'overdue';

export interface TutorPayment {
  id: string;
  tutor_student_id: string;
  amount: number;
  period: string | null;
  status: PaymentStatus;
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
  status?: PaymentStatus;
  due_date?: string;
}

export interface UpdateTutorPaymentInput {
  amount?: number;
  period?: string;
  status?: PaymentStatus;
  due_date?: string;
  paid_at?: string;
}
