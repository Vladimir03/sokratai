export type Priority = 'urgent' | 'important' | 'later';
export type TaskStatus = 'not_started' | 'in_progress' | 'completed';

export interface HomeworkSet {
  id: string;
  user_id: string;
  subject: string;
  topic: string;
  photo_url?: string;
  deadline?: string;
  priority: Priority;
  created_at: string;
  updated_at: string;
  tasks?: HomeworkTask[];
}

export interface HomeworkTask {
  id: string;
  homework_set_id: string;
  task_number: string;
  condition_text?: string;
  condition_photo_url?: string;
  ai_analysis?: {
    difficulty: string;
    type: string;
    hints: string[];
    solution_steps: string[];
  };
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface HomeworkChatMessage {
  id: string;
  homework_task_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// Предметы сгруппированы по типу: технические (приоритет), гуманитарные, естественные
export const SUBJECTS = [
  // 🔬 Технические (приоритет)
  { id: 'algebra', name: 'Алгебра', emoji: '📈', category: 'technical' },
  { id: 'geometry', name: 'Геометрия', emoji: '📐', category: 'technical' },
  { id: 'physics', name: 'Физика', emoji: '⚛️', category: 'technical' },
  { id: 'informatics', name: 'Информатика', emoji: '💻', category: 'technical' },

  // 📚 Гуманитарные
  { id: 'russian', name: 'Русский язык', emoji: '📖', category: 'humanities' },
  { id: 'literature', name: 'Литература', emoji: '📗', category: 'humanities' },
  { id: 'history', name: 'История', emoji: '📜', category: 'humanities' },
  { id: 'social', name: 'Обществознание', emoji: '⚖️', category: 'humanities' },
  { id: 'english', name: 'Английский язык', emoji: '🇬🇧', category: 'humanities' },

  // 🧬 Естественные
  { id: 'chemistry', name: 'Химия', emoji: '🧪', category: 'natural' },
  { id: 'biology', name: 'Биология', emoji: '🧬', category: 'natural' },
  { id: 'geography', name: 'География', emoji: '🌍', category: 'natural' },

  // Другое
  { id: 'other', name: 'Другое', emoji: '📝', category: 'other' }
];

export const PRIORITY_CONFIG = {
  urgent: { label: 'Срочно', color: 'red', emoji: '🔴' },
  important: { label: 'Важно', color: 'yellow', emoji: '🟡' },
  later: { label: 'Позже', color: 'green', emoji: '🟢' }
};

export type StudentSubmissionStatus = 'in_progress' | 'submitted' | 'ai_checked' | 'tutor_reviewed';
export type StudentAssignmentStatus = 'draft' | 'active' | 'closed';

export interface StudentHomeworkAssignment {
  id: string;
  title: string;
  subject: string;
  topic: string | null;
  description: string | null;
  deadline: string | null;
  status: StudentAssignmentStatus;
  max_attempts: number;
  attempts_used: number;
  latest_submission_status: string | null;
}

export interface StudentHomeworkTask {
  id: string;
  assignment_id: string;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  max_score: number;
}

export interface StudentHomeworkMaterial {
  id: string;
  assignment_id: string;
  type: 'pdf' | 'image' | 'link';
  title: string;
  storage_ref: string | null;
  url: string | null;
  created_at: string;
}

export interface StudentHomeworkSubmissionItem {
  id: string;
  task_id: string;
  student_text: string | null;
  student_image_urls: string[] | null;
  ai_feedback: string | null;
  ai_score: number | null;
  ai_is_correct: boolean | null;
  tutor_comment: string | null;
  tutor_override_correct: boolean | null;
}

export interface StudentHomeworkSubmission {
  id: string;
  assignment_id: string;
  student_id: string;
  attempt_no: number;
  status: StudentSubmissionStatus;
  total_score: number | null;
  total_max_score: number | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  homework_tutor_submission_items: StudentHomeworkSubmissionItem[];
}

export interface StudentHomeworkAssignmentDetails {
  id: string;
  title: string;
  subject: string;
  topic: string | null;
  description: string | null;
  deadline: string | null;
  status: StudentAssignmentStatus;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  tasks: StudentHomeworkTask[];
  materials: StudentHomeworkMaterial[];
  submissions: StudentHomeworkSubmission[];
}
