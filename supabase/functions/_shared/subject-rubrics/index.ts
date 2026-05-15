/**
 * Subject-rubric resolver — entry point for guided homework chat prompts.
 *
 * Architecture (Phase 2, 2026-05-15):
 *
 *   buildCheckPrompt / buildHintPrompt / chat::processAIRequest
 *     → resolveSubjectRubric({ subject, exam_type, kim_number, task_kind,
 *                              task_text, tutor_rubric })
 *     → SubjectRubric { role, methodology, hint_examples, fallback_hint, ... }
 *     → injected into AI system prompt
 *
 * Single source of truth для:
 *   - роли AI per subject (заменяет hardcoded «Ты — физик-наставник»)
 *   - методологии grading per subject + kim_number (расширяет subject switch)
 *   - hint examples (наследует Phase 1 paradigm)
 *   - fallback hint (наследует Phase 1)
 *
 * Tutor override contract:
 *   - Если `tutor_rubric` присутствует → prepended к methodology с маркером.
 *   - Default ФИПИ / DELF / IELTS критерии остаются как baseline.
 *   - AI инструктируется: tutor_rubric WINS при конфликте.
 *
 * Subject coverage:
 *   - physics (ЕГЭ № 21-26 + общий fallback)
 *   - maths / math / algebra / geometry (ЕГЭ № 13-19 + общий fallback)
 *   - chemistry (ЕГЭ № 29-34 + общий fallback)
 *   - english / french / spanish (auto-detect format + CEFR)
 *   - other subjects (informatics / russian / literature / history / social /
 *     biology / geography) → fallback Phase 1 short rubric
 */

import { buildChemistryEgeRubric } from "./chemistry-ege.ts";
import { buildLanguagesRubric } from "./languages-ege.ts";
import { buildMathEgeRubric } from "./math-ege.ts";
import { buildPhysicsEgeRubric } from "./physics-ege.ts";
import type { SubjectRubric, SubjectRubricInput } from "./types.ts";

// ─── Subject labels (mirror src/types/homework.ts SUBJECTS) ──────────────
// Keep in sync — Deno cannot import TS from src/. See CLAUDE.md §18.

const SUBJECT_LABELS: Record<string, string> = {
  maths: "Математика",
  physics: "Физика",
  informatics: "Информатика",
  russian: "Русский язык",
  literature: "Литература",
  history: "История",
  social: "Обществознание",
  english: "Английский язык",
  french: "Французский язык",
  spanish: "Испанский язык",
  chemistry: "Химия",
  biology: "Биология",
  geography: "География",
  other: "Другое",
  math: "Математика",
  rus: "Русский язык",
  cs: "Информатика",
  algebra: "Алгебра",
  geometry: "Геометрия",
};

const MATH_LIKE_SUBJECTS = new Set<string>(["maths", "math", "algebra", "geometry"]);
const LANGUAGE_SUBJECTS = new Set<string>(["english", "french", "spanish"]);

export function getSubjectLabel(subjectId: string | null | undefined): string {
  const id = (subjectId ?? "").trim();
  if (!id) return "школьному предмету";
  return SUBJECT_LABELS[id] ?? id;
}

// ─── Generic fallback (for subjects without dedicated rubric) ─────────────
//
// Mirrors Phase 1 buildHintExamplesLine + buildSubjectFallbackHint switches.
// When a subject doesn't have a dedicated rubric file yet (e.g. informatics
// or biology), AI still gets a short subject-aware block.

