/**
 * Preview helper для tutor UI: показать что AI использует в обращении к ученику.
 *
 * Mirror серверной логики в `supabase/functions/homework-api/guided_ai.ts::buildStudentNameGuidance`.
 * При изменении gender conjugation в server-side инструкциях — синхронно обновить здесь,
 * иначе tutor видит другой preview чем реальный AI output.
 *
 * Phase 8.1 (2026-05-26) — добавлено как часть visibility-chip system для тутора.
 */

export interface AiAddressPreview {
  /** Короткий human-readable summary: "Ирина · женский род" / "имя не задано · нейтральный род". */
  summary: string;
  /** Пример полной фразы как AI будет писать ученику. */
  exampleSentence: string;
  /** Серьёзность отсутствия данных для tooltip / banner. */
  severity: "ok" | "partial" | "missing";
}

const NEUTRAL_PHRASE = "Молодец! Ты справился/справилась с задачей";
const FEMALE_PHRASE = (name: string | null) =>
  name ? `${name}, отлично — ты решила правильно!` : "Отлично — ты решила правильно!";
const MALE_PHRASE = (name: string | null) =>
  name ? `${name}, отлично — ты решил правильно!` : "Отлично — ты решил правильно!";

export function buildAiAddressPreview(
  name: string | null | undefined,
  gender: "male" | "female" | null | undefined,
): AiAddressPreview {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const hasName = trimmedName.length > 0;
  const genderLabel =
    gender === "female" ? "женский род" : gender === "male" ? "мужской род" : "нейтральный род";

  const summary = `${hasName ? trimmedName : "имя не задано"} · ${genderLabel}`;

  let exampleSentence: string;
  if (gender === "female") {
    exampleSentence = FEMALE_PHRASE(hasName ? trimmedName : null);
  } else if (gender === "male") {
    exampleSentence = MALE_PHRASE(hasName ? trimmedName : null);
  } else {
    exampleSentence = hasName
      ? `${trimmedName}, ты справился/справилась — молодец!`
      : NEUTRAL_PHRASE;
  }

  const severity: AiAddressPreview["severity"] =
    hasName && gender ? "ok" : hasName || gender ? "partial" : "missing";

  return { summary, exampleSentence, severity };
}

/**
 * Цвета для chip / badge в зависимости от severity.
 *
 * Phase 8.1 polish: label теперь говорит «Пример тона», а не «AI обращение
 * готово». Это снижает trust drift — example sentence ниже это иллюстрация
 * стиля, а не дословный output AI. AI вариативен в формулировках, серверный
 * prompt даёт guidance, а не template.
 */
export const AI_ADDRESS_SEVERITY_STYLES: Record<
  AiAddressPreview["severity"],
  { bg: string; text: string; border: string; label: string }
> = {
  ok: {
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
    label: "Пример тона AI",
  },
  partial: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    label: "Пример тона (частично настроен)",
  },
  missing: {
    bg: "bg-slate-50",
    text: "text-slate-600",
    border: "border-slate-200",
    label: "Пример тона (нейтральный)",
  },
};
