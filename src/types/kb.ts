// =============================================
// Knowledge Base Types
// =============================================

// unified-task-model M1 (2026-07-05): единый носитель формы критерия
// (type-only import — без runtime-связи с homework-модулем).
import type { GradingCriterion } from '@/lib/tutorHomeworkApi';

export type ExamType = 'ege' | 'oge';

/** Тип темы каталога: экзаменационная (ЕГЭ/ОГЭ, группировка по № КИМ) или олимпиадная. */
export type TopicKind = 'exam' | 'olympiad';

/**
 * Верхний фильтр витрины каталога. 'ege'/'oge' → exam-темы по экзамену;
 * 'olympiad' → олимпиадные темы (kind='olympiad', без № КИМ).
 */
export type CatalogFilter = 'ege' | 'oge' | 'olympiad';

/**
 * Предметы с АНОНСИРОВАННЫМ каталожным контентом (мультипредметный каталог, 2026-07-07).
 *
 * ⚠️ Семантика сузилась: это больше НЕ словарь форм. Личные формы задач
 * (Create/EditTaskModal, AI-загрузчик, каскад классификации) рендерят ПОЛНЫЙ
 * `SUBJECTS` (14, `@/types/homework`) — школьный репетитор любого предмета
 * грузит задачи в свою базу. Этот список — только «якорные» предметы витрины
 * Каталога (pills всегда показывают их, даже до появления тем; новый
 * модератор-предметник → добавляй сюда + онбординг-миграция с ОБЕИМИ ролями,
 * rule 50). `kb_topics.subject`/`kb_sources.subject` — свободный TEXT.
 */
export const KB_SUBJECTS = [
  { id: 'physics', label: 'Физика' },
  { id: 'social', label: 'Обществознание' },
] as const;

export type KBSubjectId = (typeof KB_SUBJECTS)[number]['id'];

/**
 * Исторический fallback-предмет KB (весь старый контент — физика).
 * Для ДЕФОЛТА поверхностей используй `resolveTutorDefaultSubject`
 * (`@/lib/tutorSubjects`) — last-used → профиль → physics.
 */
export const DEFAULT_KB_SUBJECT: KBSubjectId = 'physics';

export type MaterialType = 'file' | 'link' | 'media' | 'board';

// =============================================
// Каталог Сократ AI
// =============================================

export interface KBTopic {
  id: string;
  name: string;
  section: string;
  /** NULL для олимпиадных тем (kind='olympiad'). */
  exam: ExamType | null;
  kim_numbers: number[];
  sort_order: number;
  created_at: string;
  /** Предмет темы ('physics' по умолчанию; закладка под математику). */
  subject: string;
  /** 'exam' (ЕГЭ/ОГЭ) | 'olympiad'. */
  kind: TopicKind;
}

/** Topic with aggregated counts from kb_topics_with_counts view */
export interface KBTopicWithCounts extends KBTopic {
  task_count: number;
  material_count: number;
  subtopic_names: string[];
}

export interface KBSubtopic {
  id: string;
  topic_id: string;
  name: string;
  sort_order: number;
}

/**
 * Управляемый справочник источников задач (kb_sources). Модератор ведёт
 * глобальный список; в форме задачи тутор выбирает из него (или вписывает
 * «Другой»). Выбранное имя пишется в `kb_tasks.source_label`. Запрос Егора.
 */
export interface KBSource {
  id: string;
  name: string;
  subject: string;
  sort_order: number;
}

// =============================================
// Личная база (папки)
// =============================================

export interface KBFolder {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  /**
   * Тема каталога, в которую публикуется папка (kb_publish_folder_to_catalog).
   * NULL = папка ещё не публиковалась. Заполняется при первой публикации →
   * prefill в PublishFolderModal для повторной публикации в один клик.
   */
  catalog_topic_id?: string | null;
  catalog_subtopic_id?: string | null;
}

/** Folder node with recursive children for tree rendering */
export interface KBFolderTreeNode extends KBFolder {
  children: KBFolderTreeNode[];
}

export interface KBFolderWithCounts extends KBFolder {
  child_count: number;
  task_count: number;
}

export interface CreateKBFolderInput {
  name: string;
  parent_id?: string | null;
}

// =============================================
// Задачи
// =============================================

export type ModerationStatus = 'active' | 'hidden_duplicate' | 'unpublished';

