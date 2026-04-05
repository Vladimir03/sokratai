import { getFormulaById, getRelatedFormulas } from './formulas';
import type { Formula, FormulaQuestion, RoundConfig, WeakFormula } from './types';

type MutationType = 'swap_fraction' | 'drop_coefficient' | 'wrong_power' | 'swap_variable';

interface RoundDistribution {
  trueOrFalse: number;
  buildFormula: number;
  situationToFormula: number;
}

interface FormulaMutation {
  type: MutationType;
  latex: string;
  hint: string;
}

interface BuildRecipe {
  displayFormula: string;
  numeratorTokens: string[];
  denominatorTokens: string[];
}

const DEFAULT_ROUND_DISTRIBUTIONS: RoundDistribution[] = [
  { trueOrFalse: 4, buildFormula: 4, situationToFormula: 2 },
  { trueOrFalse: 4, buildFormula: 3, situationToFormula: 3 },
  { trueOrFalse: 3, buildFormula: 4, situationToFormula: 3 },
];

const BUILD_RECIPES: Record<string, BuildRecipe> = {
  'kin.01': {
    displayFormula: 's = v \\cdot t',
    numeratorTokens: ['v', 't'],
    denominatorTokens: [],
  },
  'kin.02': {
    displayFormula: 'v_{ср} = \\frac{s_{общ}}{t_{общ}}',
    numeratorTokens: ['s_{общ}'],
    denominatorTokens: ['t_{общ}'],
  },
  'kin.03': {
    displayFormula: 'v = v_0 + a \\cdot t',
    numeratorTokens: ['v_0', 'a', 't'],
    denominatorTokens: [],
  },
  'kin.04': {
    displayFormula: 's = v_0 t + \\frac{a t^2}{2}',
    numeratorTokens: ['v_0', 't', 'a', 't^2'],
    denominatorTokens: ['2'],
  },
  'kin.05': {
    displayFormula: 's = \\frac{v + v_0}{2} \\cdot t',
    numeratorTokens: ['v', 'v_0', 't'],
    denominatorTokens: ['2'],
  },
  'kin.06': {
    displayFormula: 'v^2 = v_0^2 + 2as',
    numeratorTokens: ['v_0^2', '2', 'a', 's'],
    denominatorTokens: [],
  },
  'kin.07': {
    displayFormula: 'h = \\frac{g t^2}{2}',
    numeratorTokens: ['g', 't^2'],
    denominatorTokens: ['2'],
  },
  'kin.08': {
    displayFormula: 'v = g \\cdot t',
    numeratorTokens: ['g', 't'],
    denominatorTokens: [],
  },
  'kin.09': {
    displayFormula: 'v = \\frac{2 \\pi R}{T}',
    numeratorTokens: ['2\\pi', 'R'],
    denominatorTokens: ['T'],
  },
  'kin.10': {
    displayFormula: 'T = \\frac{1}{\\nu}',
    numeratorTokens: ['1'],
    denominatorTokens: ['\\nu'],
  },
  'kin.11': {
    displayFormula: '\\omega = \\frac{2\\pi}{T}',
    numeratorTokens: ['2\\pi'],
    denominatorTokens: ['T'],
  },
  'kin.12': {
    displayFormula: 'a_{цс} = \\frac{v^2}{R}',
    numeratorTokens: ['v^2'],
    denominatorTokens: ['R'],
  },
};

