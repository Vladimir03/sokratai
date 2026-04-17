import { getFormulaById, getRelatedFormulas } from './formulas';
import { BUILD_RECIPES, SUPPORTED_BUILD_FORMULA_IDS, type BuildRecipe } from './recipes.generated';
import { MUTATION_LIBRARY } from './mutations.generated';
import type { Formula, FormulaQuestion, RoundConfig, WeakFormula } from './types';

interface RoundDistribution {
  trueOrFalse: number;
  buildFormula: number;
  situationToFormula: number;
}

// Build-recipe support is auto-derived: any formula that has a row in
// BUILD_RECIPES (sourced from the Google Sheet) is eligible for build cards.


const CONTEXT_DEPENDENT_TRUE_FALSE_IDS = new Set([
  'cons.05',
  'hydro.02',
]);

const DEFAULT_ROUND_DISTRIBUTIONS: RoundDistribution[] = [
  { trueOrFalse: 4, buildFormula: 4, situationToFormula: 2 },
  { trueOrFalse: 4, buildFormula: 3, situationToFormula: 3 },
  { trueOrFalse: 3, buildFormula: 4, situationToFormula: 3 },
];

// BUILD_RECIPES and MUTATION_LIBRARY are imported from the generated catalogs
// at the top of this file (sourced from the «Механика» Google Sheet).


let questionSequence = 0;

function createQuestionId(type: FormulaQuestion['type'], formulaId: string): string {
  questionSequence += 1;
  return `${type}:${formulaId}:${questionSequence}`;
}

function wrapMath(latex: string): string {
  return `\\(${latex}\\)`;
}

function unwrapMath(latex: string | undefined): string | null {
  if (!latex) {
    return null;
  }

  return latex
    .replace(/^\\\(/u, '')
    .replace(/\\\)$/u, '');
}

