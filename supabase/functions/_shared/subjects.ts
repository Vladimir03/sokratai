/**
 * Канонические предметы — Deno-зеркало `src/types/homework.ts::SUBJECTS`
 * (subject-personalization Ф1, 2026-07-23). Deno не может импортировать из
 * `src/` → mirror locally (конвенция attachment-refs / checkFormatHelpers).
 * Меняешь список предметов → правь ОБА файла.
 *
 * Родственный inline-словарь: `kb-ai-extract/index.ts::VALID_SUBJECT` (несёт
 * доп. per-subject метаданные промптов) — намеренно НЕ извлечён сюда (rule 10,
 * рабочий путь не трогаем); опциональный cleanup — derive его от этого модуля.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const CANONICAL_SUBJECT_IDS: ReadonlySet<string> = new Set([
  "maths",
  "physics",
  "informatics",
  "russian",
  "literature",
  "history",
  "social",
  "english",
  "french",
  "spanish",
  "chemistry",
  "biology",
  "geography",
  "other",
]);

/** Контент-предмет = канонический id, кроме 'other' (тот не настраивает кабинет). */
export function isContentSubject(id: unknown): id is string {
  return typeof id === "string" && id !== "other" && CANONICAL_SUBJECT_IDS.has(id);
}

/**
 * Санитизация `user_metadata.subjects_intent`: только строки из канонического
 * словаря (включая 'other'), дедуп, cap = размер словаря. Мусор/чужие значения
 * молча отбрасываются (metadata — клиентский ввод).
 */
export function sanitizeSubjectsIntent(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    if (!CANONICAL_SUBJECT_IDS.has(item)) continue;
    if (out.includes(item)) continue;
    out.push(item);
    if (out.length >= CANONICAL_SUBJECT_IDS.size) break;
  }
  return out;
}

/**
 * Персист `user_metadata.subjects_intent` → `tutors.subjects`.
 *
 * НИКОГДА не бросает (rule 96: auth-флоу не ломать — вызывается из email-verify
 * и assign-tutor-role). Идемпотентно: пишет ТОЛЬКО когда subjects ещё пуст
 * (NULL или '{}') — существующий выбор репетитора не перетирается. Логи
 * PII-free (только счётчики/коды).
 */
export async function persistSubjectsIntent(
  db: SupabaseClient,
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<void> {
  try {
    const subjects = sanitizeSubjectsIntent(metadata?.subjects_intent);
    if (subjects.length === 0) return;

    const { error } = await db
      .from("tutors")
      .update({ subjects })
      .eq("user_id", userId)
      .or("subjects.is.null,subjects.eq.{}");

    if (error) {
      console.warn(
        JSON.stringify({
          event: "subjects_intent_persist_failed",
          count: subjects.length,
          error: error.message,
        }),
      );
    }
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "subjects_intent_persist_threw",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}
