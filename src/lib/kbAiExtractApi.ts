import { supabase } from '@/lib/supabaseClient';
import { extractEdgeFunctionError } from '@/lib/edgeFunctionError';

// ─── kb-ai-extract client (AI-загрузка задач, P0, tutor side) ──────────────────
//
// Thin client over the edge function `kb-ai-extract` (verify_jwt=true, extract-only).
// `supabase.functions.invoke` posts to `${functionsUrl}/kb-ai-extract`; functionsUrl
// derives from the hardcoded `api.sokratai.ru` (RU-safe). Errors are parsed via
// `extractEdgeFunctionError` (rule 97 flat shape `{ error, code }`) — never surface
// "Edge Function returned a non-2xx status code".
//
// Types MIRROR the edge contract (prompts.md §3 + edge-added fields). Keep in sync
// with supabase/functions/kb-ai-extract/index.ts::ExtractedTask. The edge ONLY
// extracts drafts — the commit (write to kb_tasks) happens client-side via the
// existing `insertTask` path (rule 40 dual-write-path).

export type AnswerConfidence = 'high' | 'medium' | 'low';
export type ExtractedAnswerFormat = 'number' | 'text' | 'detailed' | 'matching' | 'choice';
export type ExtractedCheckFormat = 'short_answer' | 'detailed_solution';
export type ExtractedExam = 'ege' | 'oge';

/** Where a duplicate of this draft already exists (edge-side fingerprint dedup). */
export interface FingerprintMatch {
  /** `mine` = в личной базе репетитора; `catalog` = только в общем Каталоге. */
  scope: 'mine' | 'catalog';
  /** Имя папки для `mine`-совпадения (если резолвилось); иначе null. */
  folder_name: string | null;
}

/**
 * One AI-extracted draft task. Mirror of prompts.md §3 + edge additions
 * (`attachment_ref`, `fingerprint_match`). The edge normalizes everything:
 * `answer` is forced to null when `answer_confidence === 'low'`,
 * `image_action` is always `attach_original` (P0 — no redraw).
 */
export interface ExtractedTask {
  text: string;
  answer: string | null;
  answer_confidence: AnswerConfidence;
  solution: string | null;
  answer_format: ExtractedAnswerFormat | null;
  /** Advisory only — NOT persisted to kb_tasks (CreateKBTaskInput has no check_format). */
  check_format: ExtractedCheckFormat | null;
  kim_number: number | null;
  exam: ExtractedExam | null;
  primary_score: number | null;
  /** tutor-only — в Каталог не уходит (пишется в личную папку owner=tutor). */
  rubric_text: string | null;
  topic_suggestion: string;
  subtopic_suggestion: string;
  source_label: string;
  /** 0-based index into the успешно приложенных изображений; null = нет рисунка. */
  image_index: number | null;
  image_action: 'attach_original';
  needs_review_fields: string[];
  notes: string | null;
  /** Resolved original `storage://kb-attachments/...` ref for `image_index` (edge-added). */
  attachment_ref: string | null;
  /** Non-null when a same-fingerprint task already exists (edge-added; card un-checked by default). */
  fingerprint_match: FingerprintMatch | null;
}

export interface ExtractStats {
  found: number;
  low_confidence_answers: number;
  unreadable_images: number;
}

export interface ExtractResponse {
  drafts: ExtractedTask[];
  stats: ExtractStats;
}

export interface ExtractInput {
  /** UUID папки-назначения (ownership: kb_folders.owner_id === me). */
  folder_id: string;
  material: {
    type: 'text' | 'image';
    /** Сырой текст материала (для type='text'). */
    text?: string;
    /** `storage://kb-attachments/{me}/...` refs приложенных скриншотов (≤10). */
    image_refs?: string[];
  };
  /** Подсказка экзамена для модели (приоритет). */
  exam_hint?: ExtractedExam;
  /** Подсказка темы для модели. */
  topic_hint?: string;
}

/** rule 97 flat-shape error carrier — exposes `code` for branching (e.g. INVALID_FOLDER). */
export class KbAiExtractApiError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'KbAiExtractApiError';
    this.code = code;
  }
}

const FN = 'kb-ai-extract';

/**
 * Распознать задачи из материала (текст + ≤10 фото). Возвращает черновики —
 * запись в «Мою базу» делает клиент через существующий `insertTask`.
 */
export async function extractTasks(input: ExtractInput): Promise<ExtractResponse> {
  const { data, error } = await supabase.functions.invoke(FN, {
    method: 'POST',
    body: input,
  });
  if (error) {
    const { message, code } = await extractEdgeFunctionError(
      error,
      data,
      'Не удалось распознать задачи. Попробуйте ещё раз.',
    );
    throw new KbAiExtractApiError(message, code);
  }
  const res = data as Partial<ExtractResponse> | null;
  return {
    drafts: Array.isArray(res?.drafts) ? res!.drafts : [],
    stats: res?.stats ?? { found: 0, low_confidence_answers: 0, unreadable_images: 0 },
  };
}
