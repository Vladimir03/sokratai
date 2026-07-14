/**
 * Languages — rubric блоки для AI grading.
 *
 * Поддерживаемые форматы (P0 — production écrite):
 *   - ЕГЭ английский № 38 (личное письмо, 6 баллов, K1-K3)
 *   - ЕГЭ английский № 39 (эссе, 14 баллов, K1-K5)
 *   - ОГЭ английский — письмо (10 баллов, К1-К3) — добавлено voice-speaking-mvp TASK-2
 *   - DELF B1 production écrite (25 баллов, 8 критериев)
 *   - DELF B2 production écrite (25 баллов, 8 критериев — строже)
 *   - IELTS Writing Task 1/2 (band 1-9, 4 критерия)
 *
 * Поддерживаемые форматы (P0 — production orale, voice-speaking-mvp TASK-2):
 *   - DELF B1 production orale (Expression d'un point de vue, 5-7 min)
 *   - DELF B2 production orale (Exposé / présentation, 6-8 min, строже)
 *   - ЕГЭ английский — устная часть Task 3 (тематическое монологическое
 *     высказывание, 7 баллов)
 *   - ОГЭ английский — устная часть Task 3 (монолог, 6 баллов)
 *
 * Auto-detect формата из task_text через cefr-detector + дополнительные
 * regex'ы (письмо vs эссе vs монолог, IELTS Task 1 vs Task 2). Если не
 * сматчили — generic language methodology + CEFR-aware ожидания по объёму.
 *
 * Не покрыто в P0 (явно): DELE испанский, TOEFL Writing, китайский HSK,
 * etc. — fallback на generic language rubric.
 *
 * Phonétique / произношение помечается `kind: 'tutor_only'` в шаблоне
 * critериев — AI не штрафует за произношение, репетитор оценивает на слух
 * из сохранённого аудио (spec §3, voice-speaking-mvp).
 */

import { detectCefrLevel } from "./cefr-detector.ts";
import type { CefrLevel, SubjectCriterionTemplate, SubjectRubric } from "./types.ts";

// ─── Format detection ──────────────────────────────────────────────────────

type LanguageFormat =
  | "ege-en-letter" // № 38
  | "ege-en-essay" // № 39
  | "ege-en-monologue" // Task 3 устной части ЕГЭ (voice-speaking-mvp)
  | "oge-en-letter" // ОГЭ письмо (voice-speaking-mvp)
  | "oge-en-monologue" // ОГЭ устная часть Task 3 (voice-speaking-mvp)
  | "delf-a1-ecrite" // DELF A1 production écrite (2026-07-14, запрос Эмилии)
  | "delf-a2-ecrite" // DELF A2 production écrite (CEFR-level fix 2026-05-29)
  | "delf-b1-ecrite" // DELF B1 production écrite
  | "delf-b2-ecrite" // DELF B2 production écrite
  | "delf-a1-orale" // DELF A1 production orale (2026-07-14, запрос Эмилии)
  | "delf-a2-orale" // DELF A2 production orale (CEFR-level fix 2026-05-29)
  | "delf-b1-orale" // DELF B1 production orale (voice-speaking-mvp)
  | "delf-b2-orale" // DELF B2 production orale (voice-speaking-mvp)
  | "ielts-task1" // IELTS Writing Task 1 (graph / data description)
  | "ielts-task2" // IELTS Writing Task 2 (essay)
  | "generic"; // fallback

interface FormatDetection {
  format: LanguageFormat;
  cefr: CefrLevel;
}

/**
 * Unicode-aware token presence check.
 *
 * JS `\b` treats only ASCII [A-Za-z0-9_] as word chars, so /\bмонолог/ or
 * /\bэссе\b/ NEVER match Cyrillic (review fix 2026-05-27 — this silently
 * routed ЕГЭ essays to the letter template and broke ОГЭ / oral detection).
 * We use \p{L}/\p{N} lookarounds for a script-agnostic boundary. Server-side
 * / Deno only → Unicode lookbehind is safe (not the Safari cross-browser path).
 *
 * `pattern` is an inner regex source (may contain alternations / `\s`).
 */