const MUTATION_LIBRARY: Record<string, FormulaMutation[]> = {
  'kin.01': [
    {
      type: 'swap_variable',
      latex: 's = a \\cdot t',
      hint: 'Перемещение связано со скоростью, а не с ускорением напрямую.',
    },
    {
      type: 'wrong_power',
      latex: 's = v \\cdot t^2',
      hint: 'При равномерном движении время входит линейно, без квадрата.',
    },
  ],
  'kin.02': [
    {
      type: 'swap_fraction',
      latex: 'v_{ср} = \\frac{t_{общ}}{s_{общ}}',
      hint: 'Средняя скорость считается как путь, делённый на время, а не наоборот.',
    },
  ],
  'kin.03': [
    {
      type: 'wrong_power',
      latex: 'v = v_0 + a \\cdot t^2',
      hint: 'В формуле скорости при равноускоренном движении время не возводится в квадрат.',
    },
    {
      type: 'swap_variable',
      latex: 'v = v_0 + g \\cdot t',
      hint: 'Здесь нужен общий символ ускорения a, а не частный случай g.',
    },
  ],
  'kin.04': [
    {
      type: 'drop_coefficient',
      latex: 's = v_0 t + a t^2',
      hint: 'У разгонного вклада обязательно есть делитель 2.',
    },
    {
      type: 'wrong_power',
      latex: 's = v_0 t + \\frac{a t}{2}',
      hint: 'Добавка от ускорения зависит от квадрата времени, а не от t.',
    },
  ],
  'kin.05': [
    {
      type: 'drop_coefficient',
      latex: 's = (v + v_0) \\cdot t',
      hint: 'Средняя скорость здесь равна полусумме скоростей, поэтому деление на 2 обязательно.',
    },
  ],
  'kin.06': [
    {
      type: 'drop_coefficient',
      latex: 'v^2 = v_0^2 + as',
      hint: 'В формуле без времени перед as обязательно стоит множитель 2.',
    },
    {
      type: 'wrong_power',
      latex: 'v = v_0^2 + 2as',
      hint: 'Связь без времени работает через квадрат скорости.',
    },
  ],
  'kin.07': [
    {
      type: 'drop_coefficient',
      latex: 'h = g t^2',
      hint: 'При свободном падении без начальной скорости сохраняется деление на 2.',
    },
    {
      type: 'wrong_power',
      latex: 'h = \\frac{g t}{2}',
      hint: 'Высота падения растёт как t^2, а не линейно по времени.',
    },
  ],
  'kin.08': [
    {
      type: 'swap_variable',
      latex: 'v = g \\cdot h',
      hint: 'Скорость свободного падения зависит от времени, а не от высоты напрямую.',
    },
    {
      type: 'wrong_power',
      latex: 'v = g \\cdot t^2',
      hint: 'Скорость при свободном падении растёт линейно по времени.',
    },
  ],
  'kin.09': [
    {
      type: 'swap_fraction',
      latex: 'v = \\frac{T}{2 \\pi R}',
      hint: 'Линейная скорость при движении по окружности равна длине окружности, делённой на период.',
    },
    {
      type: 'drop_coefficient',
      latex: 'v = \\frac{R}{T}',
      hint: 'За один оборот тело проходит 2πR, поэтому 2π нельзя терять.',
    },
  ],
  'kin.10': [
    {
      type: 'swap_fraction',
      latex: 'T = \\nu',
      hint: 'Период и частота обратны друг другу.',
    },
  ],
  'kin.11': [
    {
      type: 'drop_coefficient',
      latex: '\\omega = \\frac{1}{T} = \\nu',
      hint: 'Угловая скорость связана с полным оборотом 2π радиан, поэтому 2π обязательно.',
    },
    {
      type: 'swap_fraction',
      latex: '\\omega = \\frac{T}{2\\pi}',
      hint: 'При росте периода угловая скорость уменьшается, значит T должен быть в знаменателе.',
    },
  ],
  'kin.12': [
    {
      type: 'wrong_power',
      latex: 'a_{цс} = \\frac{v}{R} = \\omega R',
      hint: 'Центростремительное ускорение зависит от квадрата скорости и квадрата угловой скорости.',
    },
    {
      type: 'swap_variable',
      latex: 'a_{цс} = \\frac{v^2}{T}',
      hint: 'В формуле кругового движения нужен радиус R, а не период T.',
    },
  ],
};

let questionSequence = 0;

function createQuestionId(type: FormulaQuestion['type'], formulaId: string): string {
  questionSequence += 1;
  return `${type}:${formulaId}:${questionSequence}`;
}

function wrapMath(latex: string): string {
  return `\\(${latex}\\)`;
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
  return BUILD_RECIPES[formula.id] ?? { displayFormula: formula.formula, numeratorTokens: formula.variables.map((variable) => variable.symbol), denominatorTokens: [] };
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
    .flatMap((candidate) => candidate.variables.map((variable) => variable.symbol))
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
    prompt: `Собери формулу: ${formula.name}`,
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
  const trueOrFalseFormulas = formulas.slice(0, distribution.trueOrFalse);
  const buildFormulaFormulas = formulas.slice(
    distribution.trueOrFalse,
    distribution.trueOrFalse + distribution.buildFormula,
  );
  const situationFormulas = formulas.slice(distribution.trueOrFalse + distribution.buildFormula);

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
