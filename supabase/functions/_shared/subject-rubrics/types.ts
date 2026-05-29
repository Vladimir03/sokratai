/**
 * Subject-rubric layer — types.
 *
 * Resolves canonical methodology / role / hint examples / fallback per
 * subject + exam_type + kim_number, merging tutor-defined `rubric_text`
 * with default ФИПИ / DELF / IELTS criteria. Used by:
 *   - homework-api/guided_ai.ts::buildCheckPrompt + buildHintPrompt
 *   - chat/index.ts subject-block injection
 *
 * Spec: `~/.claude/plans/1-functional-meteor.md` Phase 2 (subject-rubric layer).
 *
 * Anti-leak invariant: subject rubrics are tutor-facing prompt context only;
 * never rendered to student directly. AI uses methodology to grade / hint
 * but does not cite rubric items verbatim (covered by existing anti-spoiler
 * checks in guided_ai.ts).
 */

export type ExamType = "ege" | "oge";

/**
 * CEFR level for language subjects. Auto-detected from task_text or default B1.
 * Maps loosely to ЕГЭ ≈ B2 / ОГЭ ≈ B1 / IELTS 5-6 ≈ B1 / IELTS 6.5+ ≈ B2.
 */
export type CefrLevel = "A2" | "B1" | "B2" | "C1";

/**
 * Resolver input. All fields except `subject` and `task_kind` are best-effort
 * (resolver degrades gracefully — never throws).
 */
export interface SubjectRubricInput {
  /** Canonical subject id from `homework_tutor_assignments.subject`. */
  subject: string;
  /** Defaults to 'ege' when nullable (P0 scope is ЕГЭ-only). */
  exam_type?: ExamType | null;
  /**
   * Optional KIM-style task number (`homework_tutor_tasks.kim_number`).
   * When present, resolver picks methodology specific to that number
   * (e.g. № 18 параметр vs № 13 уравнения in math).
   */
  kim_number?: number | null;
  /** Drives whether the rubric is "extended" (full methodology) or "numeric" (compact). `speaking` forces oral format for languages (voice-speaking-mvp). */
  task_kind: "numeric" | "extended" | "proof" | "speaking";
  /** Used for CEFR auto-detection in language subjects. */
  task_text?: string | null;
  /**
   * Explicit CEFR level from the tutor («Уровень» selector → `homework_tutor_tasks.cefr_level`).
   * CEFR-level fix (2026-05-29): when set, it FORCES the language rubric level
   * (overrides task_text heuristics + the B1 default). `null`/undefined → auto-detect.
   */
  cefr_level?: CefrLevel | null;
  /**
   * Optional tutor-defined `homework_tutor_tasks.rubric_text`. When non-empty,
   * resolver merges it FIRST (tutor priority), then ФИПИ / DELF defaults.
   * AI sees both blocks: «Tutor сказал X. Дополнительно стандартные критерии: Y».
   */
  tutor_rubric?: string | null;
}

/**
 * Per-criterion grading template for language subjects (DELF / ЕГЭ EN /
 * IELTS / ОГЭ — written and oral). Drives the structured AI output
 * `criteria_breakdown` (`evaluateStudentAnswer.GuidedCheckResult`), which
 * is persisted into `homework_tutor_task_states.ai_criteria_json` and
 * rendered as a 1-page «критерий → балл/макс → комментарий» table.
 *
 * Voice-Speaking MVP TASK-2 (2026-05-27).
 *
 * Contract:
 *   - Labels are stable identifiers in Russian (e.g. «Соответствие заданию»).
 *     AI must echo them verbatim so the renderer / validator can match.
 *   - `max` is the maximum points for the criterion (Σ max = exam total).
 *   - `kind = 'ai'` (default) — AI grades from the transcript / written
 *     text. `kind = 'tutor_only'` — surface as «оценивает репетитор на
 *     слух» (phonétique / произношение); AI never penalizes this criterion.
 */
export interface SubjectCriterionTemplate {
  /** Russian label, surfaced 1:1 in the breakdown table. */
  label: string;
  /** Maximum points for this criterion. */
  max: number;
  /**
   * Defaults to 'ai'. 'tutor_only' = phonétique / произношение / другие
   * аспекты, которые AI не оценивает (например, audio cannot reach AI for
   * pronunciation comparison). UI помечает их как «оценивает репетитор».
   */
  kind?: "ai" | "tutor_only";
}

/**
 * Resolver output. All consumers (check / hint / chat) pick the fields they need.
 */
export interface SubjectRubric {
  /** Role line for system prompt — replaces hardcoded «Ты — физик-наставник». */
  role: string;
  /**
   * Multi-line methodology block — the detailed criteria. Injected after role
   * in check-prompt's system content + chat-prompt's subject-block. Contains
   * tutor_rubric (first) + default ФИПИ / DELF / IELTS criteria.
   */
  methodology: string;
  /** One-line hint examples — used in buildHintPrompt «ОБЯЗАТЕЛЬНО» list. */
  hint_examples: string;
  /** Fallback hint text when AI is rejected by leak detector. */
  fallback_hint: string;
  /** Subject label in Russian (e.g. «Физика», «Французский язык»). */
  subject_label: string;
  /**
   * Resolved CEFR level for language subjects, `null` for non-language.
   * Used in methodology block to switch rubric for B1 vs B2.
   */
  cefr_level: CefrLevel | null;
  /** Telemetry: was tutor_rubric prepended to methodology? */
  tutor_rubric_active: boolean;
  /**
   * Per-criterion template for `criteria_breakdown` AI output. NULL for
   * subjects without a per-criterion rubric (physics / maths / chemistry /
   * informatics / russian / literature / history / social / biology /
   * geography / other). Populated only for language formats (DELF / ЕГЭ EN /
   * IELTS / ОГЭ writing + monologue + production orale). See
   * `SubjectCriterionTemplate` for shape.
   */
  criteria_breakdown_template?: SubjectCriterionTemplate[] | null;
}