function hasWord(text: string, pattern: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/**
 * Voice-speaking-mvp TASK-2: detect oral / monologue intent from `task_text`.
 * Triggered by «монолог», «устн…», «production orale», «exposé»,
 * «expression orale», «speaking», «Task 3 / Таск 3», etc.
 *
 * Boundary-anchored via `hasWord` so «грустная» does NOT match «устн» and
 * Cyrillic tokens trigger correctly.
 */
function isOralFormat(text: string): boolean {
  if (!text) return false;
  return (
    hasWord(text, "монолог[а-яё]*") ||
    hasWord(text, "устн[а-яё]*") ||
    hasWord(text, "говорение") ||
    hasWord(text, "production\\s+orale") ||
    hasWord(text, "expression\\s+orale") ||
    hasWord(text, "expos[éе][а-яё]*") ||
    hasWord(text, "épreuve\\s+orale") ||
    hasWord(text, "speaking") ||
    hasWord(text, "Task\\s*3") ||
    hasWord(text, "Таск\\s*3")
  );
}

function detectLanguageFormat(
  subject: string,
  taskText: string | null | undefined,
  forceOral = false,
  forcedCefr?: CefrLevel | null,
): FormatDetection {
  const text = (taskText ?? "").trim();
  // CEFR-level fix (2026-05-29): explicit tutor level (`forcedCefr`, из селектора
  // «Уровень») ПОБЕЖДАЕТ текст-эвристику. Раньше уровень угадывался только из
  // task_text → дефолт B1 → A2/B2-задачи грейдились по B1 (баг Эмилии).
  const cefr: CefrLevel = forcedCefr ?? detectCefrLevel(text).level;
  // voice-speaking-mvp fix #2: explicit task_kind='speaking' forces oral format —
  // не полагаемся только на текст-эвристику isOralFormat (sujet может не содержать
  // ключевых слов «монолог»/«orale», но запись голоса — однозначно устная).
  const oralIntent = forceOral || isOralFormat(text);

  // IELTS — самый специфичный (явно упомянут в тексте). IELTS speaking
  // намеренно не покрыт в P0 — fallback на generic.
  if (/\bIELTS\b/i.test(text)) {
    if (/\bTask\s*1\b/i.test(text) || /\b(graph|chart|diagram|table|process)\b/i.test(text)) {
      return { format: "ielts-task1", cefr };
    }
    return { format: "ielts-task2", cefr };
  }

  // DELF (французский). CEFR-level fix: `cefr` (forcedCefr или из текста)
  // маршрутизирует прямо в рубрику уровня. A2 теперь имеет собственную рубрику —
  // раньше проваливался в B1.
  if (subject === "french") {
    if (cefr === "A1") {
      return {
        format: oralIntent ? "delf-a1-orale" : "delf-a1-ecrite",
        cefr: "A1",
      };
    }
    if (cefr === "A2") {
      return {
        format: oralIntent ? "delf-a2-orale" : "delf-a2-ecrite",
        cefr: "A2",
      };
    }
    // C1 пока без выделенной DELF-рубрики → ближайшая существующая B2 (вне
    // пилотного scope; селектор предлагает A2/B1/B2).
    if (/\bDELF\s*B2\b/i.test(text) || cefr === "B2" || cefr === "C1") {
      return {
        format: oralIntent ? "delf-b2-orale" : "delf-b2-ecrite",
        cefr: "B2",
      };
    }
    if (/\bDELF\s*B1\b/i.test(text) || cefr === "B1") {
      return {
        format: oralIntent ? "delf-b1-orale" : "delf-b1-ecrite",
        cefr: "B1",
      };
    }
    return {
      format: oralIntent ? "delf-b1-orale" : "delf-b1-ecrite",
      cefr: "B1",
    };
  }

  // ЕГЭ / ОГЭ английский.
  // Cyrillic tokens go through `hasWord` (Unicode boundary) — plain /\bОГЭ\b/
  // never matched (ASCII \b), which is why every English task fell to ОГЭ +
  // letter before this fix (review 2026-05-27).
  if (subject === "english") {
    const isOge = hasWord(text, "ОГЭ") || cefr === "A2" || cefr === "B1";
    if (oralIntent) {
      return {
        format: isOge ? "oge-en-monologue" : "ege-en-monologue",
        cefr,
      };
    }
    if (
      hasWord(text, "письм[оаеуы]") ||
      hasWord(text, "личное\\s+письмо") ||
      hasWord(text, "email") ||
      hasWord(text, "electronic\\s+letter") ||
      hasWord(text, "задание\\s*38")
    ) {
      return {
        format: isOge ? "oge-en-letter" : "ege-en-letter",
        cefr,
      };
    }
    if (
      hasWord(text, "эссе") ||
      hasWord(text, "essay") ||
      hasWord(text, "развёрнут[а-яё]+\\s+высказыван[а-яё]+") ||
      hasWord(text, "writing\\s+task") ||
      hasWord(text, "задание\\s*39")
    ) {
      return { format: "ege-en-essay", cefr };
    }
    // Default for English без явных меток — letter (more common for B1/B2 students).
    return {
      format: cefr === "B2" ? "ege-en-essay" : isOge ? "oge-en-letter" : "ege-en-letter",
      cefr,
    };
  }

  return { format: "generic", cefr };
}

// ─── Format rubrics ────────────────────────────────────────────────────────

const ROLE_BY_SUBJECT: Record<string, string> = {
  english: "Ты — наставник по предмету «Английский язык». Проверяешь письменное задание ученика по критериям ФИПИ ЕГЭ / ОГЭ или международного теста.",
  french: "Ты — наставник по предмету «Французский язык». Проверяешь production écrite ученика по критериям DELF.",
  spanish: "Ты — наставник по предмету «Испанский язык». Проверяешь письменное задание ученика по критериям DELE.",
};

const DEFAULT_ROLE = "Ты — наставник по иностранному языку. Проверяешь письменное задание ученика по соответствующим критериям экзамена.";

// ─── Response language instruction (Phase 11, 2026-05-31) ───────────────────
//
// Баг Эмилии (FR/DELF): AI отвечает одному ученику по-русски, другому по-французски
// на одном ДЗ — нет детерминированной инструкции языка ответа. Резолвится из
// assignment-level `feedback_language` + per-task `cefr_level`:
//   'russian' → объяснения по-русски (примеры на изучаемом)
//   'target'  → полная иммерсия на изучаемом
//   'auto'    → A1/A2 → русский, B1+ → изучаемый (педагогический стандарт)
//
// Возвращает null для не-языковых subjects (физика/математика не трогаем).

const TARGET_LANG_LOCATIVE: Record<string, string> = {
  french: "французском",
  english: "английском",
  spanish: "испанском",
};

export function buildResponseLanguageInstruction(
  subjectId: string,
  cefr: CefrLevel,
  feedbackLanguage: "auto" | "russian" | "target",
): string | null {
  const targetLoc = TARGET_LANG_LOCATIVE[subjectId];
  if (!targetLoc) return null; // не языковой subject

  // Резолвим эффективный язык: явный override > авто-по-уровню.
  const useTarget = feedbackLanguage === "target"
    ? true
    : feedbackLanguage === "russian"
    ? false
    : cefr !== "A2" && cefr !== "A1"; // auto: A1/A2 → русский, B1/B2/C1 → изучаемый

  if (useTarget) {
    return [
      `ЯЗЫК ОТВЕТА (СТРОГО): отвечай ПОЛНОСТЬЮ на ${targetLoc} языке.`,
      `Даже если ученик пишет по-русски — твой feedback, объяснения, наводящие вопросы и примеры все на ${targetLoc} языке.`,
      `Это языковая иммерсия (уровень ${cefr}): ученик должен читать обратную связь на изучаемом языке.`,
      "Исключение: одно-два ключевых грамматических термина можно продублировать по-русски в скобках, если правило сложное.",
    ].join("\n");
  }
  return [
    "ЯЗЫК ОТВЕТА (СТРОГО): давай объяснения и feedback ПО-РУССКИ.",
    `Уровень ${cefr}: ученик ещё не воспринимает метаязык (грамматические термины, разбор ошибок) на изучаемом языке — объясняй по-русски.`,
    `Примеры, образцы фраз и исправленные предложения приводи на ${targetLoc} языке (это то, что ученик учит).`,
    `Структура ответа: объяснение по-русски → конкретный пример / исправление на ${targetLoc} языке.`,
  ].join("\n");
}

const HINT_EXAMPLES =
  "- Упоминай конкретное грамматическое правило (время, согласование, инверсия), синтаксическую конструкцию, элемент лексики или критерий оценки (соответствие заданию, организация текста, языковое оформление), применимый к ЭТОЙ задаче";

const FALLBACK_HINT =
  "Какое грамматическое правило, время или конструкция подходят для этого предложения, и какие слова или критерии задания дают подсказку?";

const METHODOLOGY_EGE_EN_LETTER = [
  "ЕГЭ английский № 38 — Личное письмо (180-200 слов, макс. 6 баллов).",
  "К1 (Решение коммуникативной задачи, 0-2): даны ответы на 3 вопроса друга + заданы 3 встречных вопроса по теме. -1 за каждый отсутствующий ответ или вопрос; -1 за неточный ответ.",
  "К2 (Организация текста, 0-2): обращение, прощание, абзацы (вступление + основная часть + заключение), средства логической связи (however, therefore, in addition…).",
  "К3 (Языковое оформление, 0-2): не более 2 негрубых ошибок (лексических / грамматических / орфографических); ошибки, искажающие смысл, оцениваются жёстче.",
  "Объём 180-200 слов; -1 балл по К1 за объём 90-179 (менее 90 → 0 за всё письмо).",
  "Типичные ошибки: пропущено приветствие/прощание; вопросы заданы не по теме; искажение фактов из исходного письма.",
].join("\n");

const METHODOLOGY_EGE_EN_ESSAY = [
  "ЕГЭ английский № 39 — Развёрнутое высказывание / эссе (200-250 слов, макс. 14 баллов).",
  "К1 (Решение задачи, 0-3): план полностью раскрыт; высказана собственная точка зрения с аргументами; рассмотрено противоположное мнение и приведены причины несогласия.",
  "К2 (Организация, 0-3): структура (вступление → аргументы за / против → заключение); деление на абзацы; средства логической связи.",
  "К3 (Лексика, 0-3): разнообразие лексики (синонимы, идиомы, академическая); точность словоупотребления.",
  "К4 (Грамматика, 0-3): разнообразие грамматических конструкций (условные, страдательный залог, инверсия, complex sentences); минимум ошибок.",
  "К5 (Орфография и пунктуация, 0-2): полное соответствие правилам.",
  "Объём 200-250 слов; -1 балл при отклонении ±10%.",
].join("\n");

const METHODOLOGY_DELF_B1_ECRITE = [
  "DELF B1 — Production écrite (160-180 mots, 25 баллов, 8 критериев).",
  "1. Respect de la consigne / соответствие заданию (2 балла): тип текста (lettre / forum / article), количество слов, соответствие теме.",
  "2. Capacité à présenter des faits / описание фактов (4 балла): связное изложение событий, фактов в логической последовательности.",
  "3. Capacité à exprimer sa pensée / выражение мнения (4 балла): собственная точка зрения, обоснование, использование maturité argumentative.",
  "4. Cohérence et cohésion / связность (3 балла): mots de liaison (donc, alors, c'est pourquoi, en effet, …), разбивка на абзацы, логические переходы.",
  "5. Lexique étendue / разнообразие лексики (2 балла): достаточный словарный запас для темы B1.",
  "6. Lexique maîtrise / точность лексики (2 балла): правильное использование слов, минимум ошибок.",
  "7. Morphosyntaxe étendue / разнообразие грамматических структур (4 балла): времена (présent / passé composé / imparfait / futur simple), модальные глаголы, относительные местоимения (qui / que / dont).",
  "8. Morphosyntaxe maîtrise / точность грамматики (4 балла): спряжения, согласование рода и числа, акценты, артикли.",
  "Минимум 160 слов. Меньше → штраф по критерию 1.",
].join("\n");

const METHODOLOGY_DELF_B2_ECRITE = [
  "DELF B2 — Production écrite (250 mots minimum, 25 баллов, 8 критериев).",
  "Те же 8 критериев, что у B1, но уровень требований выше:",
  "1. Respect de la consigne (2): аргументированное эссе / лекторская речь / формальное письмо — точное соответствие жанру.",
  "2. Capacité à présenter des faits / arguments (4): развёрнутая аргументация с примерами, цитатами, статистикой.",
  "3. Capacité à exprimer sa pensée (4): нюансированная позиция, contre-argument, выводы.",
  "4. Cohérence et cohésion (3): сложные mots de liaison (toutefois, néanmoins, en revanche), плавные переходы между абзацами.",
  "5. Lexique étendue (2): академический регистр, expressions idiomatiques, синонимы.",
  "6. Lexique maîtrise (2): точное словоупотребление, без faux-amis.",
  "7. Morphosyntaxe étendue (4): subjonctif présent / passé, conditionnel passé, plus-que-parfait, сложные относительные местоимения (lequel / duquel).",
  "8. Morphosyntaxe maîtrise (4): полное согласование времён, accord du participe passé с avoir, accents и пунктуация.",
  "Минимум 250 слов.",
].join("\n");

// CEFR-level fix (2026-05-29). DRAFT — валидирует Эмилия на первых работах.
// Уровень A2: простые связные тексты о повседневных темах; НЕ требуй
// аргументации/нюансов/subjonctif уровня B1+ (это завышение планки = баг Эмилии).
const METHODOLOGY_DELF_A2_ECRITE = [
  "DELF A2 — Production écrite (60-80 mots, 25 баллов). Уровень A2: простые связные тексты о повседневных ситуациях (décrire, raconter, inviter, remercier, s'excuser).",
  "1. Respect de la consigne (2 балла): тип текста (carte postale / message / courriel court), тема и объём соблюдены.",
  "2. Capacité à décrire / raconter (4 балла): простое изложение событий, опыта, планов в логичном порядке.",
  "3. Capacité à interagir (4 балла): уместные речевые формулы (inviter, remercier, s'excuser, proposer), социальная адекватность.",
  "4. Cohérence et cohésion (3 балла): простые связки (et, mais, parce que, puis, alors), деление на предложения.",
  "5. Lexique étendue (2 балла): достаточный элементарный словарь для темы A2.",
  "6. Lexique maîtrise (2 балла): орфография частотных слов, ошибки не искажают смысл.",
  "7. Morphosyntaxe étendue (4 балла): présent, passé composé, futur proche, impératif; простые предлоги и артикли.",
  "8. Morphosyntaxe maîtrise (4 балла): спряжение частотных глаголов, простые согласования рода/числа.",
  "ВАЖНО: на A2 НЕ требуй сложной аргументации, subjonctif, нюансов B1/B2.",
].join("\n");

// A1-уровень (2026-07-14, запрос Эмилии). DRAFT — валидирует Эмилия на первых
// работах. САМЫЙ начальный уровень: короткие простые фразы о себе и повседневности,
// présent, ~40 слов. НЕ требуй passé composé/futur, аргументации, объёма A2+.
const METHODOLOGY_DELF_A1_ECRITE = [
  "DELF A1 — Production écrite (~40 mots, 25 баллов). Уровень A1: самые простые короткие тексты о себе и повседневности (carte postale, message court, fiche / formulaire, несколько простых фраз).",
  "1. Respect de la consigne (2 балла): тип текста (carte postale / message / fiche), тема и объём (~40 слов) соблюдены.",
  "2. Capacité à décrire / informer (4 балла): очень простое сообщение о себе, семье, вкусах, планах — короткими фразами.",
  "3. Capacité à interagir (4 балла): базовые речевые формулы (saluer, se présenter, remercier, inviter простыми словами).",
  "4. Cohérence et cohésion (3 балла): элементарные связки (et, mais, parce que) и знаки препинания; связь между фразами минимальна — это нормально для A1.",
  "5. Lexique étendue (2 балла): элементарный словарь A1 (la famille, les loisirs, les nombres, les jours, les goûts) достаточен для темы.",
  "6. Lexique maîtrise (2 балла): орфография самых частотных слов; ошибки допустимы, если смысл понятен.",
  "7. Morphosyntaxe étendue (4 балла): présent частотных глаголов (être, avoir, aller, faire, verbes en -er), простые артикли и предлоги.",
  "8. Morphosyntaxe maîtrise (4 балла): базовое спряжение в présent, простое согласование рода/числа. Ошибки нормальны для A1.",
  "ВАЖНО: на A1 НЕ требуй passé composé / futur, аргументации, сложных связок или объёма A2+ (~40 слов достаточно). Оценивай доброжелательно — это начальный уровень.",
].join("\n");

// ⚠ IELTS использует AVERAGE-агрегацию (overall band = среднее 4 критериев,
// НЕ сумма). Текущий sanitizer (`sanitizeCriteriaBreakdown`) поддерживает
// только additive (sum) рубрики. Поэтому IELTS отдаёт `criteria = null` —
// per-criterion breakdown НЕ рендерится, ученик/репетитор видят только
// overall `ai_score` (band). Methodology остаётся для grading'а ai_score.
// Включить breakdown для IELTS можно после поддержки average-агрегации
// (review fix 2026-05-27, P1 #2). НЕ возвращать additive CRITERIA_IELTS_*
// в getLanguagesMethodology без average-aware sanitizer'а.
const METHODOLOGY_IELTS_TASK1 = [
  "IELTS Writing Task 1 — Описание графика / диаграммы / процесса (150+ слов, 20 минут, band 1-9).",
  "Task Achievement (TA): полностью описаны все ключевые тенденции / точки данных; есть общий overview (key features), нет искажений данных.",
  "Coherence and Cohesion (CC): абзацы (intro + overview + 2 body paragraphs), linking words (firstly / in contrast / overall / in conclusion).",
  "Lexical Resource (LR): разнообразие словаря описания трендов (rise / decline / fluctuate / plateau), синонимы, минимум ошибок.",
  "Grammatical Range and Accuracy (GRA): разнообразие предложений (simple / compound / complex), правильность времён (past simple для исторических данных, future formers для прогнозов).",
  "Каждый критерий band 1-9; общая band = СРЕДНЕЕ, округлённое до ближайшей полу-band (НЕ сумма).",
  "ai_score = overall band 1-9.",
].join("\n");

const METHODOLOGY_IELTS_TASK2 = [
  "IELTS Writing Task 2 — Эссе с аргументацией (250+ слов, 40 минут, band 1-9).",
  "Task Response (TR): полностью ответил на вопрос (Agree/Disagree / Discuss both views / Advantages-Disadvantages / Problem-Solution); есть clear position; развёрнутые аргументы с примерами.",
  "Coherence and Cohesion (CC): чёткая структура (intro + 2-3 body paragraphs + conclusion); linking words; topic sentence в каждом абзаце.",
  "Lexical Resource (LR): академический регистр, разнообразие, идиоматические выражения, точность.",
  "Grammatical Range and Accuracy (GRA): разнообразие conditional / passive / complex sentences; минимум grammatical errors.",
  "Band 1-9 за каждый критерий; overall band = СРЕДНЕЕ 4 критериев (НЕ сумма); band 7+ требует near-native accuracy.",
  "ai_score = overall band 1-9.",
].join("\n");

const METHODOLOGY_GENERIC_LANG = (cefr: CefrLevel) =>
  [
    `Методология проверки письменного задания по иностранному языку (целевой уровень CEFR ${cefr}):`,
    "- Соответствие заданию: тема раскрыта, формат соблюдён (письмо / эссе / описание), требования к объёму выполнены.",
    "- Грамматика: правильность времён, согласований, конструкций, соответствующих уровню.",
    "- Лексика: разнообразие, точность словоупотребления, соответствие регистру (формальный / неформальный).",
    "- Связность: логическая структура, абзацы, средства связи между предложениями.",
    "- Орфография и пунктуация: соответствие нормам языка.",
    "- Анти-спойлер: при ошибке укажи категорию (грамматика / лексика / структура) и наводящий вопрос — не дописывай предложения за ученика.",
  ].join("\n");

// ─── Production orale methodologies (voice-speaking-mvp TASK-2) ────────────

const METHODOLOGY_DELF_B1_ORALE = [
  "DELF B1 — Production orale, Expression d'un point de vue (5-7 minutes, 25 баллов).",
  "AI оценивает по транскрипту речи (4 critères, 25 баллов), произношение оценивает репетитор на слух.",
  "1. Capacité à présenter et défendre un point de vue (5 баллов): представлен ясный тезис, аргументация развёрнута, есть примеры/иллюстрации.",
  "2. Capacité à réagir et à dialoguer (4 балла): реакция на возможный документ/тему гибкая, ответ структурирован.",
  "3. Lexique étendue + maîtrise (4+2 = 6 баллов): достаточный словарь B1 + точность словоупотребления, минимум faux-amis.",
  "4. Morphosyntaxe étendue + maîtrise (4+4 = 8 баллов): времена (présent / passé composé / imparfait / futur), модальные глаголы, относительные местоимения; согласования и спряжения.",
  "5. Maîtrise du système phonologique (2 балла) — оценивает РЕПЕТИТОР, AI пропускает.",
  "Длительность: 5-7 минут. Очень короткий ответ (< 2 минут) → потери по критерию 1.",
].join("\n");

const METHODOLOGY_DELF_B2_ORALE = [
  "DELF B2 — Production orale, Exposé (présentation + débat, 6-8 minutes, 25 баллов).",
  "AI оценивает по транскрипту, произношение оценивает репетитор.",
  "1. Capacité à présenter un point de vue argumenté (5 баллов): ясный план (вступление → 2-3 тезиса → заключение), nuance.",
  "2. Capacité à réagir et à interagir (4 балла): уверенные ответы на provoking questions, способность contre-arguments.",
  "3. Lexique étendue + maîtrise (3+2 = 5 баллов): академический регистр, expressions idiomatiques, точность.",
  "4. Morphosyntaxe étendue + maîtrise (3+3 = 6 баллов): subjonctif présent/passé, conditionnel passé, plus-que-parfait; согласование времён.",
  "5. Maîtrise du système phonologique (2 балла) — оценивает РЕПЕТИТОР, AI пропускает.",
  "Длительность: 6-8 минут. Поверхностная аргументация без nuance → потери по критерию 1.",
].join("\n");

// CEFR-level fix (2026-05-29). DRAFT — валидирует Эмилия.
const METHODOLOGY_DELF_A2_ORALE = [
  "DELF A2 — Production orale, monologue suivi (простая презентация знакомой темы, 25 баллов).",
  "AI оценивает по транскрипту (23 балла), произношение оценивает репетитор на слух.",
  "1. Capacité à présenter / décrire un sujet familier (5 баллов): простое связное высказывание о себе / повседневной теме.",
  "2. Capacité à interagir / répondre (4 балла): понятные ответы на простые вопросы.",
  "3. Lexique étendue + maîtrise (4+2 = 6 баллов): элементарный словарь повседневных тем + базовая точность.",
  "4. Morphosyntaxe étendue + maîtrise (4+4 = 8 баллов): présent, passé composé, futur proche; простые согласования и спряжения.",
  "5. Système phonologique (2 балла) — оценивает РЕПЕТИТОР, AI пропускает.",
  "ВАЖНО: на A2 НЕ требуй развёрнутой аргументации / дебатов — достаточно простого связного монолога.",
].join("\n");

// A1-уровень (2026-07-14, запрос Эмилии). DRAFT — валидирует Эмилия.
const METHODOLOGY_DELF_A1_ORALE = [
  "DELF A1 — Production orale, monologue très simple (se présenter, parler de soi, 25 баллов).",
  "AI оценивает по транскрипту (23 балла), произношение оценивает репетитор на слух.",
  "1. Capacité à se présenter / parler de soi (5 баллов): простые фразы о себе, семье, вкусах, повседневных занятиях.",
  "2. Capacité à répondre à des questions simples (4 балла): понятные ответы на элементарные вопросы (nom, âge, goûts, habitudes).",
  "3. Lexique étendue + maîtrise (4+2 = 6 баллов): элементарный словарь повседневных тем + базовая точность.",
  "4. Morphosyntaxe étendue + maîtrise (4+4 = 8 баллов): présent частотных глаголов; простые согласования рода/числа.",
  "5. Système phonologique (2 балла) — оценивает РЕПЕТИТОР, AI пропускает.",
  "ВАЖНО: на A1 достаточно очень простого монолога о себе; НЕ требуй развёрнутых тем, passé composé или аргументации.",
].join("\n");

const METHODOLOGY_EGE_EN_MONOLOGUE = [
  // ⚠ ВЕРИФИКАЦИЯ ФИПИ: точная балльность Task 3 устной части могла меняться
  // по годам. Methodology и CRITERIA_EGE_EN_MONOLOGUE держим численно
  // согласованными (содержание 7 = К1 3 + К2 2 + К3 2; произношение 1 —
  // репетитор). Если ФИПИ-источник даст другой расклад — править ОБА вместе.
  "ЕГЭ английский — Устная часть Task 3 (тематическое монологическое высказывание, 12-15 предложений, 2 минуты).",
  "AI оценивает содержание по транскрипту (7 баллов = К1 3 + К2 2 + К3 2); произношение (1 балл) оценивает репетитор.",
  "К1 (Решение коммуникативной задачи, 0-3): раскрыты все 4 аспекта плана; есть вступление и заключение; 12-15 предложений.",
  "К2 (Организация высказывания, 0-2): логичность, связность, использование средств логической связи (firstly, however, in conclusion).",
  "К3 (Языковое оформление, 0-2): лексическое разнообразие + грамматическая сложность (Present Perfect, Conditional, Passive); 0-2 негрубых ошибки.",
  "Произношение (0-1) — оценивает РЕПЕТИТОР, AI пропускает.",
  "Длительность: 2 минуты. Короче 12 предложений или меньше минуты → потери по К1.",
].join("\n");

const METHODOLOGY_OGE_EN_MONOLOGUE = [
  "ОГЭ английский — Устная часть Task 3 (монолог по теме, 10-12 предложений, 2 минуты, макс. 6 баллов).",
  "AI оценивает содержание по транскрипту (5 баллов), произношение оценивает репетитор (1 балл).",
  "К1 (Решение коммуникативной задачи, 0-2): раскрыты все аспекты плана; объём 10-12 предложений.",
  "К2 (Организация высказывания, 0-2): связность, средства логической связи (and, but, because, so), вступление и заключение.",
  "К3 (Языковое оформление, 0-1): минимум грубых ошибок; уровень А2-B1.",
  "Произношение (0-1) — оценивает РЕПЕТИТОР, AI пропускает.",
  "Длительность: 2 минуты. Слишком коротко (< 10 предложений) → потери по К1.",
].join("\n");

const METHODOLOGY_OGE_EN_LETTER = [
  // ⚠ ВЕРИФИКАЦИЯ ФИПИ: methodology и CRITERIA_OGE_EN_LETTER держим численно
  // согласованными (8 = К1 3 + К2 2 + К3 3). Прежняя строка «макс. 10»
  // противоречила template Σ=8 (review fix 2026-05-27, P1 #2). Если
  // ФИПИ-источник подтвердит другой максимум — править ОБА вместе.
  "ОГЭ английский — Личное письмо (100-120 слов, макс. 8 баллов = К1 3 + К2 2 + К3 3).",
  "К1 (Решение коммуникативной задачи, 0-3): даны ответы на все вопросы письма + заданы 3 встречных вопроса по теме.",
  "К2 (Организация текста, 0-2): обращение, прощание, подпись; абзацы; средства логической связи.",
  "К3 (Языковое оформление, 0-3): не более 4 негрубых ошибок (лексических / грамматических / орфографических).",
  "Объём 100-120 слов; -1 балл по К1 за объём 50-99 (менее 50 → 0 за всё письмо).",
].join("\n");

// ─── Criteria breakdown templates (voice-speaking-mvp TASK-2) ──────────────
//
// Для каждого формата языкового задания — структурированный список
// критериев с именами и max-баллами. AI обязан разложить итоговый балл
// по этим именованным критериям в поле `criteria_breakdown`. Sum of
// scores == ai_score (validated / normalized in sanitizeCheckResult).
//
// Phonétique / произношение помечены `kind: 'tutor_only'` — AI выводит
// их в breakdown'е, но обязан НЕ штрафовать (score = max или пометить
// "—"); финальную оценку этого критерия ставит репетитор на слух.

const CRITERIA_EGE_EN_LETTER: SubjectCriterionTemplate[] = [
  { label: "К1: Решение коммуникативной задачи", max: 2 },
  { label: "К2: Организация текста", max: 2 },
  { label: "К3: Языковое оформление", max: 2 },
];

const CRITERIA_EGE_EN_ESSAY: SubjectCriterionTemplate[] = [
  { label: "К1: Решение задачи", max: 3 },
  { label: "К2: Организация", max: 3 },
  { label: "К3: Лексика", max: 3 },
  { label: "К4: Грамматика", max: 3 },
  { label: "К5: Орфография и пунктуация", max: 2 },
];

const CRITERIA_OGE_EN_LETTER: SubjectCriterionTemplate[] = [
  { label: "К1: Решение коммуникативной задачи", max: 3 },
  { label: "К2: Организация текста", max: 2 },
  { label: "К3: Языковое оформление", max: 3 },
];

const CRITERIA_EGE_EN_MONOLOGUE: SubjectCriterionTemplate[] = [
  { label: "К1: Решение коммуникативной задачи", max: 3 },
  { label: "К2: Организация высказывания", max: 2 },
  { label: "К3: Языковое оформление", max: 2 },
  { label: "Произношение", max: 1, kind: "tutor_only" },
];

const CRITERIA_OGE_EN_MONOLOGUE: SubjectCriterionTemplate[] = [
  { label: "К1: Решение коммуникативной задачи", max: 2 },
  { label: "К2: Организация высказывания", max: 2 },
  { label: "К3: Языковое оформление", max: 1 },
  { label: "Произношение", max: 1, kind: "tutor_only" },
];

const CRITERIA_DELF_B1_ECRITE: SubjectCriterionTemplate[] = [
  { label: "Respect de la consigne", max: 2 },
  { label: "Capacité à présenter des faits", max: 4 },
  { label: "Capacité à exprimer sa pensée", max: 4 },
  { label: "Cohérence et cohésion", max: 3 },
  { label: "Lexique étendue", max: 2 },
  { label: "Lexique maîtrise", max: 2 },
  { label: "Morphosyntaxe étendue", max: 4 },
  { label: "Morphosyntaxe maîtrise", max: 4 },
];

const CRITERIA_DELF_B2_ECRITE: SubjectCriterionTemplate[] = [
  { label: "Respect de la consigne", max: 2 },
  { label: "Capacité à présenter des faits / arguments", max: 4 },
  { label: "Capacité à exprimer sa pensée", max: 4 },
  { label: "Cohérence et cohésion", max: 3 },
  { label: "Lexique étendue", max: 2 },
  { label: "Lexique maîtrise", max: 2 },
  { label: "Morphosyntaxe étendue", max: 4 },
  { label: "Morphosyntaxe maîtrise", max: 4 },
];

const CRITERIA_DELF_B1_ORALE: SubjectCriterionTemplate[] = [
  { label: "Présenter et défendre un point de vue", max: 5 },
  { label: "Réagir et dialoguer", max: 4 },
  { label: "Lexique étendue", max: 4 },
  { label: "Lexique maîtrise", max: 2 },
  { label: "Morphosyntaxe étendue", max: 4 },
  { label: "Morphosyntaxe maîtrise", max: 4 },
  { label: "Système phonologique", max: 2, kind: "tutor_only" },
];

const CRITERIA_DELF_B2_ORALE: SubjectCriterionTemplate[] = [
  { label: "Présenter un point de vue argumenté", max: 5 },
  { label: "Réagir et interagir", max: 4 },
  { label: "Lexique étendue", max: 3 },
  { label: "Lexique maîtrise", max: 2 },
  { label: "Morphosyntaxe étendue", max: 3 },
  { label: "Morphosyntaxe maîtrise", max: 3 },
  { label: "Maîtrise des outils argumentatifs", max: 3 },
  { label: "Système phonologique", max: 2, kind: "tutor_only" },
];

// CEFR-level fix (2026-05-29). DRAFT — валидирует Эмилия. Σ = 25 (écrite),
// Σ AI-gradable = 23 + phonétique 2 tutor_only (orale) — как B1/B2.
const CRITERIA_DELF_A2_ECRITE: SubjectCriterionTemplate[] = [
  { label: "Respect de la consigne", max: 2 },
  { label: "Capacité à décrire / raconter", max: 4 },
  { label: "Capacité à interagir", max: 4 },
  { label: "Cohérence et cohésion", max: 3 },
  { label: "Lexique étendue", max: 2 },
  { label: "Lexique maîtrise", max: 2 },
  { label: "Morphosyntaxe étendue", max: 4 },
  { label: "Morphosyntaxe maîtrise", max: 4 },
];

const CRITERIA_DELF_A2_ORALE: SubjectCriterionTemplate[] = [
  { label: "Présenter / décrire un sujet familier", max: 5 },
  { label: "Interagir / répondre", max: 4 },
  { label: "Lexique étendue", max: 4 },
  { label: "Lexique maîtrise", max: 2 },
  { label: "Morphosyntaxe étendue", max: 4 },
  { label: "Morphosyntaxe maîtrise", max: 4 },
  { label: "Système phonologique", max: 2, kind: "tutor_only" },
];

// A1-уровень (2026-07-14, запрос Эмилии). DRAFT — валидирует Эмилия. Σ = 25 (écrite),
// Σ AI-gradable = 23 + phonétique 2 tutor_only (orale) — та же структура, что A2/B1/B2.
const CRITERIA_DELF_A1_ECRITE: SubjectCriterionTemplate[] = [
  { label: "Respect de la consigne", max: 2 },
  { label: "Capacité à décrire / informer", max: 4 },
  { label: "Capacité à interagir", max: 4 },
  { label: "Cohérence et cohésion", max: 3 },
  { label: "Lexique étendue", max: 2 },
  { label: "Lexique maîtrise", max: 2 },
  { label: "Morphosyntaxe étendue", max: 4 },
  { label: "Morphosyntaxe maîtrise", max: 4 },
];

const CRITERIA_DELF_A1_ORALE: SubjectCriterionTemplate[] = [
  { label: "Se présenter / parler de soi", max: 5 },
  { label: "Répondre à des questions simples", max: 4 },
  { label: "Lexique étendue", max: 4 },
  { label: "Lexique maîtrise", max: 2 },
  { label: "Morphosyntaxe étendue", max: 4 },
  { label: "Morphosyntaxe maîtrise", max: 4 },
  { label: "Système phonologique", max: 2, kind: "tutor_only" },
];

// ⚠ IELTS criteria templates intentionally NOT defined as additive arrays.
// IELTS overall band = AVERAGE of 4 band-1-9 criteria, incompatible with the
// sum-aggregating sanitizer (`sanitizeCriteriaBreakdown`). `getLanguagesMethodology`
// returns `criteria: null` for ielts-task1 / ielts-task2 → no breakdown table,
// graceful degradation to overall `ai_score`. Re-enable with an average-aware
// sanitizer (review fix 2026-05-27, P1 #2).

// ─── Public API ────────────────────────────────────────────────────────────

export function getLanguagesMethodology(
  subject: string,
  taskText: string | null | undefined,
  forceOral = false,
  forcedCefr?: CefrLevel | null,
): { methodology: string; cefr: CefrLevel; criteria: SubjectCriterionTemplate[] | null } {
  const detection = detectLanguageFormat(subject, taskText, forceOral, forcedCefr);

  let methodology: string;
  let criteria: SubjectCriterionTemplate[] | null;
  switch (detection.format) {
    case "ege-en-letter":
      methodology = METHODOLOGY_EGE_EN_LETTER;
      criteria = CRITERIA_EGE_EN_LETTER;
      break;
    case "ege-en-essay":
      methodology = METHODOLOGY_EGE_EN_ESSAY;
      criteria = CRITERIA_EGE_EN_ESSAY;
      break;
    case "ege-en-monologue":
      methodology = METHODOLOGY_EGE_EN_MONOLOGUE;
      criteria = CRITERIA_EGE_EN_MONOLOGUE;
      break;
    case "oge-en-letter":
      methodology = METHODOLOGY_OGE_EN_LETTER;
      criteria = CRITERIA_OGE_EN_LETTER;
      break;
    case "oge-en-monologue":
      methodology = METHODOLOGY_OGE_EN_MONOLOGUE;
      criteria = CRITERIA_OGE_EN_MONOLOGUE;
      break;
    case "delf-a1-ecrite":
      methodology = METHODOLOGY_DELF_A1_ECRITE;
      criteria = CRITERIA_DELF_A1_ECRITE;
      break;
    case "delf-a2-ecrite":
      methodology = METHODOLOGY_DELF_A2_ECRITE;
      criteria = CRITERIA_DELF_A2_ECRITE;
      break;
    case "delf-b1-ecrite":
      methodology = METHODOLOGY_DELF_B1_ECRITE;
      criteria = CRITERIA_DELF_B1_ECRITE;
      break;
    case "delf-b2-ecrite":
      methodology = METHODOLOGY_DELF_B2_ECRITE;
      criteria = CRITERIA_DELF_B2_ECRITE;
      break;
    case "delf-a1-orale":
      methodology = METHODOLOGY_DELF_A1_ORALE;
      criteria = CRITERIA_DELF_A1_ORALE;
      break;
    case "delf-a2-orale":
      methodology = METHODOLOGY_DELF_A2_ORALE;
      criteria = CRITERIA_DELF_A2_ORALE;
      break;
    case "delf-b1-orale":
      methodology = METHODOLOGY_DELF_B1_ORALE;
      criteria = CRITERIA_DELF_B1_ORALE;
      break;
    case "delf-b2-orale":
      methodology = METHODOLOGY_DELF_B2_ORALE;
      criteria = CRITERIA_DELF_B2_ORALE;
      break;
    case "ielts-task1":
      methodology = METHODOLOGY_IELTS_TASK1;
      // IELTS = average aggregation → no additive breakdown (P1 #2). ai_score only.
      criteria = null;
      break;
    case "ielts-task2":
      methodology = METHODOLOGY_IELTS_TASK2;
      criteria = null;
      break;
    default:
      methodology = METHODOLOGY_GENERIC_LANG(detection.cefr);
      // Generic fallback — нет фиксированной балльной шкалы, AI оценивает
      // только итоговый ai_score без декомпозиции.
      criteria = null;
      break;
  }

  return { methodology, cefr: detection.cefr, criteria };
}

export function buildLanguagesRubric(
  subject: string,
  taskText: string | null | undefined,
  forceOral = false,
  forcedCefr?: CefrLevel | null,
): Omit<SubjectRubric, "tutor_rubric_active" | "subject_label"> {
  const { methodology, cefr, criteria } = getLanguagesMethodology(subject, taskText, forceOral, forcedCefr);
  return {
    role: ROLE_BY_SUBJECT[subject] ?? DEFAULT_ROLE,
    methodology,
    hint_examples: HINT_EXAMPLES,
    fallback_hint: FALLBACK_HINT,
    cefr_level: cefr,
    criteria_breakdown_template: criteria,
  };
}