export interface KBTask {
  id: string;
  topic_id: string | null;
  subtopic_id: string | null;
  folder_id: string | null;
  owner_id: string | null;
  exam: ExamType | null;
  kim_number: number | null;
  primary_score: number | null;
  /**
   * Уровень сложности олимпиадной задачи 1–5 (= балл за задачу). NULL для
   * ЕГЭ/ОГЭ (там балл известен по № КИМ). Запрос Егора (2026-06-21).
   */
  difficulty: number | null;
  text: string;
  answer: string | null;
  solution: string | null;
  answer_format: string | null;
  check_format: string | null;
  source_label: string | null;
  /**
   * Single storage ref (`storage://kb-attachments/…`) or JSON array of refs
   * (`["storage://…", "storage://…"]`) for multi-image tasks.
   * Use `parseAttachmentUrls()` / `serializeAttachmentUrls()` from kbApi.ts.
   */
  attachment_url: string | null;
  /** Solution images — same format as attachment_url. */
  solution_attachment_url: string | null;
  /**
   * Grading criteria (rubric). Field-parity fix (2026-06-03): «Моя база» only —
   * the moderation triggers never copy it into the public catalog. Mirrors
   * homework_tutor_tasks.rubric_text. Copied on import + persisted on save-back.
   */
  rubric_text: string | null;
  /** Rubric photos — same dual-format as attachment_url (limit 3). «Моя база» only. */
  rubric_image_urls: string | null;
  /**
   * unified-task-model M1 (2026-07-05): полный паритет AI-настройки с
   * homework_tutor_tasks — задача «живёт» в Базе со всей конфигурацией
   * проверки, ДЗ хранит её снимок. С M2 публикуются в каталог (включая
   * рубрику — осознанное решение владельца; publish только модераторами).
   */
  task_kind: 'numeric' | 'extended' | 'proof' | 'speaking' | null;
  cefr_level: 'A2' | 'B1' | 'B2' | 'C1' | null;
  grading_criteria_json: GradingCriterion[] | null;
  /** Source task → its canonical public copy (set on source tasks in сократ) */
  published_task_id: string | null;
  /** Canonical public copy → its source task (set on catalog copies) */
  source_task_id: string | null;
  /** Normalized text+answer hash for dedup (set on catalog copies) */
  fingerprint: string | null;
  /** Moderation lifecycle: active, hidden_duplicate, unpublished */
  moderation_status: ModerationStatus;
  /** Explanation when hidden/unpublished */
  hidden_reason: string | null;
  /** Who published this task (moderator user_id, set on catalog copies) */
  published_by: string | null;
  /** When published (set on catalog copies) */
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Task with joined subtopic/topic names for display */
export interface KBTaskWithNames extends KBTask {
  subtopic_name?: string;
  topic_name?: string;
}

export interface CreateKBTaskInput {
  folder_id: string;
  text: string;
  exam?: ExamType;
  kim_number?: number;
  answer?: string;
  solution?: string;
  answer_format?: string;
  /**
   * Grading mode for ДЗ (P1-4, 2026-06-27): persisted so AI-loaded tasks grade
   * by the ФИПИ rubric on import (`resolveSubjectRubric` reads kim+check_format).
   * Column `kb_tasks.check_format` exists (migration 20260401140000).
   */
  check_format?: 'short_answer' | 'detailed_solution';
  attachment_url?: string;
  solution_attachment_url?: string;
  /** Grading criteria (field-parity fix 2026-06-03, «Моя база» only). */
  rubric_text?: string;
  rubric_image_urls?: string;
  topic_id?: string;
  subtopic_id?: string;
  source_label?: string;
  primary_score?: number;
  /** Уровень сложности 1–5 для олимпиадных задач (= балл). */
  difficulty?: number | null;
  /** unified-task-model M1 (2026-07-05): AI-настройка — паритет с ДЗ. */
  task_kind?: 'numeric' | 'extended' | 'proof' | 'speaking' | null;
  cefr_level?: 'A2' | 'B1' | 'B2' | 'C1' | null;
  grading_criteria_json?: GradingCriterion[] | null;
}

export interface UpdateKBTaskInput {
  text?: string;
  exam?: ExamType | null;
  kim_number?: number | null;
  primary_score?: number | null;
  /** Уровень сложности 1–5 для олимпиадных задач (= балл). */
  difficulty?: number | null;
  answer?: string | null;
  solution?: string | null;
  answer_format?: string | null;
  /** Grading mode (P1-4) — parity with CreateKBTaskInput. */
  check_format?: 'short_answer' | 'detailed_solution' | null;
  attachment_url?: string | null;
  solution_attachment_url?: string | null;
  /** Grading criteria (field-parity fix 2026-06-03, «Моя база» only). */
  rubric_text?: string | null;
  rubric_image_urls?: string | null;
  topic_id?: string | null;
  subtopic_id?: string | null;
  folder_id?: string | null;
  source_label?: string | null;
  /** unified-task-model M1 (2026-07-05): AI-настройка — паритет с ДЗ. */
  task_kind?: 'numeric' | 'extended' | 'proof' | 'speaking' | null;
  cefr_level?: 'A2' | 'B1' | 'B2' | 'C1' | null;
  grading_criteria_json?: GradingCriterion[] | null;
}

// =============================================
// Материалы
// =============================================

export interface KBMaterial {
  id: string;
  topic_id: string | null;
  folder_id: string | null;
  owner_id: string | null;
  type: MaterialType;
  name: string;
  format: string | null;
  url: string | null;
  storage_key: string | null;
  created_at: string;
}

// =============================================
// Homework Integration — Snapshot
// =============================================

/** Draft task in Zustand store (snapshot created on "В ДЗ" click) */
export interface HWDraftTask {
  taskId: string;
  textSnapshot: string;
  answerSnapshot: string | null;
  solutionSnapshot: string | null;
  attachmentSnapshot: string | null;
  /**
   * Dual-format storage refs для фото эталонного решения (KB solution_attachment_url).
   * Переносится в `homework_tutor_tasks.solution_image_urls` при финализации ДЗ
   * через HWDrawer. См. plan wild-swinging-nova.md (2026-04-18).
   */
  solutionAttachmentSnapshot: string | null;
  /**
   * Frozen rubric (критерии) из KB-задачи. Field-parity fix (2026-06-03):
   * переносится в `homework_tutor_tasks.rubric_text` / `rubric_image_urls` при
   * финализации ДЗ через HWDrawer (path B). Раньше рубрика не переносилась из
   * базы (баг #2 — «добавила из базы, критерии не прикрепились»). Optional для
   * backward-compat со старыми localStorage-черновиками (undefined → null).
   */
  rubricTextSnapshot?: string | null;
  rubricImageSnapshot?: string | null;
  /**
   * Frozen `check_format` для записи в `homework_tutor_tasks.check_format`
   * + derived `task_kind` через `deriveTaskKindFromCheckFormat()`. Без этого
   * HWDrawer-flow создавал ДЗ без формата, и student-side warn banner
   * показывался некорректно (Phase 3.1 hotfix 2026-05-13).
   * Resolved at addTask time из KBTask.check_format → answer_format → kim_number.
   * Optional для backward-compat с pre-fix localStorage drafts —
   * `undefined` ресолвится в `'short_answer'` на HWDrawer insert side
   * (safe default для физика ЕГЭ KB задач).
   */
  checkFormatSnapshot?: 'short_answer' | 'detailed_solution';
  snapshotEdited: boolean;
  source: 'socrat' | 'my';
  subtopic: string;
  topicName: string;
  sourceLabel?: string | null;
  /**
   * № КИМ из KB-задачи (Phase 2, 2026-06-21). HWDrawer (path B) пишет его в
   * `homework_tutor_tasks.kim_number` → AI грейдит по критериям ФИПИ этого номера.
   * Optional для backward-compat со старыми localStorage-черновиками (undefined → null).
   */
  kim_number?: number | null;
  /**
   * Балл за задачу (KB primary_score). HWDrawer (path B) пишет его в
   * `homework_tutor_tasks.max_score` — иначе KB-задача с авто-баллом/сложностью
   * (>1) молча падала в DB DEFAULT 1 (review fix P1, 2026-06-21).
   * Optional для backward-compat со старыми черновиками (undefined → 1).
   */
  maxScoreSnapshot?: number | null;
  /**
   * unified-task-model F1 (2026-07-05): freeze AI-настройки (rule 40 dual-write)
   * — path B перестаёт ронять критерии/CEFR/speaking. Optional (старые черновики).
   */
  gradingCriteriaSnapshot?: GradingCriterion[] | null;
  cefrLevelSnapshot?: 'A2' | 'B1' | 'B2' | 'C1' | null;
  taskKindSnapshot?: 'speaking' | null;
}

/** Row from homework_kb_tasks table */
export interface HomeworkKBTask {
  id: string;
  homework_id: string;
  task_id: string | null;
  sort_order: number;
  task_text_snapshot: string;
  task_answer_snapshot: string | null;
  task_solution_snapshot: string | null;
  snapshot_edited: boolean;
  added_at: string;
}

// =============================================
// Moderation
// =============================================

export type ModerationAction = 'publish' | 'resync' | 'unpublish' | 'reassign' | 'hide_duplicate';

/** Row from kb_moderation_log table */
export interface KBModerationLogEntry {
  id: string;
  action: ModerationAction;
  task_id: string | null;
  source_task_id: string | null;
  moderator_id: string;
  details: Record<string, unknown>;
  created_at: string;
}
