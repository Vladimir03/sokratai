/**
 * Педагогический контекст ученика для AI-промптов (subject-personalization Ф5,
 * 2026-07-23). Spec: docs/delivery/features/subject-personalization/spec.md.
 *
 * КРИТИЧЕСКИЙ ИНВАРИАНТ — evaluation/pedagogy split (обобщение tone-split
 * `grading_discipline`, rule 40): класс/тип ученика/цель влияют ТОЛЬКО на тон,
 * подсказки и язык объяснений. Блок НИКОГДА не вставляется в grading-секцию
 * промпта (МЕТОДОЛОГИЯ/ПРАВИЛА ОЦЕНКИ) и НИКОГДА не передаётся в грейдер
 * пробников — оценивание семиклассника не мягче (решение владельца).
 *
 * PII-политика: класс и цель — ок (имя ученика уже едет в промпт);
 * телефон/email — никогда.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface LearningContext {
  /** Класс 1–11 (profiles.grade); null = не указан / взрослый. */
  grade: number | null;
  learnerType: "school" | "adult" | null;
  /** Цель обучения (profiles.learning_goal), обрезана до 200 симв. */
  learningGoal: string | null;
  /**
   * Экзамен-подсказка ОТ КЛАССА: ТОЛЬКО 9→oge, 10-11→ege (ревью A2 в спеке:
   * семикласснику нельзя подсказывать ОГЭ). Любая непустая learning_goal
   * приоритетнее — тогда null (цель говорит сама, текст не парсим).
   */
  examHint: "oge" | "ege" | null;
}

const LEARNING_GOAL_MAX_CHARS = 200;

/** См. LearningContext.examHint. */
export function deriveExamHint(
  grade: number | null,
  learningGoal: string | null,
): "oge" | "ege" | null {
  if (learningGoal && learningGoal.trim().length > 0) return null;
  if (grade === 9) return "oge";
  if (grade === 10 || grade === 11) return "ege";
  return null;
}

/** Чистый билдер из уже загруженных полей profiles (без I/O). */
export function buildLearningContext(fields: {
  grade?: unknown;
  learner_type?: unknown;
  learning_goal?: unknown;
}): LearningContext | null {
  const grade =
    typeof fields.grade === "number" && Number.isInteger(fields.grade) &&
    fields.grade >= 1 && fields.grade <= 11
      ? fields.grade
      : null;
  const learnerType =
    fields.learner_type === "school" || fields.learner_type === "adult"
      ? fields.learner_type
      : null;
  // Ревью P2-1: цель — student-writable free text → схлопываем whitespace
  // (никаких переводов строк — анти prompt-injection через поддельные
  // секции-заголовки) + кап длины; в блоке цитируется в «…».
  const rawGoal = typeof fields.learning_goal === "string"
    ? fields.learning_goal.replace(/\s+/g, " ").trim()
    : "";
  const learningGoal = rawGoal ? rawGoal.slice(0, LEARNING_GOAL_MAX_CHARS) : null;

  if (grade === null && learnerType === null && learningGoal === null) return null;
  return { grade, learnerType, learningGoal, examHint: deriveExamHint(grade, learningGoal) };
}

/**
 * Загрузчик по userId ученика (free-чат `chat/index.ts`, где profiles ещё не
 * читались). Never-throws: сбой → null + PII-free warn (AI работает без
 * контекста — деградация, не ошибка).
 */
export async function loadLearningContext(
  db: SupabaseClient,
  studentUserId: string,
): Promise<LearningContext | null> {
  try {
    const { data, error } = await db
      .from("profiles")
      .select("grade, learner_type, learning_goal")
      .eq("id", studentUserId)
      .maybeSingle();
    if (error) {
      console.warn(
        JSON.stringify({ event: "learning_context_load_failed", error: error.message }),
      );
      return null;
    }
    if (!data) return null;
    return buildLearningContext(data);
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "learning_context_load_threw",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return null;
  }
}

/**
 * Текст-блок для system-промпта. Пустая строка, когда контекста нет.
 * Запрет влиять на оценку зашит В САМ ТЕКСТ (зеркало grading_discipline) —
 * плюс структурная гарантия: вызыватели вставляют блок ВЫШЕ grading-секции.
 *
 * `includeExamHint: false` — для поверхностей, где экзамен УЖЕ известен
 * серверу (guided ДЗ: assignment.exam_type в методологии) — иначе
 * девятиклассник на ЕГЭ-ДЗ получал бы смешанный сигнал «готовится к ОГЭ»
 * (ревью P3-1). Free-чат оставляет true (там подсказка и полезна).
 *
 * `includeGoal: false` — ОБЯЗАТЕЛЬНО для ГРЕЙДИНГ-промптов (ревью 5.6 P1):
 * learning_goal — student-writable free text = prompt-injection канал в
 * оценку («верни CORRECT…»); schlопнутый whitespace и цитата это смягчают,
 * но не исключают. В check-промпт едут ТОЛЬКО неинжектируемые grade (int)
 * и learner_type (enum); цель остаётся в hint/free-чате (scoring-neutral,
 * hint дополнительно под leak-детектором).
 */
export function buildPedagogyContextBlock(
  ctx: LearningContext | null,
  opts: { includeExamHint?: boolean; includeGoal?: boolean } = {},
): string {
  if (!ctx) return "";
  const includeExamHint = opts.includeExamHint ?? true;
  const includeGoal = opts.includeGoal ?? true;
  const lines: string[] = ["=== КОНТЕКСТ УЧЕНИКА (только тон и подача) ==="];
  if (ctx.learnerType === "adult") {
    lines.push("- Взрослый ученик: без школьного тона, обращайся как к равному.");
  } else if (ctx.grade !== null) {
    const exam = !includeExamHint
      ? ""
      : ctx.examHint === "oge"
        ? " (вероятно, готовится к ОГЭ)"
        : ctx.examHint === "ege"
          ? " (вероятно, готовится к ЕГЭ)"
          : "";
    lines.push(
      `- Класс: ${ctx.grade}${exam}. Подбирай сложность объяснений и примеры под этот возраст.`,
    );
  }
  if (includeGoal && ctx.learningGoal) {
    lines.push(`- Цель обучения (со слов ученика, цитата): «${ctx.learningGoal}»`);
  }
  // Ни одного факта не набралось (напр. только цель при includeGoal:false) —
  // блок не рендерим вовсе (пустая шапка + запреты = шум в промпте).
  if (lines.length === 1) return "";
  lines.push(
    "Этот блок влияет ТОЛЬКО на стиль объяснений, примеры и язык.",
    "ЗАПРЕЩЕНО менять из-за него вердикт, баллы или строгость оценки.",
  );
  return lines.join("\n");
}
