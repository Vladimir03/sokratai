import type { HomeworkSubject, MaterialType } from '@/lib/tutorHomeworkApi';

// ─── Constants ───────────────────────────────────────────────────────────────

export const SUBJECTS: { value: HomeworkSubject; label: string }[] = [
  { value: 'math', label: 'Математика' },
  { value: 'physics', label: 'Физика' },
  { value: 'history', label: 'История' },
  { value: 'social', label: 'Обществознание' },
  { value: 'english', label: 'Английский' },
  { value: 'cs', label: 'Информатика' },
];

export const SUBJECT_LABELS_MAP: Record<string, string> = {
  math: 'Математика', physics: 'Физика', history: 'История',
  social: 'Обществознание', english: 'Английский', cs: 'Информатика',
};

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
  topic: string;
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
  task_image_path: string | null;
  task_image_name: string | null;
  task_image_preview_url: string | null;
  task_image_used_fallback: boolean;
  correct_answer: string;
  rubric_text: string;
  max_score: number;
  uploading: boolean;
  /** KB provenance — set when task added from Knowledge Base picker */
  kb_task_id?: string | null;
  kb_source?: 'socrat' | 'my';
  kb_snapshot_text?: string;
  kb_snapshot_answer?: string | null;
  kb_snapshot_solution?: string | null;
  /** Original KB attachment URL (storage:// or https://). Not usable as task_image_path directly. */
  kb_attachment_url?: string | null;
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
  topic: string;
  deadline: string;
  workflow_mode: 'classic' | 'guided_chat';
  disable_ai_bootstrap?: boolean;
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
    max_score: 1,
    uploading: false,
  };
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