function buildGenericRubric(subject: string): Omit<SubjectRubric, "tutor_rubric_active" | "cefr_level" | "subject_label"> {
  const label = getSubjectLabel(subject);
  const role = `Ты — наставник по предмету «${label}». Проверяешь ответ ученика на задачу.`;

  switch (subject) {
    case "russian":
    case "rus":
      return {
        role,
        methodology: [
          "Методология проверки задач по русскому языку:",
          "- Определи тип задачи: орфография / пунктуация / морфология / синтаксис / стилистика / сочинение.",
          "- Для сочинения (№ 27 ЕГЭ): проверь формулировку проблемы, комментарий с примерами-иллюстрациями, позицию автора, отношение пишущего, фактическую точность.",
          "- Для тестовых заданий: укажи конкретное правило (например, «гласные после шипящих» / «безударные гласные в корне»).",
          "- Анти-спойлер: не приводи правильный ответ дословно — направь к правилу.",
        ].join("\n"),
        hint_examples: "- Упоминай конкретное правило орфографии / пунктуации / морфологии или категорию текста (тип речи, стилистическая фигура), применимое в ЭТОЙ задаче",
        fallback_hint: "Какое правило (орфография / пунктуация / морфология) применимо к этому случаю, и где в задаче ключевое слово?",
      };

    case "literature":
      return {
        role,
        methodology: [
          "Методология проверки задач по литературе:",
          "- Определи тип задачи: краткий ответ (термин / автор / произведение) / развёрнутый (мини-сочинение 8 предложений) / сочинение 200+ слов.",
          "- Для развёрнутых: проверь наличие тезиса, аргументов из текста (цитаты или пересказ), вывод.",
          "- Опирайся на знание программных произведений и литературоведческих понятий (метафора, эпитет, лирический герой, композиция, идея).",
          "- Анти-спойлер: не цитируй ответ — наведи на художественное средство / тему / позицию автора.",
        ].join("\n"),
        hint_examples: "- Упоминай конкретную тему, художественное средство, позицию автора или цитату, относящиеся к ЭТОЙ задаче",
        fallback_hint: "Какая тема, художественное средство или позиция автора помогают раскрыть мысль в этой задаче?",
      };

    case "history":
    case "social":
      return {
        role,
        methodology: [
          "Методология проверки задач по истории / обществознанию:",
          "- Определи тип задачи: дата / событие / понятие / причинно-следственная связь / эссе / историческое сочинение.",
          "- Для эссе: проверь раскрытие смысла высказывания, теоретическую аргументацию (термины), фактическую аргументацию (примеры из истории / общественной жизни / литературы).",
          "- Для исторического сочинения (ЕГЭ № 25): проверь хронологию (две даты), личность с ролью, событие/процесс, причинно-следственные связи, оценку влияния периода.",
          "- Анти-спойлер: не называй имя или дату — наведи на эпоху / документ / категорию.",
        ].join("\n"),
        hint_examples: "- Упоминай конкретное событие, термин или причинно-следственную связь, относящиеся к ЭТОЙ задаче",
        fallback_hint: "Какое событие, термин или причинно-следственная связь нужны для ответа на этот вопрос?",
      };

    case "informatics":
    case "cs":
      return {
        role,
        methodology: [
          "Методология проверки задач по информатике (ЕГЭ):",
          "- Определи тип задачи: алгоритмы / системы счисления / логика / структуры данных / программирование / Excel / БД / сети.",
          "- Для программирования (Python / Pascal / C++ / Java): проверь синтаксис, корректность алгоритма, обработку граничных случаев, эффективность (если требуется по балльности).",
          "- Для логики и систем счисления: проверь точность преобразований, операторы.",
          "- Анти-спойлер: не давай готовый код — направь к алгоритму или конструкции языка.",
        ].join("\n"),
        hint_examples: "- Упоминай конкретный алгоритм, конструкцию языка программирования или приём, применимый в ЭТОЙ задаче",
        fallback_hint: "Какой алгоритм, конструкция языка или приём подходят к этой задаче, и какие данные ты используешь?",
      };

    case "biology":
      return {
        role,
        methodology: [
          "Методология проверки задач по биологии:",
          "- Определи раздел: молекулярная / клеточная / генетика / экология / эволюция / ботаника / зоология / анатомия.",
          "- Для генетики: проверь правильность гипотезы (моно- / дигибридное), правильность гамет, схему скрещивания, расчёт вероятностей.",
          "- Для экологии и эволюции: причинно-следственные связи, термины (биогеоценоз, естественный отбор, мутация).",
          "- Анти-спойлер: не называй итоговое объяснение — направь к процессу или термину.",
        ].join("\n"),
        hint_examples: "- Упоминай конкретный процесс, термин или систему, описывающие то, о чём ЭТА задача",
        fallback_hint: "Какой процесс, термин или система описывает то, о чём задача, и какие данные для этого нужны?",
      };

    case "geography":
      return {
        role,
        methodology: [
          "Методология проверки задач по географии:",
          "- Определи раздел: физическая / экономическая / социальная / страноведение / климатология / картография.",
          "- Для расчётных: проверь использование статистических данных, единицы измерения, формулы (плотность населения, ВВП на душу, коэффициент рождаемости).",
          "- Для качественных: проверь причинно-следственные связи между природными / экономическими / социальными факторами.",
          "- Анти-спойлер: не указывай конкретный регион / страну — направь к географическому процессу / закономерности.",
        ].join("\n"),
        hint_examples: "- Упоминай конкретный процесс, явление или статистические данные, относящиеся к ЭТОЙ задаче",
        fallback_hint: "Какой процесс, явление или статистические данные помогают ответить на этот вопрос?",
      };

    default:
      return {
        role,
        methodology: [
          `Методология проверки задач по предмету «${label}»:`,
          "- Опирайся на ключевые правила, термины и приёмы этого предмета.",
          "- Если задача предусматривает развёрнутый ответ — проверь наличие тезиса, аргументов, вывода.",
          "- Анти-спойлер: при ошибке направь к категории или приёму, не цитируй готовый ответ.",
        ].join("\n"),
        hint_examples: "- Опирайся на конкретное правило, приём или ключевую идею, нужную в ЭТОЙ задаче",
        fallback_hint: "На какую часть условия ты опираешься и какой приём, правило или ключевая идея подходит для этой задачи?",
      };
  }
}

