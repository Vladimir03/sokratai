import type {
  GradingCriterion,
  HomeworkSubject,
  ModernHomeworkSubject,
  MaterialType,
} from '@/lib/tutorHomeworkApi';
import { SUBJECTS as CANONICAL_SUBJECTS } from '@/types/homework';

// Re-export so constructor components can import the criterion type from here.
export type { GradingCriterion };

// ─── Constants ───────────────────────────────────────────────────────────────

export const SUBJECTS: { value: ModernHomeworkSubject; label: string }[] =
  CANONICAL_SUBJECTS.map((subject) => ({
    value: subject.id as ModernHomeworkSubject,
    label: subject.name,
  }));

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export const IMAGE_REQUIREMENTS_HINT = 'Форматы: JPG, PNG, WEBP, GIF. Размер до 10 МБ.';

// ─── Submit phase ────────────────────────────────────────────────────────────

export type SubmitPhase = 'idle' | 'creating' | 'saving' | 'adding_materials' | 'assigning' | 'notifying' | 'done';

// ─── Inline success state (Phase 4) ──────────────────────────────────────────

export interface StudentDeliveryStatus {
  /** Student profile ID (= student_id in tutor_students) */
  studentId: string;
  name: string;
  /** @deprecated kept for backward compat; prefer checking notified/deliveryFailed directly */
  hasTelegram: boolean;
  /** true = notification delivered via any channel (push/telegram/email) */
  notified: boolean;
  /** true = notification attempted but all channels failed */
  deliveryFailed: boolean;
  /** true = student has no delivery channels at all */
  noChannels: boolean;
}

export interface SubmitSuccessResult {
  assignmentId: string;
  title: string;
  taskCount: number;
  assignedCount: number;
  /** Filled when assignMode === 'group' */
  groupName?: string;
  studentStatuses: StudentDeliveryStatus[];
  inviteWebLink: string;
  studentLoginLink: string;
}

// ─── Draft task type ─────────────────────────────────────────────────────────

