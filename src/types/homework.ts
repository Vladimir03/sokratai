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
  { id: 'french', name: 'Французский язык', emoji: '🇫🇷', category: 'humanities' },

  // 🧬 Естественные
  { id: 'chemistry', name: 'Химия', emoji: '🧪', category: 'natural' },
  { id: 'biology', name: 'Биология', emoji: '🧬', category: 'natural' },
  { id: 'geography', name: 'География', emoji: '🌍', category: 'natural' },

  // Другое
  { id: 'other', name: 'Другое', emoji: '📝', category: 'other' }
];

/** Quick id→name lookup derived from SUBJECTS */
export const SUBJECT_NAME_MAP: Record<string, string> = Object.fromEntries(
  SUBJECTS.map((s) => [s.id, s.name]),
);

/**
 * Legacy subject ids that were used before the subject list was split
 * (e.g. general "math" split into algebra/geometry). Map them to a sensible
 * Russian label so existing assignments don't render raw english ids in UI.
 */
const LEGACY_SUBJECT_LABELS: Record<string, string> = {
  math: 'Математика',
  rus: 'Русский язык',
};

/** Get human-readable Russian subject name; falls back to raw id */
export function getSubjectLabel(id: string): string {
  return SUBJECT_NAME_MAP[id] ?? LEGACY_SUBJECT_LABELS[id] ?? id;
}

export type StudentAssignmentStatus = 'draft' | 'active' | 'closed';

export interface StudentHomeworkAssignment {
  id: string;
  title: string;
  subject: string;
  topic: string | null;
  description: string | null;
  deadline: string | null;
  status: StudentAssignmentStatus;
  latest_submission_status: string | null;
  created_at: string;
}

export interface StudentHomeworkTask {
  id: string;
  assignment_id: string;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  max_score: number;
  check_format: 'short_answer' | 'detailed_solution';
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

export interface StudentHomeworkAssignmentDetails {
  id: string;
  title: string;
  subject: string;
  exam_type?: 'ege' | 'oge';
  topic: string | null;
  description: string | null;
  deadline: string | null;
  status: StudentAssignmentStatus;
  disable_ai_bootstrap?: boolean;
  created_at: string;
  updated_at: string;
  tasks: StudentHomeworkTask[];
  materials: StudentHomeworkMaterial[];
}

// ─── Guided Homework Chat types ─────────────────────────────────────────────

export type ThreadStatus = 'active' | 'completed' | 'abandoned';
export type TaskStateStatus = 'locked' | 'active' | 'completed' | 'skipped';
export type GuidedMessageKind = 'answer' | 'hint_request' | 'question' | 'bootstrap' | 'ai_reply' | 'system' | 'check_result' | 'hint_reply' | 'tutor_message' | 'tutor_note';
export type MessageDeliveryStatus = 'sending' | 'sent' | 'failed';
export type GuidedHomeworkUiStatus =
  | 'awaiting_answer'
  | 'streaming_ai'
  | 'checking_answer'
  | 'requesting_hint'
  | 'send_error';

export interface HomeworkThread {
  id: string;
  student_assignment_id: string;
  status: ThreadStatus;
  current_task_order: number;
  created_at: string;
  updated_at: string;
  last_student_message_at?: string | null;
  last_tutor_message_at?: string | null;
  homework_tutor_thread_messages: HomeworkThreadMessage[];
  homework_tutor_task_states: HomeworkTaskState[];
}

export interface HomeworkThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tutor';
  content: string;
  image_url: string | null;
  task_order: number | null;
  created_at: string;
  message_kind?: GuidedMessageKind;
  message_delivery_status?: MessageDeliveryStatus;
  author_user_id?: string | null;
  visible_to_student?: boolean;
}

export interface HomeworkTaskState {
  id: string;
  task_id: string;
  task_order: number;
  status: TaskStateStatus;
  attempts: number;
  best_score: number | null;
  // Phase 3 scoring fields
  available_score?: number | null;
  earned_score?: number | null;
  wrong_answer_count?: number;
  hint_count?: number;
}

// Phase 3: API response types

export interface CheckAnswerResponse {
  verdict: 'CORRECT' | 'INCORRECT' | 'ON_TRACK' | 'CHECK_FAILED';
  feedback: string;
  earned_score: number | null;
  available_score: number;
  max_score: number;
  wrong_answer_count: number;
  hint_count: number;
  task_completed: boolean;
  next_task_order: number | null;
  thread_completed: boolean;
  total_tasks: number;
  thread: HomeworkThread;
}

export interface RequestHintResponse {
  hint: string;
  available_score: number;
  max_score: number;
  hint_count: number;
  wrong_answer_count: number;
  thread: HomeworkThread;
}