function normalizeMathToken(token: string): string {
  return token
    .replace(/_\{([А-Яа-яЁё]+)\}/gu, '_{\\text{$1}}')
    .replace(/_([А-Яа-яЁё]+)/gu, '_{\\text{$1}}');
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function pickRandomOrUndefined<T>(items: T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }

  return pickRandom(items);
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function uniqueFormulas(items: Formula[]): Formula[] {
  const seen = new Set<string>();

  return items.filter((formula) => {
    if (seen.has(formula.id)) {
      return false;
    }

    seen.add(formula.id);
    return true;
  });
}

function getEligiblePool(config: RoundConfig): Formula[] {
  const scopedPool = config.formulaPool.filter((formula) => formula.section === config.section);
  return scopedPool.length > 0 ? scopedPool : config.formulaPool;
}

function selectDistribution(questionCount: number): RoundDistribution {
  if (questionCount === 10) {
    return pickRandom(DEFAULT_ROUND_DISTRIBUTIONS);
  }

  const trueOrFalse = Math.max(1, Math.round(questionCount * 0.35));
  const buildFormula = Math.max(1, Math.round(questionCount * 0.35));
  const situationToFormula = Math.max(1, questionCount - trueOrFalse - buildFormula);
  const overflow = trueOrFalse + buildFormula + situationToFormula - questionCount;

  return {
    trueOrFalse,
    buildFormula,
    situationToFormula: situationToFormula - Math.max(0, overflow),
  };
}

function pickFormulas(pool: Formula[], count: number): Formula[] {
  if (pool.length === 0 || count <= 0) {
    return [];
  }

  if (pool.length >= count) {
    return shuffle(pool).slice(0, count);
  }

  const seeded = shuffle(pool);
  const picked = [...seeded];

  while (picked.length < count) {
    picked.push(...shuffle(pool).slice(0, Math.min(pool.length, count - picked.length)));
  }

  return picked.slice(0, count);
}

function getBuildRecipe(formula: Formula): BuildRecipe {
  const recipe = BUILD_RECIPES[formula.id] ?? {
    displayFormula: formula.formula,
    numeratorTokens: formula.variables.map((variable) => variable.symbol),
    denominatorTokens: [],
  };

  return {
    displayFormula: recipe.displayFormula,
    numeratorTokens: recipe.numeratorTokens.map(normalizeMathToken),
    denominatorTokens: recipe.denominatorTokens.map(normalizeMathToken),
  };
}

function supportsBuildQuestion(formula: Formula): boolean {
  return SUPPORTED_BUILD_FORMULA_IDS.has(formula.id);
}

function supportsTrueOrFalseQuestion(formula: Formula): boolean {
  return !CONTEXT_DEPENDENT_TRUE_FALSE_IDS.has(formula.id);
}

function getSameSectionFormulas(formula: Formula, pool: Formula[]): Formula[] {
  return pool.filter((candidate) => candidate.section === formula.section && candidate.id !== formula.id);
}

function getDistractorFormulas(formula: Formula, pool: Formula[], count: number): Formula[] {
  const allowedIds = new Set(pool.map((candidate) => candidate.id));
  // GDD §6.4: related formulas first (most dangerous confusions), then same-section backfill
  const related = shuffle(
    getRelatedFormulas(formula.id).filter(
      (candidate) => candidate.id !== formula.id && (allowedIds.size === 0 || allowedIds.has(candidate.id)),
    ),
  );
  if (related.length >= count) {
    return related.slice(0, count);
  }
  const usedIds = new Set(related.map((candidate) => candidate.id));
  const backfill = shuffle(
    getSameSectionFormulas(formula, pool).filter((candidate) => !usedIds.has(candidate.id)),
  );
  return [...related, ...backfill].slice(0, count);
}

function getDistractorTokens(formula: Formula, count: number, pool: Formula[]): string[] {
  const recipe = getBuildRecipe(formula);
  const correctTokens = [...recipe.numeratorTokens, ...recipe.denominatorTokens];
  const relatedTokens = getDistractorFormulas(formula, pool, Math.max(count, 3))
    .flatMap((candidate) => {
      const r = getBuildRecipe(candidate);
      return [...r.numeratorTokens, ...r.denominatorTokens];
    })
    .filter((token) => !correctTokens.includes(token));

  const fallbackTokens = getSameSectionFormulas(formula, pool)
    .flatMap((candidate) => candidate.variables.map((variable) => normalizeMathToken(variable.symbol)))
    .filter((token) => !correctTokens.includes(token));

  return shuffle(unique([...relatedTokens, ...fallbackTokens])).slice(0, count);
}

function toReadableFormula(formula: Formula): string {
  return formula.formulaPlain;
}

function getMutationExplanation(question: FormulaQuestion, formula: Formula): string {
  if (question.explanation) {
    return question.explanation;
  }

  switch (question.mutationType) {
    case 'swap_fraction':
      return 'Здесь перевёрнута дробь, поэтому зависимость стала противоположной.';
    case 'drop_coefficient':
      return 'Из записи пропал обязательный коэффициент.';
    case 'wrong_power':
      return 'Здесь потеряна или добавлена степень, а она меняет физический смысл.';
    case 'swap_variable':
      return `В этой формуле нужна другая величина, а не подмена похожим символом.`;
    default:
      return formula.commonMistakes[0] ?? 'В записи нарушена структура формулы.';
  }
}

function getProportionalityHint(formula: Formula): string {
  if (formula.proportionality.direct.length > 0) {
    return `Подсказка по связи: ${formula.proportionality.direct[0]}.`;
  }

  if (formula.proportionality.inverse.length > 0) {
    return `Подсказка по связи: ${formula.proportionality.inverse[0]}.`;
  }

  return `Опирайся на вывод: ${formula.derivedFrom}.`;
}

function getLayer1MemoryCue(formula: Formula): string {
  if (formula.section !== 'Кинематика') {
    return `Ориентир: ${formula.whenToUse[0] ?? formula.physicalMeaning}`;
  }

  const noTimeTrigger = formula.whenToUse.find((entry) => /нет времени/i.test(entry));

  if (noTimeTrigger) {
    return 'Запомни триггер: если времени нет, ищи формулу без t.';
  }

  const circularTrigger = formula.whenToUse.find((entry) => /окружност|вращени/i.test(entry));

  if (circularTrigger) {
    return 'Запомни триггер: как только видишь круговое движение, сразу проверяй период, частоту, радиус и центростремительные связи.';
  }

  const accelerationTrigger = formula.whenToUse.find((entry) => /ускорени|тормоз|падени/i.test(entry));

  if (accelerationTrigger) {
    return 'Запомни триггер: как только в условии есть ускорение или торможение, ищи формулы равноускоренного движения.';
  }

  return `Ориентир: ${formula.whenToUse[0] ?? formula.physicalMeaning}`;
}

function trimLine(line: string): string {
  return line.trim().replace(/[.!?。]+$/u, '');
}

function joinLines(lines: string[]): string {
  return lines
    .filter(Boolean)
    .map((line) => line.trim())
    .join('\n');
}

export function generateTrueOrFalse(formula: Formula): FormulaQuestion {
  const showCorrectFormula = Math.random() >= 0.5;
  const mutation = showCorrectFormula ? undefined : pickRandomOrUndefined(MUTATION_LIBRARY[formula.id] ?? []);

  return {
    id: createQuestionId('true_or_false', formula.id),
    type: 'true_or_false',
    layer: 3,
    formulaId: formula.id,
    prompt: 'Формула верна?',
    displayFormula: wrapMath(showCorrectFormula || !mutation ? formula.formula : mutation.latex),
    correctAnswer: showCorrectFormula || !mutation,
    explanation: mutation?.hint ?? formula.physicalMeaning,
    mutationType: mutation?.type,
  };
}

export function generateBuildFormula(formula: Formula, pool: Formula[] = []): FormulaQuestion {
  const recipe = getBuildRecipe(formula);
  const allTokens = [...recipe.numeratorTokens, ...recipe.denominatorTokens];
  const distractorCount = Math.min(3, Math.max(2, formula.relatedFormulas.length > 1 ? 3 : 2));
  const distractors = getDistractorTokens(formula, distractorCount, pool.length > 0 ? pool : [formula]);

  return {
    id: createQuestionId('build_formula', formula.id),
    type: 'build_formula',
    layer: 2,
    formulaId: formula.id,
    prompt: formula.buildTitle || formula.name,
    displayFormula: wrapMath(recipe.displayFormula),
    options: shuffle(unique([...allTokens, ...distractors])),
    correctAnswer: { numerator: recipe.numeratorTokens, denominator: recipe.denominatorTokens },
    explanation: `Нужные элементы: ${allTokens.join(', ')}`,
  };
}

export function generateSituationToFormula(formula: Formula, pool: Formula[]): FormulaQuestion {
  const distractors = getDistractorFormulas(formula, pool, 3);
  const correctOption = wrapMath(formula.formula);
  const options = shuffle([correctOption, ...distractors.map((candidate) => wrapMath(candidate.formula))]);
  const trigger = pickRandom(formula.whenToUse);

  return {
    id: createQuestionId('situation_to_formula', formula.id),
    type: 'situation_to_formula',
    layer: 1,
    formulaId: formula.id,
    prompt: trimLine(trigger),
    options,
    correctAnswer: correctOption,
    explanation: trimLine(trigger),
  };
}

export interface FeedbackPayload {
  canonicalLatex: string;
  questionLatex: string | null;
  userAnswerLatex: string | null;
  reasoning: string;
  trap: string;
  isCorrect: boolean;
}

export function generateFeedbackPayload(question: FormulaQuestion, isCorrect: boolean, userAnswer?: string | boolean | { numerator: string[]; denominator: string[] }): FeedbackPayload {
  const formula = getFormulaById(question.formulaId);

  if (!formula) {
    return {
      canonicalLatex: '?',
      questionLatex: null,
      userAnswerLatex: null,
      reasoning: isCorrect ? 'Верно!' : 'Нужна ещё одна попытка.',
      trap: '',
      isCorrect,
    };
  }

  const canonicalLatex = formula.formula;
  const questionLatex = unwrapMath(question.displayFormula);

  // Build userAnswerLatex based on question type and answer (for BOTH correct and incorrect)
  let userAnswerLatex: string | null = null;
  if (userAnswer) {
    if (question.layer === 3) {
      userAnswerLatex = userAnswer === true ? 'верно' : 'неверно';
    } else if (question.layer === 2 && typeof userAnswer === 'object' && 'numerator' in userAnswer) {
      const { numerator, denominator } = userAnswer;
      const numStr = numerator.length > 0 ? numerator.join(' \\cdot ') : '';
      const denStr = denominator.length > 0 ? denominator.join(' \\cdot ') : '';
      if (denStr && numStr) userAnswerLatex = `\\frac{${numStr}}{${denStr}}`;
      else if (denStr) userAnswerLatex = `\\frac{1}{${denStr}}`;
      else if (numStr) userAnswerLatex = numStr;
    } else if (question.layer === 1 && typeof userAnswer === 'string') {
      userAnswerLatex = userAnswer;
    }
  }

  if (isCorrect) {
    return {
      canonicalLatex,
      questionLatex,
      userAnswerLatex,
      reasoning: formula.physicalMeaning,
      trap: getLayer1MemoryCue(formula),
      isCorrect: true,
    };
  }

  // Incorrect answer feedback
  if (question.layer === 3) {
    const mutation = MUTATION_LIBRARY[formula.id]?.find((m) => m.type === question.mutationType);
    return {
      canonicalLatex,
      questionLatex,
      userAnswerLatex,
      reasoning: mutation?.hint ?? getMutationExplanation(question, formula),
      trap: formula.dimensions,
      isCorrect: false,
    };
  }

  if (question.layer === 2) {
    const recipe = getBuildRecipe(formula);
    const allTokens = [...recipe.numeratorTokens, ...recipe.denominatorTokens];
    const formattedTokens = allTokens.map((token) => `$${token}$`).join(', ');
    return {
      canonicalLatex,
      questionLatex,
      userAnswerLatex: userAnswerLatex ?? null,
      reasoning: `Нужны элементы: ${formattedTokens}`,
      trap: trimLine(formula.commonMistakes[0] ?? 'не подменяй переменные'),
      isCorrect: false,
    };
  }

  // Layer 1
  return {
    canonicalLatex,
    questionLatex,
    userAnswerLatex: userAnswerLatex ?? null,
    reasoning: trimLine(question.explanation || formula.whenToUse[0] || formula.physicalMeaning),
    trap: getLayer1MemoryCue(formula),
    isCorrect: false,
  };
}

export function generateFeedback(question: FormulaQuestion, isCorrect: boolean): string {
  const formula = getFormulaById(question.formulaId);

  if (!formula) {
    return isCorrect ? '✓ Верно!' : 'Нужна ещё одна попытка.';
  }

  if (isCorrect) {
    return `✓ Верно! ${formula.physicalMeaning}`;
  }

  if (question.layer === 3) {
    if (question.correctAnswer === true) {
      return joinLines([
        `Эта запись верна: ${toReadableFormula(formula)}.`,
        `Размерность согласуется: ${formula.dimensions}.`,
      ]);
    }

    return joinLines([
      `Формула неверна. ${getMutationExplanation(question, formula)}`,
      `Проверь размерность: ${formula.dimensions}.`,
      getProportionalityHint(formula),
    ]);
  }

  if (question.layer === 2) {
    const recipe = getBuildRecipe(formula);
    const allTokens = [...recipe.numeratorTokens, ...recipe.denominatorTokens];
    return joinLines([
      `Для "${formula.name}" нужны элементы: ${allTokens.join(', ')}.`,
      trimLine(formula.physicalMeaning),
      `Частая ловушка: ${trimLine(formula.commonMistakes[0] ?? 'не подменяй переменные из похожих формул')}.`,
    ]);
  }

  return joinLines([
    `Ключевой триггер: ${trimLine(question.explanation || formula.whenToUse[0] || formula.physicalMeaning)}.`,
    `Здесь подходит ${toReadableFormula(formula)}.`,
    getLayer1MemoryCue(formula),
  ]);
}

function buildRoundQuestions(formulas: Formula[], distribution: RoundDistribution, pool: Formula[]): FormulaQuestion[] {
  const shuffledFormulas = shuffle(formulas);
  const usedFormulaIds = new Set<string>();

  const buildFormulaFormulas = shuffledFormulas
    .filter((formula) => supportsBuildQuestion(formula))
    .slice(0, distribution.buildFormula);
  for (const formula of buildFormulaFormulas) {
    usedFormulaIds.add(formula.id);
  }

  const trueOrFalseFormulas = shuffledFormulas
    .filter((formula) => !usedFormulaIds.has(formula.id) && supportsTrueOrFalseQuestion(formula))
    .slice(0, distribution.trueOrFalse);
  for (const formula of trueOrFalseFormulas) {
    usedFormulaIds.add(formula.id);
  }

  const situationFormulas = shuffledFormulas.filter((formula) => !usedFormulaIds.has(formula.id));

  const questions = [
    ...trueOrFalseFormulas.map((formula) => generateTrueOrFalse(formula)),
    ...buildFormulaFormulas.map((formula) => generateBuildFormula(formula, pool)),
    ...situationFormulas.map((formula) => generateSituationToFormula(formula, pool)),
  ];

  return shuffle(questions);
}

export function generateRound(config: RoundConfig): FormulaQuestion[] {
  const pool = getEligiblePool(config);
  const formulas = pickFormulas(pool, config.questionCount);
  const distribution = selectDistribution(config.questionCount);

  return buildRoundQuestions(formulas, distribution, pool);
}

export function generateRetryRound(weakFormulas: WeakFormula[], config: RoundConfig): FormulaQuestion[] {
  const eligiblePool = getEligiblePool(config);
  const weakIds = unique(weakFormulas.map((weakFormula) => weakFormula.formulaId));
  const pool = eligiblePool.filter((formula) => weakIds.includes(formula.id));

  if (pool.length === 0) {
    return [];
  }

  const formulas = pickFormulas(pool, config.questionCount);
  const distribution = selectDistribution(config.questionCount);

  return buildRoundQuestions(formulas, distribution, eligiblePool);
}
