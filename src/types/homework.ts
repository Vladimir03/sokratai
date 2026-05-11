export interface HomeworkSubjectConfig {
  id: string;
  name: string;
  category: 'technical' | 'humanities' | 'natural' | 'other';
}

// Предметы сгруппированы по типу: технические (приоритет), гуманитарные,
// естественные. Каноничный modern-набор для create/select flows.
export const SUBJECTS: HomeworkSubjectConfig[] = [
  // Технические (приоритет)
  { id: 'maths', name: 'Математика', category: 'technical' },
  { id: 'physics', name: 'Физика', category: 'technical' },
  { id: 'informatics', name: 'Информатика', category: 'technical' },

  // Гуманитарные
  { id: 'russian', name: 'Русский язык', category: 'humanities' },
  { id: 'literature', name: 'Литература', category: 'humanities' },
  { id: 'history', name: 'История', category: 'humanities' },
  { id: 'social', name: 'Обществознание', category: 'humanities' },
  { id: 'english', name: 'Английский язык', category: 'humanities' },
  { id: 'french', name: 'Французский язык', category: 'humanities' },
  { id: 'spanish', name: 'Испанский язык', category: 'humanities' },

  // Естественные
  { id: 'chemistry', name: 'Химия', category: 'natural' },
  { id: 'biology', name: 'Биология', category: 'natural' },
  { id: 'geography', name: 'География', category: 'natural' },

  // Другое
  { id: 'other', name: 'Другое', category: 'other' },
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
  cs: 'Информатика',
  algebra: 'Алгебра',
  geometry: 'Геометрия',
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
  /**
   * Phase 1 student homework problem screen task type. Drives SubmitSheet UI:
   *   - `numeric`   — numeric input only (photos ignored)
   *   - `extended`  — numeric + photo[]≥1 required (default if undefined)
   *   - `proof`     — photo[]≥1 only (numeric ignored)
   * Optional for backward compatibility with code that doesn't read this field.
   * Spec: docs/delivery/features/student-homework-problem-screen/spec.md §5.
   */
  task_kind?: 'numeric' | 'extended' | 'proof';
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
  /**
   * Resolved student display name for AI system prompts.
   * Priority: tutor_students.display_name → profiles.username (non-auto-generated) → null.
   * Null means AI uses neutral/generic forms.
   */
  studentDisplayName?: string | null;
}

// ─── Guided Homework Chat types ─────────────────────────────────────────────

export type ThreadStatus = 'active' | 'completed' | 'abandoned';
export type TaskStateStatus = 'locked' | 'active' | 'completed' | 'skipped';
export type GuidedMessageKind =
  | 'answer'
  | 'hint_request'
  | 'question'
  | 'bootstrap'
  | 'ai_reply'
  | 'system'
  | 'check_result'
  | 'hint_reply'
  | 'tutor_message'
  | 'tutor_note'
  /**
   * Phase 1 student homework problem screen single-shot submission. Backend
   * stores it with `submission_payload` JSONB — see migration
   * `20260509120100_add_submission_payload_to_thread_messages.sql` (extended
   * CHECK constraint) + rule
   * `.claude/rules/40-homework-system.md` § «Student Homework Problem Screen
   * — single-task surface + submission contract» for the structured contract.
   */
  | 'submission';

/**
 * Structured payload for `message_kind='submission'` rows. Stored in
 * `homework_tutor_thread_messages.submission_payload` JSONB. **Strictly**
 * structured — никаких raw user-input полей, которые render'ятся как HTML
 * (anti-leak invariant из rule §40).
 */
export interface HomeworkSubmissionPayload {
  /** Canonical "1.4" or "1,4" — backend normalises locale-specific commas. */
  numeric: string;
  /** `storage://...` refs after upload via `uploadStudentThreadImage`. */
  photos: string[];
  /** Optional reasoning. Empty string is acceptable. */
  text: string;
  /** Phase 2 voice recorder hook. Phase 1 always null/undefined. */
  voice_ref?: string | null;
}
export type MessageDeliveryStatus = 'sending' | 'sent' | 'failed';
export type TutorProfileGender = 'male' | 'female';
export type GuidedHomeworkUiStatus =
  | 'awaiting_answer'
  | 'streaming_ai'
  | 'checking_answer'
  | 'requesting_hint'
  | 'send_error';

export interface HomeworkTutorProfile {
  display_name: string;
  avatar_url: string | null;
  gender: TutorProfileGender | null;
}

export interface HomeworkThread {
  id: string;
  student_assignment_id: string;
  status: ThreadStatus;
  current_task_order: number;
  current_task_id?: string | null;
  created_at: string;
  updated_at: string;
  last_student_message_at?: string | null;
  last_tutor_message_at?: string | null;
  homework_tutor_thread_messages: HomeworkThreadMessage[];
  homework_tutor_task_states: HomeworkTaskState[];
  tutor_profile?: HomeworkTutorProfile | null;
}

export interface HomeworkThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tutor';
  content: string;
  image_url: string | null;
  task_order: number | null;
  task_id?: string | null;
  created_at: string;
  message_kind?: GuidedMessageKind;
  message_delivery_status?: MessageDeliveryStatus;
  author_user_id?: string | null;
  visible_to_student?: boolean;
  /**
   * Populated only for `message_kind='submission'` rows. Echoed back through
   * the canonical `THREAD_SELECT` server-side. `null`/`undefined` for all
   * other message kinds. Anti-leak: structured object only — see
   * `HomeworkSubmissionPayload`.
   */
  submission_payload?: HomeworkSubmissionPayload | null;
}

export interface HomeworkTaskState {
  id: string;
  task_id: string;
  /**
   * Preview-QA #11 (2026-05-11) hotfix: `task_order` НЕ существует
   * в `homework_tutor_task_states` DB schema. Поле было ошибочно
   * объявлено как required во frontend type, что давало undefined в
   * runtime (раньше backend silently dropped). Phase 1.5 codex fix
   * #2 пытался добавить task_order в THREAD_SELECT, но PostgREST
   * вернул 500 → student/tutor stuck loading. Откат: type теперь
   * optional, frontend резолвит order_num через
   * `assignmentDetails.tasks[task_id].order_num` lookup.
   */
  task_order?: number;
  status: TaskStateStatus;
  attempts: number;
  best_score: number | null;
  // Phase 3 scoring fields
  available_score?: number | null;
  earned_score?: number | null;
  wrong_answer_count?: number;
  hint_count?: number;
  /**
   * AI's raw evaluated score (NOT degraded by hints/wrong attempts).
   * `final_score = COALESCE(tutor_score_override, earned_score, ai_score)`.
   * Surfaced to both tutor (EditScoreDialog) and student (dual-score block
   * in completed view) — student sees both AI and tutor values when override
   * is set so trust in grading remains transparent.
   */
  ai_score?: number | null;
  /**
   * AI's commentary about its own score. **Tutor-only** — server strips this
   * field from student responses via `stripStudentSensitiveTaskStateFields`.
   * Used by `EditScoreDialog` to show AI's reasoning when the tutor decides
   * whether to override. Never render this on student-facing surfaces.
   */
  ai_score_comment?: string | null;
  /**
   * Tutor's manual override (single source of truth for the displayed final
   * score when present). null = no override. Visible to student.
   */
  tutor_score_override?: number | null;
  /**
   * Public comment from the tutor explaining the override. Visible to student
   * — never put internal tutor notes here, they belong in `tutor_note` messages.
   */
  tutor_score_override_comment?: string | null;
  /** ISO timestamp when the override was last written. Visible to student. */
  tutor_score_override_at?: string | null;
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
  next_task_id?: string | null;
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
