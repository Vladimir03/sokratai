/**
 * Детерминированный обходчик блок-схем ФИПИ (физика ЕГЭ, Часть 2 № 21-26).
 * strict-criteria-grading Phase 3 (2026-06-30). Схемы подтверждены Егором.
 *
 * ЯДРО: балл считает КОД по блок-схеме ФИПИ; AI лишь СУДИТ узлы (да/нет/частично).
 * Зеркало русского cascade (`applyCriteriaCascade`) — модели балл НЕ доверяется.
 * Функции чистые/детерминированные. Никаких импортов (тривиально бандлится в тест).
 *
 * Узлы-суждения (interfaces ниже) — контракт с AI: node-judgment call выдаёт
 * ровно эти булевы/статусы + per-node комментарии, а `walkPhysicsFlowchart`
 * превращает их в {score, trace}. Trace → отображается ученику/тутору
 * («все формулы ✓, преобразования ✗ → 2 из 3»).
 */

export type PhysicsFlowchartKind =
  | "qualitative21"
  | "calc22_23"
  | "calc24_25"
  | "calc26";

/** № КИМ → тип блок-схемы. null = нет ФИПИ-схемы (Часть 1 / generic) → caller решает. */
export function physicsFlowchartKind(
  kimNumber: number | null | undefined,
): PhysicsFlowchartKind | null {
  if (kimNumber === 21) return "qualitative21";
  if (kimNumber === 22 || kimNumber === 23) return "calc22_23";
  if (kimNumber === 24 || kimNumber === 25) return "calc24_25";
  if (kimNumber === 26) return "calc26";
  return null;
}

// ─── Узлы-суждения (AI выдаёт; балл — НЕ выдаёт) ──────────────────────────────

/** № 21 — качественная задача (макс 3). */
export interface Qualitative21Judgments {
  /** Верный ответ дан? */
  correct_answer: boolean;
  /** Объяснение полное (все нужные явления + законы + логика)? */
  full_explanation: boolean;
  /** Есть ошибки в объяснении? (учитывается при full_explanation=true) */
  has_errors: boolean;
  /** Сколько законов/явлений не хватает в объяснении: 0 / 1 / 2 (=2+). (при full_explanation=false) */
  missing_laws: 0 | 1 | 2;
  /** Приведены верные рассуждения? (ветка неверного ответа) */
  correct_reasoning: boolean;
}

/** № 22-23 — расчётная (макс 2). */
export interface Calc22_23Judgments {
  /** Все исходные формулы/законы записаны? */
  all_formulas: boolean;
  /** Ответ и размерность верны? */
  answer_dimension_correct: boolean;
  /** Обозначения новых величин, преобразования и вычисления верны? */
  notation_transforms_calc_correct: boolean;
  /** Есть лишние (не отделённые от решения / не зачёркнутые) записи? */
  extra_records: boolean;
  /** Преобразования верны? (ветка неверного ответа/размерности) */
  transforms_correct: boolean;
}

/** № 24-25 — расчётная (макс 3). */
export interface Calc24_25Judgments {
  /** Все исходные формулы/законы записаны? */
  all_formulas: boolean;
  /** Общая формула, размерность и ответ верны? */
  general_formula_dim_answer_correct: boolean;
  /** Обозначения, преобразования, вычисления верны? */
  notation_transforms_calc_correct: boolean;
  /** Преобразования верны? */
  transforms_correct: boolean;
  /** Ровно одна формула с ошибкой ИЛИ отсутствует ровно одна формула? (ветка !all_formulas) */
  only_one_formula_wrong_or_missing: boolean;
}

/** № 26 — расчётная с обоснованием (макс 4) = обоснование (0/+1) + расчёт (как № 24-25). */
export interface Calc26Judgments extends Calc24_25Judgments {
  /** Обоснование полное? Чеклист Егора (all-or-nothing: любой применимый пункт отсутствует → false). */
  justification_complete: boolean;
}

export type PhysicsJudgments =
  | Qualitative21Judgments
  | Calc22_23Judgments
  | Calc24_25Judgments
  | Calc26Judgments;

export interface FlowchartTraceStep {
  /**
   * Человекочитаемое имя узла (для отображения). ВСЕ узлы сформулированы в
   * ПОЛОЖИТЕЛЬНОЙ полярности («критерий выполнен?»), поэтому `verdict` единообразно:
   * yes = выполнено (✓), partial = частично (⚠), no = не выполнено (✗). Это
   * важно для UI-трассы (Phase C): нельзя иметь узел, где yes = плохо (напр.
   * «Лишние записи: yes»), иначе зелёная галочка вводит в заблуждение.
   */
  node: string;
  /** Вердикт по узлу: yes = критерий выполнен, partial = частично, no = не выполнен. */
  verdict: "yes" | "no" | "partial";
  /** Опц. AI-комментарий: что именно не так (напр. «потеряна Δ в ΔU=3/2·pV»). */
  note?: string;
}

export interface FlowchartResult {
  score: number;
  maxScore: number;
  /** Путь по блок-схеме — узлы с вердиктами (для «трассы» в UI). */
  trace: FlowchartTraceStep[];
}

// ─── Обходчики (по подтверждённым Егором схемам) ─────────────────────────────

function step(node: string, verdict: "yes" | "no" | "partial", note?: string): FlowchartTraceStep {
  return note ? { node, verdict, note } : { node, verdict };
}