// ─── Main resolver ─────────────────────────────────────────────────────────

/**
 * Resolve subject-specific rubric for AI prompt injection.
 *
 * Selects between:
 *   - physics / maths / chemistry / languages — dedicated ЕГЭ rubric files
 *   - other subjects — generic Phase 1 short rubric
 *
 * Auto-detects CEFR level for language subjects. Auto-injects ФИПИ default
 * methodology when tutor's `rubric_text` is empty; prepends tutor's rubric
 * with high-priority marker when present.
 */
export function resolveSubjectRubric(input: SubjectRubricInput): SubjectRubric {
  const subjectId = (input.subject ?? "").trim();
  const kimNumber = typeof input.kim_number === "number" ? input.kim_number : null;
  const tutorRubricRaw = typeof input.tutor_rubric === "string"
    ? input.tutor_rubric.trim()
    : "";
  const hasTutorRubric = tutorRubricRaw.length > 0;

  let core: Omit<SubjectRubric, "tutor_rubric_active" | "subject_label">;

  // P0 scope: physics / maths / chemistry / languages have dedicated rubric files.
  // ОГЭ deferred — even with exam_type='oge' we use ЕГЭ rubric (generic methodology
  // covers ОГЭ adequately for AI grading; precise ОГЭ criteria added later).
  if (subjectId === "physics") {
    core = { ...buildPhysicsEgeRubric(kimNumber), cefr_level: null };
  } else if (MATH_LIKE_SUBJECTS.has(subjectId)) {
    core = { ...buildMathEgeRubric(kimNumber), cefr_level: null };
  } else if (subjectId === "chemistry") {
    core = { ...buildChemistryEgeRubric(kimNumber), cefr_level: null };
  } else if (LANGUAGE_SUBJECTS.has(subjectId)) {
    core = buildLanguagesRubric(subjectId, input.task_text);
  } else {
    core = { ...buildGenericRubric(subjectId), cefr_level: null };
  }

  // Merge tutor_rubric (priority) with default methodology.
  let methodology = core.methodology;
  if (hasTutorRubric) {
    methodology = [
      "ПРИОРИТЕТНЫЕ КРИТЕРИИ ОТ РЕПЕТИТОРА (используй ПРЕЖДЕ ВСЕГО, при конфликте они выигрывают):",
      tutorRubricRaw,
      "",
      "ДОПОЛНИТЕЛЬНЫЕ СТАНДАРТНЫЕ КРИТЕРИИ (используй как baseline, если tutor явно их не отменил):",
      core.methodology,
    ].join("\n");
  }

  return {
    role: core.role,
    methodology,
    hint_examples: core.hint_examples,
    fallback_hint: core.fallback_hint,
    subject_label: getSubjectLabel(subjectId),
    cefr_level: core.cefr_level ?? null,
    tutor_rubric_active: hasTutorRubric,
  };
}

// Re-exports for callers that need types or label directly.
export type { CefrLevel, ExamType, SubjectRubric, SubjectRubricInput } from "./types.ts";
