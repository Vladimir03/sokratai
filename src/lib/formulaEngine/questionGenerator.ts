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
    displayFormula: 'v_{\\text{ср}} = \\frac{s_{\\text{общ}}}{t_{\\text{общ}}}',
    numeratorTokens: ['s_{\\text{общ}}'],
    denominatorTokens: ['t_{\\text{общ}}'],
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
    displayFormula: 'a_{\\text{цс}} = \\frac{v^2}{R}',
    numeratorTokens: ['v^2'],
    denominatorTokens: ['R'],
  },
  'dyn.01': {
    displayFormula: 'F = m \\cdot a',
    numeratorTokens: ['F'],
    denominatorTokens: ['m', 'a'],
  },
  'dyn.02': {
    displayFormula: 'f = \\mu \\cdot N',
    numeratorTokens: ['\\mu', 'N'],
    denominatorTokens: [],
  },
  'dyn.03': {
    displayFormula: 'F_g = m \\cdot g',
    numeratorTokens: ['m', 'g'],
    denominatorTokens: [],
  },
  'dyn.04': {
    displayFormula: 'F_c = \\frac{m v^2}{R}',
    numeratorTokens: ['m', 'v^2'],
    denominatorTokens: ['R'],
  },
  'dyn.05': {
    displayFormula: 'F_{AB} = -F_{BA}',
    numeratorTokens: ['F_{AB}'],
    denominatorTokens: [],
  },
  'dyn.06': {
    displayFormula: 'F = k \\cdot \\Delta x',
    numeratorTokens: ['k', '\\Delta x'],
    denominatorTokens: [],
  },
  'cons.01': {
    displayFormula: 'p = m \\cdot v',
    numeratorTokens: ['m', 'v'],
    denominatorTokens: [],
  },
  'cons.02': {
    displayFormula: "m_1 v_1 + m_2 v_2 = m_1 v_1' + m_2 v_2'",
    numeratorTokens: ['m_1', 'v_1', 'm_2', 'v_2'],
    denominatorTokens: [],
  },
  'cons.03': {
    displayFormula: 'E_k = \\frac{m v^2}{2}',
    numeratorTokens: ['m', 'v^2'],
    denominatorTokens: ['2'],
  },
  'cons.04': {
    displayFormula: 'E_p = m \\cdot g \\cdot h',
    numeratorTokens: ['m', 'g', 'h'],
    denominatorTokens: [],
  },
  'cons.05': {
    displayFormula: 'E_k + E_p = \\text{const}',
    numeratorTokens: ['E_k', 'E_p'],
    denominatorTokens: [],
  },
  'cons.06': {
    displayFormula: 'A = F \\cdot s \\cdot \\cos(\\alpha)',
    numeratorTokens: ['F', 's', '\\cos(\\alpha)'],
    denominatorTokens: [],
  },
  'cons.07': {
    displayFormula: 'P = \\frac{A}{t}',
    numeratorTokens: ['A'],
    denominatorTokens: ['t'],
  },
  'stat.01': {
    displayFormula: '\\sum F = 0',
    numeratorTokens: ['F_1', 'F_2'],
    denominatorTokens: [],
  },
  'hydro.01': {
    displayFormula: 'P = \\frac{F}{S}',
    numeratorTokens: ['F'],
    denominatorTokens: ['S'],
  },
  'hydro.02': {
    displayFormula: 'P = P_0 + \\rho \\cdot g \\cdot h',
    numeratorTokens: ['P_0', '\\rho', 'g', 'h'],
    denominatorTokens: [],
  },
  'hydro.03': {
    displayFormula: 'F_A = \\rho \\cdot g \\cdot V',
    numeratorTokens: ['\\rho', 'g', 'V'],
    denominatorTokens: [],
  },
  'hydro.04': {
    displayFormula: '\\frac{F_1}{S_1} = \\frac{F_2}{S_2}',
    numeratorTokens: ['F_1', 'S_2'],
    denominatorTokens: ['S_1', 'F_2'],
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
      latex: 'v_{\\text{ср}} = \\frac{t_{\\text{общ}}}{s_{\\text{общ}}}',
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
      latex: 'a_{\\text{цс}} = \\frac{v}{R} = \\omega R',
      hint: 'Центростремительное ускорение зависит от квадрата скорости и квадрата угловой скорости.',
    },
    {
      type: 'swap_variable',
      latex: 'a_{\\text{цс}} = \\frac{v^2}{T}',
      hint: 'В формуле кругового движения нужен радиус R, а не период T.',
    },
  ],
  'dyn.01': [
    {
      type: 'swap_fraction',
      latex: 'a = \\frac{m}{F}',
      hint: 'Ускорение обратно пропорционально массе: большая масса — меньше ускорение.',
    },
    {
      type: 'swap_variable',
      latex: 'F = a / m',
      hint: 'Сила пропорциональна массе и ускорению, нужно умножение, а не деление.',
    },
  ],
  'dyn.02': [
    {
      type: 'swap_variable',
      latex: 'f = \\mu + N',
      hint: 'Сила трения зависит от произведения коэффициента и нормальной силы.',
    },
    {
      type: 'drop_coefficient',
      latex: 'f = N',
      hint: 'Коэффициент трения μ определяет, какую часть нормальной силы составляет трение.',
    },
  ],
  'dyn.03': [
    {
      type: 'swap_variable',
      latex: 'F_g = m + g',
      hint: 'Вес — произведение массы на ускорение свободного падения.',
    },
    {
      type: 'wrong_power',
      latex: 'F_g = m \\cdot g^2',
      hint: 'g не возводится в степень в формуле веса.',
    },
  ],
  'dyn.04': [
    {
      type: 'wrong_power',
      latex: 'F_c = \\frac{m v}{R}',
      hint: 'Центростремительная сила зависит от квадрата скорости.',
    },
    {
      type: 'swap_variable',
      latex: 'F_c = \\frac{v^2}{m R}',
      hint: 'Масса умножается на ускорение, она в числителе.',
    },
  ],
  'dyn.05': [
    {
      type: 'swap_fraction',
      latex: 'F_{AB} = F_{BA}',
      hint: 'Силы действия и противодействия противоположны по направлению.',
    },
  ],
  'dyn.06': [
    {
      type: 'swap_variable',
      latex: 'F = \\Delta x / k',
      hint: 'Сила упругости пропорциональна деформации, k в числителе.',
    },
    {
      type: 'drop_coefficient',
      latex: 'F = \\Delta x',
      hint: 'Жёсткость k показывает, насколько сильно пружина сопротивляется деформации.',
    },
  ],
  'cons.01': [
    {
      type: 'swap_variable',
      latex: 'p = v / m',
      hint: 'Импульс — произведение, а не отношение.',
    },
  ],
  'cons.02': [
    {
      type: 'swap_fraction',
      latex: "m_1 v_1 - m_2 v_2 = m_1 v_1' - m_2 v_2'",
      hint: 'В законе сохранения импульса складываются импульсы, а не вычитаются.',
    },
  ],
  'cons.03': [
    {
      type: 'drop_coefficient',
      latex: 'E_k = m v^2',
      hint: 'Кинетическая энергия содержит делитель 2 в формуле.',
    },
    {
      type: 'wrong_power',
      latex: 'E_k = \\frac{m v}{2}',
      hint: 'Энергия зависит от квадрата скорости, а не от первой степени.',
    },
  ],
  'cons.04': [
    {
      type: 'swap_variable',
      latex: 'E_p = m \\cdot g / h',
      hint: 'Потенциальная энергия растёт с высотой, h в числителе.',
    },
    {
      type: 'wrong_power',
      latex: 'E_p = m \\cdot g \\cdot h^2',
      hint: 'Потенциальная энергия линейна по высоте, без квадрата.',
    },
  ],
  'cons.05': [
    {
      type: 'swap_variable',
      latex: 'E_k - E_p = \\text{const}',
      hint: 'При сохранении механической энергии кинетическая и потенциальная складываются.',
    },
  ],
  'cons.06': [
    {
      type: 'drop_coefficient',
      latex: 'A = F \\cdot s',
      hint: 'Угол между силой и перемещением влияет на работу через косинус.',
    },
    {
      type: 'wrong_power',
      latex: 'A = F^2 \\cdot s',
      hint: 'Работа линейна по силе, не зависит от её квадрата.',
    },
  ],
  'cons.07': [
    {
      type: 'swap_fraction',
      latex: 'P = \\frac{t}{A}',
      hint: 'Мощность — работа, делённая на время, а не наоборот.',
    },
    {
      type: 'swap_variable',
      latex: 'P = F / v',
      hint: 'Мощность может быть выражена как произведение силы и скорости.',
    },
  ],
  'stat.01': [
    {
      type: 'swap_fraction',
      latex: '\\sum F = \\text{max}',
      hint: 'При равновесии сумма всех сил должна быть нулевой.',
    },
  ],
  'hydro.01': [
    {
      type: 'swap_fraction',
      latex: 'P = \\frac{S}{F}',
      hint: 'Давление — сила, делённая на площадь.',
    },
    {
      type: 'wrong_power',
      latex: 'P = F \\cdot S',
      hint: 'Давление — это отношение силы к площади, а не произведение.',
    },
  ],
  'hydro.02': [
    {
      type: 'drop_coefficient',
      latex: 'P = P_0 + \\rho \\cdot g \\cdot h / 2',
      hint: 'Гидростатическое давление растёт линейно с глубиной, без делителя.',
    },
    {
      type: 'swap_variable',
      latex: 'P = \\rho \\cdot g \\cdot h',
      hint: 'Полное давление включает атмосферное давление P₀.',
    },
  ],
  'hydro.03': [
    {
      type: 'swap_variable',
      latex: 'F_A = m \\cdot g \\cdot V',
      hint: 'Архимедова сила зависит от плотности жидкости, а не от плотности тела.',
    },
    {
      type: 'drop_coefficient',
      latex: 'F_A = \\rho \\cdot V',
      hint: 'Архимедова сила равна весу вытесненной жидкости: ρgV.',
    },
  ],
  'hydro.04': [
    {
      type: 'swap_fraction',
      latex: '\\frac{S_1}{F_1} = \\frac{S_2}{F_2}',
      hint: 'В гидравлическом прессе давление одинаково, поэтому F/S постоянно.',
    },
    {
      type: 'swap_variable',
      latex: 'F_1 \\cdot S_1 = F_2 \\cdot S_2',
      hint: 'Закон Паскаля основан на равенстве давлений, а не на равенстве произведений.',
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
      userAnswerLatex: null,
      reasoning: isCorrect ? 'Верно!' : 'Нужна ещё одна попытка.',
      trap: '',
      isCorrect,
    };
  }

  const canonicalLatex = formula.formula;

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
      userAnswerLatex: userAnswerLatex ?? null,
      reasoning: `Нужны элементы: ${formattedTokens}`,
      trap: trimLine(formula.commonMistakes[0] ?? 'не подменяй переменные'),
      isCorrect: false,
    };
  }

  // Layer 1
  return {
    canonicalLatex,
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
