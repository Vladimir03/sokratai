// =============================================
// Knowledge Base Types
// =============================================

export type ExamType = 'ege' | 'oge';

export type MaterialType = 'file' | 'link' | 'media' | 'board';

// =============================================
// Каталог Сократа
// =============================================

export interface KBTopic {
  id: string;
  name: string;
  section: string;
  exam: ExamType;
  kim_numbers: number[];
  sort_order: number;
  created_at: string;
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
  text: string;
  answer: string | null;
  solution: string | null;
  answer_format: string | null;
  source_label: string | null;
  /**
   * Single storage ref (`storage://kb-attachments/…`) or JSON array of refs
   * (`["storage://…", "storage://…"]`) for multi-image tasks.
   * Use `parseAttachmentUrls()` / `serializeAttachmentUrls()` from kbApi.ts.
   */
  attachment_url: string | null;
  /** Solution images — same format as attachment_url. */
  solution_attachment_url: string | null;
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
  attachment_url?: string;
  solution_attachment_url?: string;
  topic_id?: string;
  subtopic_id?: string;
  source_label?: string;
  primary_score?: number;
}

export interface UpdateKBTaskInput {
  text?: string;
  exam?: ExamType | null;
  kim_number?: number | null;
  primary_score?: number | null;
  answer?: string | null;
  solution?: string | null;
  answer_format?: string | null;
  attachment_url?: string | null;
  solution_attachment_url?: string | null;
  topic_id?: string | null;
  subtopic_id?: string | null;
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
  snapshotEdited: boolean;
  source: 'socrat' | 'my';
  subtopic: string;
  topicName: string;
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