export interface DraftTask {
  /** Existing DB task id (set when editing an existing assignment) */
  id?: string;
  localId: string;
  task_text: string;
  /**
   * Storage refs для фото условия задачи.
   * Dual-format — single storage ref ИЛИ JSON-array через `@/lib/attachmentRefs`.
   * Используй `parseAttachmentUrls` / `serializeAttachmentUrls` для чтения/записи.
   * Лимит — `MAX_TASK_IMAGES` (5).
   */
  task_image_path: string | null;
  task_image_name: string | null;
  task_image_preview_url: string | null;
  task_image_used_fallback: boolean;
  correct_answer: string;
  rubric_text: string;
  /**
   * Storage refs для фото критериев проверки (рубрики).
   * Dual-format — single storage ref ИЛИ JSON-array через `@/lib/attachmentRefs`.
   * Лимит — `MAX_RUBRIC_IMAGES` (3). Видимость: только репетитор.
   */
  rubric_image_paths: string | null;
  /**
   * Эталонное решение репетитора (текст). Единое поле "Решение для AI":
   * AI видит его на путях check/hint/chat как референс для Сократовского ведения.
   * НИКОГДА не отдаётся ученику. Может быть заполнено автоматически при импорте из KB.
   */
  solution_text: string;
  /**
   * Фото эталонного решения.
   * Dual-format — single storage ref ИЛИ JSON-array через `@/lib/attachmentRefs`.
   * Лимит — `MAX_SOLUTION_IMAGES` (5). Видимость: только репетитор + AI-промпт.
   */
  solution_image_paths: string | null;
  max_score: number;
  uploading: boolean;
  /** KB provenance — set when task added from Knowledge Base picker */
  kb_task_id?: string | null;
  kb_source?: 'socrat' | 'my';
  kb_snapshot_text?: string;
  kb_snapshot_answer?: string | null;
  kb_snapshot_solution?: string | null;
  kb_snapshot_edited?: boolean;
  /** KB solution images. Dual-format storage refs; UI-only projection, not saved to homework_tutor_tasks. */
  kb_snapshot_solution_image_refs?: string | null;
  /** Tutor-only KB source label; UI-only projection, not saved to homework_tutor_tasks. */
  kb_source_label?: string | null;
  /** Original KB attachment URL (storage:// or https://). Not usable as task_image_path directly. */
  kb_attachment_url?: string | null;
  check_format: 'short_answer' | 'detailed_solution';
  /**
   * Тип задания. undefined / numeric / extended / proof — «письменный» режим
   * (бэк выводит task_kind из check_format). 'speaking' — устный монолог
   * (voice-speaking-mvp, за feature-флагом тутора): ученик записывает голос,
   * AI распознаёт речь и оценивает по критериям. Только 'speaking' гоняем явно
   * через write-path (§0); остальные значения backend derive'ит из check_format.
   */
  task_kind?: 'numeric' | 'extended' | 'proof' | 'speaking';
  /**
   * Явный уровень CEFR (A2/B1/B2/C1) для языковых задач (CEFR-level fix 2026-05-29).
   * undefined / null → авто-детект из текста (как раньше). Когда задан — форсит
   * уровень рубрики на бэкенде (resolveSubjectRubric). Селектор «Уровень»
   * показывается только для foreign-language subjects.
   */
  cefr_level?: 'A2' | 'B1' | 'B2' | 'C1' | null;
  /**
   * № КИМ задачи (Phase 2, 2026-06-21 → редактируем с unified-task-model F2,
   * 2026-07-05: каскад «Тип → № КИМ → Тема» прямо в карточке конструктора —
   * запрос Егора). Переносится в `homework_tutor_tasks.kim_number` → AI грейдит
   * по критериям ФИПИ этого номера (физика Часть 2 → flowchart-грейдинг).
   */
  kim_number?: number | null;
  /**
   * unified-task-model F2 (2026-07-05) — классификация каскада конструктора.
   * На снимок ДЗ едет только kim_number; остальное — в зеркало Базы
   * (авто-создание kb_task при kb_task_id === undefined → payload null).
   */
  exam?: '' | 'ege' | 'oge' | 'olympiad';
  difficulty?: number | null;
  topic_id?: string | null;
  subtopic_id?: string | null;
  source_label?: string | null;
  /**
   * Fingerprint контента на момент импорта из Базы / загрузки на edit —
   * client-side divergence-детект для «Обновить в Базе» (показывается только
   * при реальном расхождении). Пересчитывается computeTaskContentFingerprint.
   */
  kb_content_fingerprint?: string | null;
  /**
   * Структурные критерии покритериальной AI-проверки (criteria-grading, 2026-06).
   * Любой предмет: репетитор задаёт критерии → AI раскладывает балл по ним →
   * `ai_criteria_json` → таблица «критерий → балл/макс → комментарий» ученику.
   * undefined/null → нет покритериального разбора (встроенный пресет или общий
   * грейдинг). Редактор показывается только для развёрнутых задач (non-numeric).
   */
  grading_criteria_json?: GradingCriterion[] | null;
}

// ─── Draft material type ──────────────────────────────────────────────────────

export interface DraftMaterial {
  /** Existing DB material id (set when editing an existing assignment) */
  id?: string;
  localId: string;
  type: MaterialType;
  title: string;
  file: File | null;
  url: string;
  uploading: boolean;
}

// ─── Meta state ──────────────────────────────────────────────────────────────