/** № 21 качественная. Схема: верный_ответ → полное_объяснение → ошибки; ветки недостающих законов / верных рассуждений. */
function walk21(j: Qualitative21Judgments): FlowchartResult {
  const maxScore = 3;
  if (!j.correct_answer) {
    return {
      score: j.correct_reasoning ? 1 : 0,
      maxScore,
      trace: [
        step("Верный ответ", "no"),
        step("Верные рассуждения", j.correct_reasoning ? "yes" : "no"),
      ],
    };
  }
  if (j.full_explanation) {
    return {
      score: j.has_errors ? 2 : 3,
      maxScore,
      trace: [
        step("Верный ответ", "yes"),
        step("Полное объяснение", "yes"),
        step("Объяснение без ошибок", j.has_errors ? "no" : "yes"),
      ],
    };
  }
  // Объяснение неполное → решает число недостающих законов/явлений: 1 → 2 балла, 2+ → 1 балл.
  const missingOne = j.missing_laws === 1;
  return {
    score: missingOne ? 2 : 1,
    maxScore,
    trace: [
      step("Верный ответ", "yes"),
      step("Полное объяснение", "no"),
      step("Все необходимые законы/явления приведены", missingOne ? "partial" : "no"),
    ],
  };
}

/** № 22-23 расчётная (макс 2). */
function walk22_23(j: Calc22_23Judgments): FlowchartResult {
  const maxScore = 2;
  if (!j.all_formulas) {
    return { score: 0, maxScore, trace: [step("Все формулы/законы", "no")] };
  }
  if (!j.answer_dimension_correct) {
    return {
      score: j.transforms_correct ? 1 : 0,
      maxScore,
      trace: [
        step("Все формулы/законы", "yes"),
        step("Ответ, размерность", "no"),
        step("Преобразования", j.transforms_correct ? "yes" : "no"),
      ],
    };
  }
  if (!j.notation_transforms_calc_correct) {
    return {
      score: 1,
      maxScore,
      trace: [
        step("Все формулы/законы", "yes"),
        step("Ответ, размерность", "yes"),
        step("Обозначения, преобразования, вычисления", "no"),
      ],
    };
  }
  return {
    score: j.extra_records ? 1 : 2,
    maxScore,
    trace: [
      step("Все формулы/законы", "yes"),
      step("Ответ, размерность", "yes"),
      step("Обозначения, преобразования, вычисления", "yes"),
      step("Нет лишних записей", j.extra_records ? "no" : "yes"),
    ],
  };
}

/** № 24-25 расчётная (макс 3). */
function walk24_25(j: Calc24_25Judgments): FlowchartResult {
  const maxScore = 3;
  if (j.all_formulas) {
    if (j.general_formula_dim_answer_correct) {
      return {
        score: j.notation_transforms_calc_correct ? 3 : 2,
        maxScore,
        trace: [
          step("Все формулы/законы", "yes"),
          step("Общая формула, размерность, ответ", "yes"),
          step("Обозначения, преобразования, вычисления", j.notation_transforms_calc_correct ? "yes" : "no"),
        ],
      };
    }
    return {
      score: j.transforms_correct ? 2 : 1,
      maxScore,
      trace: [
        step("Все формулы/законы", "yes"),
        step("Общая формула, размерность, ответ", "no"),
        step("Преобразования", j.transforms_correct ? "yes" : "no"),
      ],
    };
  }
  // Не все формулы записаны.
  if (j.only_one_formula_wrong_or_missing) {
    return {
      score: j.transforms_correct ? 1 : 0,
      maxScore,
      trace: [
        step("Все формулы/законы", "no"),
        step("Не более одной ошибки в формулах", "partial"),
        step("Преобразования", j.transforms_correct ? "yes" : "no"),
      ],
    };
  }
  return {
    score: 0,
    maxScore,
    trace: [
      step("Все формулы/законы", "no"),
      step("Не более одной ошибки в формулах", "no"),
    ],
  };
}

/** № 26 = обоснование (Критерий 1, +1/0) + расчёт (Критерий 2, как № 24-25). Итог 0..4. */
function walk26(j: Calc26Judgments): FlowchartResult {
  const calc = walk24_25(j);
  const justScore = j.justification_complete ? 1 : 0;
  return {
    score: justScore + calc.score,
    maxScore: 4,
    trace: [
      step("Полное обоснование", j.justification_complete ? "yes" : "no"),
      ...calc.trace,
    ],
  };
}

/**
 * Единая точка входа. Возвращает {score, maxScore, trace} по подтверждённой
 * блок-схеме ФИПИ, или null для не-Часть-2 № (Часть 1 / generic — caller решает).
 * Caller обязан передать judgments правильной формы для данного № (см.
 * `physicsFlowchartKind`).
 */
export function walkPhysicsFlowchart(
  kimNumber: number | null | undefined,
  judgments: PhysicsJudgments,
): FlowchartResult | null {
  const kind = physicsFlowchartKind(kimNumber);
  if (!kind) return null;
  switch (kind) {
    case "qualitative21":
      return walk21(judgments as Qualitative21Judgments);
    case "calc22_23":
      return walk22_23(judgments as Calc22_23Judgments);
    case "calc24_25":
      return walk24_25(judgments as Calc24_25Judgments);
    case "calc26":
      return walk26(judgments as Calc26Judgments);
  }
}
