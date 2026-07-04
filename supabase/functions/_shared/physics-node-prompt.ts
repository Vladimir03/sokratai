// strict-criteria-grading Phase 3 / Phase B — промпт узлов-суждений + санитайзер
// для физики Часть 2 (№ 21-26). ЧИСТЫЙ модуль (без guided_ai/ai_shared зависимостей)
// → тестируется изолированно (scripts/test-physics-node-prompt.mjs).
//
// Идея: AI НЕ выставляет балл. AI выносит СУЖДЕНИЯ по узлам блок-схемы ФИПИ
// (да/нет/частично), сравнивая решение ученика с эталоном. Балл считает КОД
// (`walkPhysicsFlowchart`). Здесь — построение системного промпта (узлы + JSON-
// схема + чеклист обоснования №26) и парсинг ответа модели в типизированные
// `*Judgments` из physics-flowcharts.ts.

import {
  type Calc22_23Judgments,
  type Calc24_25Judgments,
  type Calc26Judgments,
  physicsFlowchartKind,
  type PhysicsJudgments,
  type Qualitative21Judgments,
} from "./physics-flowcharts.ts";

// ─── Чеклист обоснования № 26 (Егор Блинов, 24.06.2025; ФИПИ-2022 + Демидова) ──
// Применяются ТОЛЬКО пункты, релевантные физике задачи. AI судит
// justification_complete = все ПРИМЕНИМЫЕ пункты присутствуют (all-or-nothing).
export const OBOSNOVANIE_26_CHECKLIST = [
  "ЧЕКЛИСТ ОБОСНОВАНИЯ (№ 26, Критерий 1). Обоснование полное (justification_complete=true) ТОЛЬКО если присутствуют ВСЕ применимые к этой задаче пункты (хоть один применимый отсутствует → false). Применяй только релевантные физике задачи пункты:",
  "1. 2-й з-н Ньютона / ур. моментов / ЗСИ / ЗСЭ → «рассмотрим задачу в СО, связанной с Землёй; считаем её ИНЕРЦИАЛЬНОЙ».",
  "2. Движение вертикально/под углом только под силой тяжести → тела = материальные точки, пренебрегаем сопротивлением воздуха, движение = СВОБОДНОЕ ПАДЕНИЕ.",
  "3. Кинематика равноускоренного (не свободное падение) → силы постоянны → движение равноускоренное.",
  "4. Движение тел + 2-й з-н Ньютона/ЗСИ/ЗСЭ → «применяем 2-й з-н Ньютона, справедливый для материальных точек, т.к. тела движутся ПОСТУПАТЕЛЬНО».",
  "5. Условия твёрдого тела: (а) модель твёрдого тела; (б) не движется поступательно → Σ внешних сил = 0; (в) не вращается → Σ моментов относительно оси = 0; (г) обосновать, что сила тяжести приложена к середине (напр. стержень однородный); (д) выбрать ось для моментов.",
  "6. ЗСИ: вдоль оси нет внешних сил (какие силы дают проекцию 0 / внутренние) ИЛИ время удара/взрыва мало → импульсом внешних сил пренебречь → система ЗАМКНУТА; изменением импульса малых масс пренебрегаем.",
  "7. ЗСЭ: «изменение мех. энергии в ИСО = работе всех НЕПОТЕНЦИАЛЬНЫХ сил»; указать потенц./непотенц.; «работа непотенц. сил = 0»; если натяжение/реакция — ДОКАЗАТЬ ⊥ скорости.",
  "8. Тела на нити: «нить невесома, масса блока ничтожна, трения в оси нет, трение о воздух отсутствует → модуль натяжения в любой точке одинаков». «Идеальные» без пояснения — не засчитывается; нерастяжимость тут НЕ писать (см. п.9). Пружина: лёгкая → силы упругости на концах равны.",
  "9. Связь ускорений: «нить нерастяжима → модули ускорений [отличаются в 2 раза / равны]».",
  "10. «Поверхность гладкая» и модельные допущения → написать, как используются (гладкая → нет трения); пренебрегаем трением о воздух.",
  "11. Ищут вес (не N) → вес и N связаны 3-м з-ном Ньютона; силы трения на 2 тела равны и противоположны (3-й з-н).",
  "12. Отрыв тела от поверхности → в этой точке N=0.",
  "13. Угол падения = угол отражения (упругий удар) → энергия сохраняется, N ⊥ поверхности, N≫mg (время удара мало), проекции скорости.",
].join("\n");

// ─── Описания узлов + JSON-схема по типу задания ─────────────────────────────

interface NodeSpec {
  nodes: string[];
  schema: string;
}

