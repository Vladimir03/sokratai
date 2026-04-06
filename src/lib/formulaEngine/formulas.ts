import type { Formula } from './types';

export const kinematicsFormulas: Formula[] = [
  {
    id: 'kin.01',
    section: 'Кинематика',
    topic: 'Равномерное движение',
    name: 'Перемещение при равномерном движении',
    formula: 's = v \\cdot t',
    formulaPlain: 's = v * t',
    variables: [
      { symbol: 's', name: 'перемещение', unit: 'м' },
      { symbol: 'v', name: 'скорость', unit: 'м/с' },
      { symbol: 't', name: 'время', unit: 'с' },
    ],
    physicalMeaning:
      'Перемещение равно скорости, умноженной на время. Чем быстрее движешься и чем дольше — тем дальше уедешь.',
    proportionality: {
      direct: ['v → s', 't → s'],
      inverse: [],
    },
    dimensions: '[L] = [L/T] * [T]',
    derivedFrom: 'Определение скорости: v = s/t',
    whenToUse: [
      'Тело движется с постоянной скоростью',
      'Нет ускорения',
      'Дано: скорость и время, найти перемещение',
      'Горизонтальная составляющая движения тела, брошенного горизонтально',
    ],
    commonMistakes: [
      'Путают перемещение s и путь L (перемещение — вектор, путь — скаляр)',
      'Забывают перевести км/ч в м/с (делить на 3.6)',
    ],
    relatedFormulas: ['kin.02', 'kin.03'],
    difficulty: 1,
  },
  {
    id: 'kin.02',
    section: 'Кинематика',
    topic: 'Средняя скорость',
    name: 'Средняя скорость',
    formula: 'v_{ср} = \\frac{s_{общ}}{t_{общ}}',
    formulaPlain: 'v_ср = s_общ / t_общ',
    variables: [
      { symbol: 'v_ср', name: 'средняя скорость', unit: 'м/с' },
      { symbol: 's_общ', name: 'общий путь', unit: 'м' },
      { symbol: 't_общ', name: 'общее время', unit: 'с' },
    ],
    physicalMeaning:
      'Средняя скорость — это весь пройденный путь, делённый на всё затраченное время. НЕ среднее арифметическое скоростей!',
    proportionality: {
      direct: ['s_общ → v_ср'],
      inverse: ['t_общ → v_ср'],
    },
    dimensions: '[L/T] = [L] / [T]',
    derivedFrom: 'Определение средней скорости',
    whenToUse: [
      'Тело двигалось с разными скоростями на разных участках',
      'Нужно найти среднюю скорость за весь путь',
      'ВАЖНО: средняя скорость ≠ (v1+v2)/2',
    ],
    commonMistakes: [
      'Считают среднюю скорость как среднее арифметическое: (v1+v2)/2 — это НЕВЕРНО в общем случае',
      'Путают среднюю скорость пути и среднюю скорость перемещения',
    ],
    relatedFormulas: ['kin.01'],
    difficulty: 2,
  },
  {
    id: 'kin.03',
    section: 'Кинематика',
    topic: 'Равноускоренное движение',
    name: 'Скорость при равноускоренном движении',
    formula: 'v = v_0 + a \\cdot t',
    formulaPlain: 'v = v₀ + a * t',
    variables: [
      { symbol: 'v', name: 'конечная скорость', unit: 'м/с' },
      { symbol: 'v_0', name: 'начальная скорость', unit: 'м/с' },
      { symbol: 'a', name: 'ускорение', unit: 'м/с²' },
      { symbol: 't', name: 'время', unit: 'с' },
    ],
    physicalMeaning: 'Скорость в данный момент = начальная скорость + то, что «набежало» за счёт ускорения за время t.',
    proportionality: {
      direct: ['a → v', 't → v'],
      inverse: [],
    },
    dimensions: '[L/T] = [L/T] + [L/T²] * [T]',
    derivedFrom: 'Определение ускорения: a = (v - v₀) / t',
    whenToUse: [
      'Тело разгоняется или тормозит',
      'Дано: начальная скорость, ускорение, время',
      'Нужно найти скорость в момент t',
      'Торможение: a < 0 (или направлено против скорости)',
    ],
    commonMistakes: [
      'Забывают знак ускорения при торможении (a должно быть отрицательным)',
      'Путают v₀ = 0 (старт с места) и v = 0 (остановка)',
    ],
    relatedFormulas: ['kin.04', 'kin.05', 'kin.06'],
    difficulty: 1,
  },
  {
    id: 'kin.04',
    section: 'Кинематика',
    topic: 'Равноускоренное движение',
    name: 'Перемещение при равноускоренном движении',
    formula: 's = v_0 t + \\frac{a t^2}{2}',
    formulaPlain: 's = v₀t + at²/2',
    variables: [
      { symbol: 's', name: 'перемещение', unit: 'м' },
      { symbol: 'v_0', name: 'начальная скорость', unit: 'м/с' },
      { symbol: 'a', name: 'ускорение', unit: 'м/с²' },
      { symbol: 't', name: 'время', unit: 'с' },
    ],
    physicalMeaning:
      'Перемещение складывается из двух частей: то, что тело прошло бы с начальной скоростью (v₀t), плюс добавка от ускорения (at²/2).',
    proportionality: {
      direct: ['v_0 → s', 'a → s', 't² → s'],
      inverse: [],
    },
    dimensions: '[L] = [L/T]*[T] + [L/T²]*[T²]',
    derivedFrom: 'Интегрирование v(t) = v₀ + at по времени',
    whenToUse: [
      'Тело движется с ускорением',
      'Дано: v₀, a, t — найти перемещение',
      'Свободное падение: a = g, v₀ = 0 → s = gt²/2',
      'Тело брошено вверх: v₀ вверх, a = -g',
    ],
    commonMistakes: [
      'Забывают делить at² на 2',
      'Путают перемещение и координату: x = x₀ + v₀t + at²/2',
      'При свободном падении забывают, что a = g ≈ 9.8 м/с²',
    ],
    relatedFormulas: ['kin.03', 'kin.05', 'kin.06'],
    difficulty: 1,
  },
  {
    id: 'kin.05',
    section: 'Кинематика',
    topic: 'Равноускоренное движение',
    name: 'Перемещение через среднюю скорость',
    formula: 's = \\frac{v + v_0}{2} \\cdot t',
    formulaPlain: 's = (v + v₀) / 2 * t',
    variables: [
      { symbol: 's', name: 'перемещение', unit: 'м' },
      { symbol: 'v', name: 'конечная скорость', unit: 'м/с' },
      { symbol: 'v_0', name: 'начальная скорость', unit: 'м/с' },
      { symbol: 't', name: 'время', unit: 'с' },
    ],
    physicalMeaning:
      'При равноускоренном движении средняя скорость = полусумма начальной и конечной. Перемещение = средняя скорость × время.',
    proportionality: {
      direct: ['v → s', 'v_0 → s', 't → s'],
      inverse: [],
    },
    dimensions: '[L] = [L/T] * [T]',
    derivedFrom: 'Следствие из kin.03 и kin.04',
    whenToUse: [
      'Известны начальная и конечная скорости + время',
      'Нет ускорения в данных, но есть обе скорости',
    ],
    commonMistakes: [
      'Применяют (v+v₀)/2 для НЕравноускоренного движения — это работает ТОЛЬКО при постоянном ускорении',
    ],
    relatedFormulas: ['kin.03', 'kin.04', 'kin.06'],
    difficulty: 2,
  },
  {
    id: 'kin.06',
    section: 'Кинематика',
    topic: 'Равноускоренное движение',
    name: 'Формула без времени',
    formula: 'v^2 = v_0^2 + 2as',
    formulaPlain: 'v² = v₀² + 2as',
    variables: [
      { symbol: 'v', name: 'конечная скорость', unit: 'м/с' },
      { symbol: 'v_0', name: 'начальная скорость', unit: 'м/с' },
      { symbol: 'a', name: 'ускорение', unit: 'м/с²' },
      { symbol: 's', name: 'перемещение', unit: 'м' },
    ],
    physicalMeaning: 'Связывает скорости, ускорение и перемещение БЕЗ времени. Квадрат скорости меняется на 2as за перемещение s.',
    proportionality: {
      direct: ['a → v²', 's → v²'],
      inverse: [],
    },
    dimensions: '[L²/T²] = [L²/T²] + [L/T²]*[L]',
    derivedFrom: 'Выводится из kin.03 и kin.04 путём исключения t',
    whenToUse: [
      'В задаче НЕТ времени!',
      'Дано: скорости и ускорение — найти перемещение',
      'Дано: скорости и перемещение — найти ускорение',
      'Тормозной путь автомобиля (v = 0, найти s)',
      'Свободное падение с высоты h: v² = 2gh',
    ],
    commonMistakes: [
      "Самая 'забываемая' формула кинематики — ученики не знают что она существует",
      'Пытаются решить задачу через систему двух уравнений вместо одной формулы',
      'Забывают множитель 2 перед as',
    ],
    relatedFormulas: ['kin.03', 'kin.04'],
    difficulty: 2,
  },
  {
    id: 'kin.07',
    section: 'Кинематика',
    topic: 'Свободное падение',
    name: 'Высота свободного падения',
    formula: 'h = \\frac{g t^2}{2}',
    formulaPlain: 'h = gt²/2',
    variables: [
      { symbol: 'h', name: 'высота падения', unit: 'м' },
      { symbol: 'g', name: 'ускорение свободного падения', unit: 'м/с²' },
      { symbol: 't', name: 'время падения', unit: 'с' },
    ],
    physicalMeaning: 'Частный случай kin.04 при v₀ = 0 и a = g. Тело падает с нарастающей скоростью.',
    proportionality: {
      direct: ['g → h', 't² → h'],
      inverse: [],
    },
    dimensions: '[L] = [L/T²] * [T²]',
    derivedFrom: 'kin.04 при v₀ = 0, a = g',
    whenToUse: [
      'Тело падает с высоты без начальной скорости',
      'Дано: время падения — найти высоту',
      'Дано: высота — найти время падения',
    ],
    commonMistakes: [
      'Забывают делить на 2',
      'Путают g = 9.8 м/с² и g = 10 м/с² (на ЕГЭ обычно g = 10)',
    ],
    relatedFormulas: ['kin.04', 'kin.08'],
    difficulty: 1,
  },
  {
    id: 'kin.08',
    section: 'Кинематика',
    topic: 'Свободное падение',
    name: 'Скорость при свободном падении',
    formula: 'v = g \\cdot t',
    formulaPlain: 'v = g * t',
    variables: [
      { symbol: 'v', name: 'скорость', unit: 'м/с' },
      { symbol: 'g', name: 'ускорение свободного падения', unit: 'м/с²' },
      { symbol: 't', name: 'время падения', unit: 'с' },
    ],
    physicalMeaning: 'Частный случай kin.03 при v₀ = 0. Скорость растёт линейно с временем.',
    proportionality: {
      direct: ['g → v', 't → v'],
      inverse: [],
    },
    dimensions: '[L/T] = [L/T²] * [T]',
    derivedFrom: 'kin.03 при v₀ = 0, a = g',
    whenToUse: [
      'Свободное падение без начальной скорости',
      'Найти скорость в момент t при падении',
    ],
    commonMistakes: ['Применяют для тела, брошенного вверх — там v₀ ≠ 0'],
    relatedFormulas: ['kin.03', 'kin.07'],
    difficulty: 1,
  },
  {
    id: 'kin.09',
    section: 'Кинематика',
    topic: 'Движение по окружности',
    name: 'Линейная скорость при движении по окружности',
    formula: 'v = \\frac{2 \\pi R}{T}',
    formulaPlain: 'v = 2πR / T',
    variables: [
      { symbol: 'v', name: 'линейная скорость', unit: 'м/с' },
      { symbol: 'R', name: 'радиус окружности', unit: 'м' },
      { symbol: 'T', name: 'период обращения', unit: 'с' },
    ],
    physicalMeaning: 'За один оборот (период T) тело проходит длину окружности 2πR. Скорость = путь/время.',
    proportionality: {
      direct: ['R → v'],
      inverse: ['T → v'],
    },
    dimensions: '[L/T] = [L] / [T]',
    derivedFrom: 'Определение: v = длина_окружности / период',
    whenToUse: [
      'Тело движется по окружности',
      'Известен радиус и период (или частота)',
      'Спутники, карусели, колёса',
    ],
    commonMistakes: [
      'Путают период T (время одного оборота) и частоту ν (число оборотов в секунду)',
      'Забывают 2π',
    ],
    relatedFormulas: ['kin.10', 'kin.11', 'kin.12'],
    difficulty: 2,
  },
  {
    id: 'kin.10',
    section: 'Кинематика',
    topic: 'Движение по окружности',
    name: 'Связь периода и частоты',
    formula: 'T = \\frac{1}{\\nu}',
    formulaPlain: 'T = 1 / ν',
    variables: [
      { symbol: 'T', name: 'период', unit: 'с' },
      { symbol: 'ν', name: 'частота', unit: 'Гц (1/с)' },
    ],
    physicalMeaning:
      'Период и частота — обратные величины. Если за секунду 5 оборотов (ν=5), то один оборот занимает 1/5 секунды (T=0.2).',
    proportionality: {
      direct: [],
      inverse: ['ν → T'],
    },
    dimensions: '[T] = 1 / [1/T]',
    derivedFrom: 'Определение',
    whenToUse: [
      'Нужно перевести частоту в период или наоборот',
      'Дана частота вращения, а в формуле нужен период',
    ],
    commonMistakes: ['Путают T и ν местами: T = ν (неверно!)'],
    relatedFormulas: ['kin.09'],
    difficulty: 1,
  },
  {
    id: 'kin.11',
    section: 'Кинематика',
    topic: 'Движение по окружности',
    name: 'Угловая скорость',
    formula: '\\omega = \\frac{2\\pi}{T} = 2\\pi\\nu',
    formulaPlain: 'ω = 2π/T = 2πν',
    variables: [
      { symbol: 'ω', name: 'угловая скорость', unit: 'рад/с' },
      { symbol: 'T', name: 'период', unit: 'с' },
      { symbol: 'ν', name: 'частота', unit: 'Гц' },
    ],
    physicalMeaning: 'За один оборот тело проходит угол 2π радиан. Угловая скорость — сколько радиан в секунду.',
    proportionality: {
      direct: ['ν → ω'],
      inverse: ['T → ω'],
    },
    dimensions: '[1/T] = [1/T]',
    derivedFrom: 'Определение: ω = угол / время = 2π / T',
    whenToUse: [
      'Задачи на вращение',
      'Нужно перейти от линейных величин к угловым',
    ],
    commonMistakes: [
      'Забывают 2π (пишут ω = 1/T вместо ω = 2π/T)',
      'Путают обороты в минуту с частотой в Гц',
    ],
    relatedFormulas: ['kin.09', 'kin.10', 'kin.12'],
    difficulty: 2,
  },
  {
    id: 'kin.12',
    section: 'Кинематика',
    topic: 'Движение по окружности',
    name: 'Центростремительное ускорение',
    formula: 'a_{цс} = \\frac{v^2}{R} = \\omega^2 R',
    formulaPlain: 'a_цс = v²/R = ω²R',
    variables: [
      { symbol: 'a_цс', name: 'центростремительное ускорение', unit: 'м/с²' },
      { symbol: 'v', name: 'линейная скорость', unit: 'м/с' },
      { symbol: 'R', name: 'радиус', unit: 'м' },
      { symbol: 'ω', name: 'угловая скорость', unit: 'рад/с' },
    ],
    physicalMeaning:
      "Ускорение, направленное к центру окружности. Нужно, чтобы тело 'заворачивало' по кривой, а не летело прямо.",
    proportionality: {
      direct: ['v² → a_цс'],
      inverse: ['R → a_цс (при фикс. v)'],
    },
    dimensions: '[L/T²] = [L²/T²] / [L]',
    derivedFrom: 'Геометрический вывод из изменения вектора скорости',
    whenToUse: [
      'Тело движется по окружности',
      'Нужно найти ускорение при круговом движении',
      'Связь с силой: F = ma_цс = mv²/R',
    ],
    commonMistakes: [
      'Путают v²/R и vR',
      'Путают формы: v²/R и ω²R дают разные зависимости от R!',
      'Забывают, что ускорение направлено к ЦЕНТРУ, а не по касательной',
    ],
    relatedFormulas: ['kin.09', 'kin.11', 'dyn.04'],
    difficulty: 2,
  },
];

const formulasById = new Map(kinematicsFormulas.map((formula) => [formula.id, formula]));

export function getFormulaById(id: string): Formula | undefined {
  return formulasById.get(id);
}

export function getRelatedFormulas(formulaId: string): Formula[] {
  const formula = getFormulaById(formulaId);

  if (!formula) {
    return [];
  }

  // Phase 1a keeps only the kinematics slice in TS, so cross-section references stay as IDs
  // but are filtered out here until the wider mechanics catalog is added.
  return formula.relatedFormulas
    .map((relatedId) => formulasById.get(relatedId))
    .filter((relatedFormula): relatedFormula is Formula => Boolean(relatedFormula));
}
