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
}

// Для обновления профиля репетитора
export interface UpdateTutorInput {
  name?: string;
  telegram_username?: string;
  avatar_url?: string;
  subjects?: string[];
  bio?: string;
}