function nodeSpecFor(kim: number): NodeSpec | null {
  const kind = physicsFlowchartKind(kim);
  if (kind === "qualitative21") {
    return {
      nodes: [
        "УЗЛЫ (качественная задача № 21):",
        "- correct_answer: дан ли ВЕРНЫЙ ответ на вопрос задачи?",
        "- full_explanation: объяснение ПОЛНОЕ (все нужные явления + законы + логика связаны)?",
        "- has_errors: есть ли ошибки в объяснении (при полном объяснении)?",
        "- missing_laws: сколько необходимых законов/явлений НЕ хватает в объяснении — 0, 1 или 2 (2 = «двух и более»)?",
        "- correct_reasoning: если ответ неверный — приведены ли верные рассуждения?",
      ],
      schema:
        '{"correct_answer":true|false,"full_explanation":true|false,"has_errors":true|false,"missing_laws":0|1|2,"correct_reasoning":true|false,"feedback":"...","confidence":"low|medium|high"}',
    };
  }
  if (kind === "calc22_23") {
    return {
      nodes: [
        "УЗЛЫ (расчётная задача № 22-23):",
        "- all_formulas: записаны ли ВСЕ необходимые исходные законы/формулы из кодификатора?",
        "- answer_dimension_correct: верны ли числовой ответ И его размерность (единицы)?",
        "- notation_transforms_calc_correct: верны ли обозначения новых величин, алгебраические преобразования и вычисления?",
        "- extra_records: есть ли ЛИШНИЕ (не отделённые от решения / не зачёркнутые) записи?",
        "- transforms_correct: верны ли преобразования (даже если ответ/размерность неверны)?",
      ],
      schema:
        '{"all_formulas":true|false,"answer_dimension_correct":true|false,"notation_transforms_calc_correct":true|false,"extra_records":true|false,"transforms_correct":true|false,"feedback":"...","confidence":"low|medium|high"}',
    };
  }
  if (kind === "calc24_25") {
    return {
      nodes: [
        "УЗЛЫ (расчётная задача № 24-25):",
        "- all_formulas: записаны ли ВСЕ необходимые исходные законы/формулы из кодификатора?",
        "- general_formula_dim_answer_correct: верны ли общая формула искомой величины, её размерность и числовой ответ?",
        "- notation_transforms_calc_correct: верны ли обозначения новых величин, преобразования и вычисления?",
        "- transforms_correct: верны ли преобразования (даже если общая формула/ответ неверны)?",
        "- only_one_formula_wrong_or_missing: если НЕ все формулы записаны — ровно ОДНА формула с ошибкой ИЛИ отсутствует ровно одна (true)? Если проблем больше — false.",
      ],
      schema:
        '{"all_formulas":true|false,"general_formula_dim_answer_correct":true|false,"notation_transforms_calc_correct":true|false,"transforms_correct":true|false,"only_one_formula_wrong_or_missing":true|false,"feedback":"...","confidence":"low|medium|high"}',
    };
  }
  if (kind === "calc26") {
    return {
      nodes: [
        "УЗЛЫ (расчётная задача № 26 = обоснование + расчёт):",
        "- justification_complete: полное ли ОБОСНОВАНИЕ по чеклисту выше (все применимые пункты)?",
        "- all_formulas: записаны ли ВСЕ необходимые исходные законы/формулы?",
        "- general_formula_dim_answer_correct: верны ли общая формула, размерность и числовой ответ?",
        "- notation_transforms_calc_correct: верны ли обозначения, преобразования и вычисления?",
        "- transforms_correct: верны ли преобразования (даже если общая формула/ответ неверны)?",
        "- only_one_formula_wrong_or_missing: если НЕ все формулы — ровно одна с ошибкой/отсутствует (true), иначе false.",
      ],
      schema:
        '{"justification_complete":true|false,"all_formulas":true|false,"general_formula_dim_answer_correct":true|false,"notation_transforms_calc_correct":true|false,"transforms_correct":true|false,"only_one_formula_wrong_or_missing":true|false,"feedback":"...","confidence":"low|medium|high"}',
    };
  }
  return null;
}

/**
 * Системный промпт для узлов-суждений. `reference` — эталон (AI-сгенерированный
 * или репетитора); может быть null (тогда AI судит по собственному пониманию).
 * `methodology` — ФИПИ-методология по номеру (из resolveSubjectRubric).
 */