export interface MetaState {
  title: string;
  subject: HomeworkSubject | "";
  deadline: string;
  disable_ai_bootstrap?: boolean;
  exam_type?: 'ege' | 'oge';
  /**
   * Assignment-level CEFR level (Phase 11, 2026-05-31). Каскадится во все задачи
   * при сохранении (homework_tutor_tasks.cefr_level). Обязателен для языковых
   * subjects (french/english/spanish) с письменными/устными задачами — иначе AI
   * молча грейдит по B1 (баг Эмилии). null → не задан (валидация заблокирует save).
   */
  cefr_level?: 'A2' | 'B1' | 'B2' | 'C1' | null;
  /**
   * Язык AI-feedback (Phase 11, 2026-05-31), homework_tutor_assignments.feedback_language.
   * 'auto' (default) — A2 русский / B1+ изучаемый; 'russian' / 'target' — override.
   * Только для языковых subjects. null → 'auto'.
   */
  feedback_language?: 'auto' | 'russian' | 'target';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safari 15.0–15.3 safe UUID generator (crypto.randomUUID requires 15.4+) */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const randomHex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${randomHex()}${randomHex()}-${randomHex()}-4${randomHex().slice(1)}-${((8 + Math.floor(Math.random() * 4)).toString(16))}${randomHex().slice(1)}-${randomHex()}${randomHex()}${randomHex()}`;
}

export function createEmptyTask(): DraftTask {
  return {
    localId: generateUUID(),
    task_text: '',
    task_image_path: null,
    task_image_name: null,
    task_image_preview_url: null,
    task_image_used_fallback: false,
    correct_answer: '',
    rubric_text: '',
    rubric_image_paths: null,
    solution_text: '',
    solution_image_paths: null,
    max_score: 1,
    uploading: false,
    check_format: 'short_answer',
  };
}

/**
 * Criteria-grading (2026-06): per-criterion editor + write are gated to
 * развёрнутые (non-numeric) tasks. SINGLE SOURCE OF TRUTH — used by both
 * HWTasksSection (editor visibility) AND TutorHomeworkCreate (write gating),
 * so criteria authored on an extended task and then format-flipped-back to
 * «Краткий ответ» are never written/graded (review fix P2). Mirrors the gate
 * exactly so the two sides can't drift.
 */
export function isCriteriaEligibleTask(t: {
  check_format?: string | null;
  task_kind?: string | null;
}): boolean {
  return (
    t.check_format === 'detailed_solution' ||
    t.task_kind === 'extended' ||
    t.task_kind === 'proof' ||
    t.task_kind === 'speaking'
  );
}

export function createEmptyMaterial(): DraftMaterial {
  return {
    localId: generateUUID(),
    type: 'link',
    title: '',
    file: null,
    url: '',
    uploading: false,
  };
}

export function revokeObjectUrl(url: string | null | undefined) {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

/**
 * unified-task-model F2 (2026-07-05): каноническая проекция контента задачи
 * для client-side divergence-детекта «Обновить в Базе». Считается при импорте
 * из Базы (kbTaskToDraftTask) / edit-prefill и сравнивается с живым драфтом —
 * кнопка показывается только при реальном расхождении. НЕ криптография —
 * обычный JSON-стринг (стабильный порядок ключей).
 */
export function computeTaskContentFingerprint(t: {
  task_text?: string | null;
  correct_answer?: string | null;
  task_image_path?: string | null;
  solution_text?: string | null;
  solution_image_paths?: string | null;
  rubric_text?: string | null;
  rubric_image_paths?: string | null;
  check_format?: string | null;
  kim_number?: number | null;
  max_score?: number | null;
  grading_criteria_json?: GradingCriterion[] | null;
}): string {
  return JSON.stringify([
    (t.task_text ?? '').trim(),
    (t.correct_answer ?? '').trim(),
    t.task_image_path ?? null,
    (t.solution_text ?? '').trim(),
    t.solution_image_paths ?? null,
    (t.rubric_text ?? '').trim(),
    t.rubric_image_paths ?? null,
    t.check_format ?? null,
    t.kim_number ?? null,
    t.max_score ?? null,
    t.grading_criteria_json ?? null,
  ]);
}
