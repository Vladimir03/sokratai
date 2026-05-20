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

// Phase 7 (2026-05-16) — humanities subjects где AI ОБЯЗАН использовать тот
// же словарь, что и tutor solution_text (это French / Russian / etc., нельзя
// «не цитировать»). Используется для skip anti-leak detector в check / chat
// paths, иначе false positive переводит правильный гуманитарный feedback в
// hardcoded физический fallback. См. plan `~/.claude/plans/1-functional-meteor.md`
// Phase 7 section + CLAUDE.md §22 / §40-homework-system.md.
//
// **Mirror** of `src/lib/subjectHelpers.ts::isHumanitiesWritingSubject` —
// Deno cannot import TS from src/, keep in sync.
export const HUMANITIES_SUBJECTS = new Set<string>([
  "russian",
  "rus", // legacy
  "literature",
  "english",
  "french",
  "spanish",
]);

export function isHumanitiesSubject(subject: string | null | undefined): boolean {
  const id = (subject ?? "").trim().toLowerCase();
  if (!id) return false;
  return HUMANITIES_SUBJECTS.has(id);
}

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

// ─── Compact methodology for numeric tasks (hotfix 2026-05-16) ────────────

/**
 * Hotfix 2026-05-16: для `task_kind='numeric'` (краткий ответ) AI должен
 * проверять числовое/символьное равенство ответу-эталону, БЕЗ требования
 * развёрнутого решения. Full ФИПИ methodology («I положения теории, II
 * обозначения, III преобразования, IV ответ с единицами») перекрывала
 * существующий `checkFormatGuidance` в `buildCheckPrompt` и приводила к
 * INCORRECT verdict даже на правильных коротких ответах.
 *
 * Параметр `kimNumber` сохранён для optional KIM-specific override (если
 * tutor пометил задачу как KIM 1-20 ЕГЭ физики, добавляем рекомендацию по
 * балльности группы — но не full methodology).
 */
function buildNumericMethodology(subjectId: string, kimNumber: number | null): string {
  const lines = [
    "Тип задачи: КРАТКИЙ ОТВЕТ (число / слово / формула / последовательность).",
    "Проверь, что ответ ученика совпадает с эталонным:",
    "- Числовой ответ: допускай разную запись (5 м/с / 5 / 5,0 / 5.0), запятую и точку как разделитель, единицы измерения опциональны если они подразумеваются.",
    "- Символьный ответ: точное совпадение по содержанию (порядок слов / падежей не критичен если смысл идентичен).",
    "- Последовательность цифр / букв (множественный выбор, соответствие): проверь полное совпадение порядка и состава.",
    "Развёрнутого решения здесь НЕ требуется — это краткий ответ. Не требуй от ученика записывать формулы / преобразования / обозначения.",
    "Анти-спойлер: при INCORRECT — направь к величине / приёму / правилу, но НЕ называй эталон.",
  ];

  // Optional KIM nudge — short hint про балльность группы без full methodology.
  if (subjectId === "physics" && typeof kimNumber === "number") {
    if ([1, 2, 3, 4, 7, 8, 11, 12, 13, 16, 19, 20].includes(kimNumber)) {
      lines.push(`Это задание № ${kimNumber} ЕГЭ физики (1 балл) — полное совпадение с эталоном.`);
    } else if ([6, 10, 15, 17].includes(kimNumber)) {
      lines.push(
        `Это задание № ${kimNumber} ЕГЭ физики (2 балла, символ-в-символ): полный матч → 2 балла; одна позиция отличается → 1 балл; иначе 0.`,
      );
    } else if ([5, 9, 14, 18].includes(kimNumber)) {
      lines.push(
        `Это задание № ${kimNumber} ЕГЭ физики (2 балла, множественный выбор, порядок не важен): все символы есть, лишних нет → 2; один лишний ИЛИ один пропущенный → 1; иначе 0.`,
      );
    }
  }

  return lines.join("\n");
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
 *
 * Hotfix 2026-05-16: для `task_kind='numeric'` (краткий ответ, `check_format=
 * 'short_answer'`) full ФИПИ methodology для развёрнутых задач **не** инжектится —
 * вместо неё compact one-line «проверь числовое равенство эталону». Без этого
 * AI получал блок «должны быть записаны (I) законы, (II) обозначения, (III)
 * преобразования, (IV) ответ с единицами» из `physics-ege.ts::GENERIC_METHODOLOGY`
 * и требовал развёрнутое решение даже на 5-символьный ответ. Регрессия вошла
 * 2026-05-15 commit `ea41a39`. Role и hint_examples остаются subject-aware
 * (это безопасный subject context, не conflicts с numeric verdict).
 */
export function resolveSubjectRubric(input: SubjectRubricInput): SubjectRubric {
  const subjectId = (input.subject ?? "").trim();
  const kimNumber = typeof input.kim_number === "number" ? input.kim_number : null;
  const tutorRubricRaw = typeof input.tutor_rubric === "string"
    ? input.tutor_rubric.trim()
    : "";
  const hasTutorRubric = tutorRubricRaw.length > 0;
  const isNumeric = input.task_kind === "numeric";

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

  // Hotfix 2026-05-16: numeric task_kind → swap full ФИПИ methodology с
  // compact one-liner. Это критично для tutor-задач с `check_format='short_answer'`
  // где ученик пишет 5 м/с / «225» / «верно», а не развёрнутое решение.
  // Применяется ДО merge с tutor_rubric — если tutor хочет full criteria,
  // он пишет их в `rubric_text` (tutor priority всё равно won).
  if (isNumeric && !LANGUAGE_SUBJECTS.has(subjectId)) {
    core = {
      ...core,
      methodology: buildNumericMethodology(subjectId, kimNumber),
    };
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