export function buildPhysicsNodeSystemContent(opts: {
  kim: number;
  role: string;
  methodology: string;
  reference: string | null;
  maxScore: number;
}): string | null {
  const spec = nodeSpecFor(opts.kim);
  if (!spec) return null;
  const isKim26 = physicsFlowchartKind(opts.kim) === "calc26";

  return [
    opts.role,
    "Ты — эксперт-проверяющий ЕГЭ по физике. Проверь РАЗВЁРНУТОЕ решение ученика по блок-схеме ФИПИ.",
    "ГЛАВНОЕ: ты выносишь СУЖДЕНИЯ по узлам (да/нет/сколько), а БАЛЛ посчитает система по блок-схеме. НЕ выставляй балл сам, не пиши число баллов.",
    "Оценивай СТРОГО, как эксперт ФИПИ, а не как добрый учитель: сначала найди ВСЕ недочёты (пропущенные законы, ошибки записи/преобразований, нет единиц измерения, потерянные Δ/индексы), потом суди узлы. Не завышай.",
    opts.reference
      ? "Сравни решение ученика с ЭТАЛОННЫМ решением ниже (оно для твоей сверки — НЕ показывай его ученику)."
      : "Эталон не предоставлен — суди узлы по собственному верному решению задачи.",
    "",
    "МЕТОДОЛОГИЯ ФИПИ:",
    opts.methodology,
    "",
    ...(isKim26 ? [OBOSNOVANIE_26_CHECKLIST, ""] : []),
    ...spec.nodes,
    "",
    opts.reference ? `ЭТАЛОННОЕ РЕШЕНИЕ (для сверки, не цитируй ученику):\n${opts.reference}` : "",
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток:",
    spec.schema,
    "",
    "feedback (видит УЧЕНИК): дружелюбно, но точно укажи ГДЕ ошибка (какой элемент/шаг/запись) и что проверить. НЕ приводи готовое решение и НЕ называй финальный числовой ответ (анти-спойлер). 1-4 предложения.",
    "confidence: high — уверен в суждениях; medium — есть неоднозначность; low — условие/решение нечитаемо.",
  ]
    .filter((s) => s !== "")
    .join("\n");
}

// ─── Санитайзер ответа модели → типизированные judgments ─────────────────────

function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "yes" || s === "да" || s === "1";
  }
  return false;
}

function asMissingLaws(v: unknown): 0 | 1 | 2 {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  if (n <= 0 || Number.isNaN(n)) return 0;
  if (n === 1) return 1;
  return 2;
}

function asConfidence(v: unknown): number {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "high") return 0.9;
  if (s === "low") return 0.5;
  return 0.75; // medium / unknown
}

export interface PhysicsNodeParseResult {
  judgments: PhysicsJudgments;
  feedback: string;
  confidence: number;
}

/**
 * Парсит ответ модели в judgments нужной формы по номеру задания. Возвращает null,
 * если вход не объект или номер не Часть-2 (→ caller делает fallback).
 */
export function sanitizePhysicsJudgments(
  parsed: unknown,
  kim: number,
): PhysicsNodeParseResult | null {
  const kind = physicsFlowchartKind(kim);
  if (!kind || !parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const feedback = typeof o.feedback === "string" ? o.feedback.trim() : "";
  const confidence = asConfidence(o.confidence);

  let judgments: PhysicsJudgments;
  if (kind === "qualitative21") {
    judgments = {
      correct_answer: asBool(o.correct_answer),
      full_explanation: asBool(o.full_explanation),
      has_errors: asBool(o.has_errors),
      missing_laws: asMissingLaws(o.missing_laws),
      correct_reasoning: asBool(o.correct_reasoning),
    } satisfies Qualitative21Judgments;
  } else if (kind === "calc22_23") {
    judgments = {
      all_formulas: asBool(o.all_formulas),
      answer_dimension_correct: asBool(o.answer_dimension_correct),
      notation_transforms_calc_correct: asBool(o.notation_transforms_calc_correct),
      extra_records: asBool(o.extra_records),
      transforms_correct: asBool(o.transforms_correct),
    } satisfies Calc22_23Judgments;
  } else if (kind === "calc24_25") {
    judgments = {
      all_formulas: asBool(o.all_formulas),
      general_formula_dim_answer_correct: asBool(o.general_formula_dim_answer_correct),
      notation_transforms_calc_correct: asBool(o.notation_transforms_calc_correct),
      transforms_correct: asBool(o.transforms_correct),
      only_one_formula_wrong_or_missing: asBool(o.only_one_formula_wrong_or_missing),
    } satisfies Calc24_25Judgments;
  } else {
    // calc26
    judgments = {
      justification_complete: asBool(o.justification_complete),
      all_formulas: asBool(o.all_formulas),
      general_formula_dim_answer_correct: asBool(o.general_formula_dim_answer_correct),
      notation_transforms_calc_correct: asBool(o.notation_transforms_calc_correct),
      transforms_correct: asBool(o.transforms_correct),
      only_one_formula_wrong_or_missing: asBool(o.only_one_formula_wrong_or_missing),
    } satisfies Calc26Judgments;
  }

  return { judgments, feedback, confidence };
}
