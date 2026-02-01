export interface Tutor {
  id: string;
  user_id: string;
  name: string;
  telegram_id: string | null;
  telegram_username: string | null;
  booking_link: string | null;
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
