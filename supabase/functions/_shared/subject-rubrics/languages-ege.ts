/**
 * Languages — rubric блоки для AI grading.
 *
 * Поддерживаемые форматы (P0):
 *   - ЕГЭ английский № 38 (личное письмо, 6 баллов, K1-K3)
 *   - ЕГЭ английский № 39 (эссе с собственной точкой зрения, 14 баллов, K1-K5)
 *   - DELF B1 production écrite (25 баллов, 8 критериев)
 *   - DELF B2 production écrite (25 баллов, 8 критериев — строже)
 *   - IELTS Writing Task 1/2 (band 1-9, 4 критерия)
 *
 * Auto-detect формата из task_text через cefr-detector + дополнительные
 * regex'ы (письмо vs эссе, IELTS Task 1 vs Task 2). Если не сматчили —
 * generic language methodology + CEFR-aware ожидания по объёму.
 *
 * Не покрыто в P0 (явно): DELE испанский, TOEFL Writing, китайский HSK,
 * etc. — fallback на generic language rubric.
 */

import { detectCefrLevel } from "./cefr-detector.ts";
import type { CefrLevel, SubjectRubric } from "./types.ts";

// ─── Format detection ──────────────────────────────────────────────────────

type LanguageFormat =
  | "ege-en-letter" // № 38
  | "ege-en-essay" // № 39
  | "delf-b1-ecrite" // DELF B1 production écrite
  | "delf-b2-ecrite" // DELF B2 production écrite
  | "ielts-task1" // IELTS Writing Task 1 (graph / data description)
  | "ielts-task2" // IELTS Writing Task 2 (essay)
  | "generic"; // fallback

interface FormatDetection {
  format: LanguageFormat;
  cefr: CefrLevel;
}

function detectLanguageFormat(
  subject: string,
  taskText: string | null | undefined,
): FormatDetection {
  const text = (taskText ?? "").trim();
  const cefr = detectCefrLevel(text).level;

  // IELTS — самый специфичный (явно упомянут в тексте)
  if (/\bIELTS\b/i.test(text)) {
    if (/\bTask\s*1\b/i.test(text) || /\b(graph|chart|diagram|table|process)\b/i.test(text)) {
      return { format: "ielts-task1", cefr };
    }
    return { format: "ielts-task2", cefr };
  }

  // DELF (французский)
  if (subject === "french") {
    if (/\bDELF\s*B2\b/i.test(text) || cefr === "B2") {
      return { format: "delf-b2-ecrite", cefr: "B2" };
    }
    if (/\bDELF\s*B1\b/i.test(text) || cefr === "B1") {
      return { format: "delf-b1-ecrite", cefr: "B1" };
    }
    return { format: "delf-b1-ecrite", cefr: "B1" };
  }

  // ЕГЭ английский — № 38 (письмо) vs № 39 (эссе)
  if (subject === "english") {
    if (
      /\b(письм[оаеу]\b|личное\s+письмо|email|electronic\s+letter)/iu.test(text) ||
      /\bзадание\s*38\b/iu.test(text)
    ) {
      return { format: "ege-en-letter", cefr };
    }
    if (
      /\b(эссе|essay|развёрнутое\s+высказывание|writing\s+task)/iu.test(text) ||
      /\bзадание\s*39\b/iu.test(text)
    ) {
      return { format: "ege-en-essay", cefr };
    }
    // Default for English без явных меток — letter (more common for B1/B2 students).
    return { format: cefr === "B2" ? "ege-en-essay" : "ege-en-letter", cefr };
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

const METHODOLOGY_IELTS_TASK1 = [
  "IELTS Writing Task 1 — Описание графика / диаграммы / процесса (150+ слов, 20 минут, band 1-9).",
  "Task Achievement (TA): полностью описаны все ключевые тенденции / точки данных; есть общий overview (key features), нет искажений данных.",
  "Coherence and Cohesion (CC): абзацы (intro + overview + 2 body paragraphs), linking words (firstly / in contrast / overall / in conclusion).",
  "Lexical Resource (LR): разнообразие словаря описания трендов (rise / decline / fluctuate / plateau), синонимы, минимум ошибок.",
  "Grammatical Range and Accuracy (GRA): разнообразие предложений (simple / compound / complex), правильность времён (past simple для исторических данных, future formers для прогнозов).",
  "Каждый критерий band 1-9; общая band = среднее, округлённое до ближайшей полу-band.",
].join("\n");

const METHODOLOGY_IELTS_TASK2 = [
  "IELTS Writing Task 2 — Эссе с аргументацией (250+ слов, 40 минут, band 1-9).",
  "Task Response (TR): полностью ответил на вопрос (Agree/Disagree / Discuss both views / Advantages-Disadvantages / Problem-Solution); есть clear position; развёрнутые аргументы с примерами.",
  "Coherence and Cohesion (CC): чёткая структура (intro + 2-3 body paragraphs + conclusion); linking words; topic sentence в каждом абзаце.",
  "Lexical Resource (LR): академический регистр, разнообразие, идиоматические выражения, точность.",
  "Grammatical Range and Accuracy (GRA): разнообразие conditional / passive / complex sentences; минимум grammatical errors.",
  "Band 1-9 за каждый критерий; band 7+ требует near-native accuracy.",
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

// ─── Public API ────────────────────────────────────────────────────────────

export function getLanguagesMethodology(
  subject: string,
  taskText: string | null | undefined,
): { methodology: string; cefr: CefrLevel } {
  const detection = detectLanguageFormat(subject, taskText);

  let methodology: string;
  switch (detection.format) {
    case "ege-en-letter":
      methodology = METHODOLOGY_EGE_EN_LETTER;
      break;
    case "ege-en-essay":
      methodology = METHODOLOGY_EGE_EN_ESSAY;
      break;
    case "delf-b1-ecrite":
      methodology = METHODOLOGY_DELF_B1_ECRITE;
      break;
    case "delf-b2-ecrite":
      methodology = METHODOLOGY_DELF_B2_ECRITE;
      break;
    case "ielts-task1":
      methodology = METHODOLOGY_IELTS_TASK1;
      break;
    case "ielts-task2":
      methodology = METHODOLOGY_IELTS_TASK2;
      break;
    default:
      methodology = METHODOLOGY_GENERIC_LANG(detection.cefr);
      break;
  }

  return { methodology, cefr: detection.cefr };
}

export function buildLanguagesRubric(
  subject: string,
  taskText: string | null | undefined,
): Omit<SubjectRubric, "tutor_rubric_active" | "subject_label"> {
  const { methodology, cefr } = getLanguagesMethodology(subject, taskText);
  return {
    role: ROLE_BY_SUBJECT[subject] ?? DEFAULT_ROLE,
    methodology,
    hint_examples: HINT_EXAMPLES,
    fallback_hint: FALLBACK_HINT,
    cefr_level: cefr,
  };
}
