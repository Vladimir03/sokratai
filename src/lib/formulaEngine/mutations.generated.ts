// AUTO-GENERATED FILE — do not edit by hand.
// Source: scripts/data/mechanika-source.csv (sheet "Механика", статусы ready/review).
// Regenerate via: node scripts/import-formula-sheet.mjs

export type MutationType = 'swap_fraction' | 'drop_coefficient' | 'wrong_power' | 'swap_variable';

export interface FormulaMutation {
  type: MutationType;
  latex: string;
  hint: string;
}

export const MUTATION_LIBRARY: Record<string, FormulaMutation[]> = {
  "kin.01": [
    {
      "type": "swap_variable",
      "latex": "s = a \\cdot t",
      "hint": "Перемещение связано со скоростью, а не с ускорением напрямую."
    },
    {
      "type": "wrong_power",
      "latex": "s = v \\cdot t^2",
      "hint": "При равномерном движении время входит линейно, без квадрата."
    }
  ],
  "kin.02": [
    {
      "type": "swap_fraction",
      "latex": "v_{\\text{ср}} = \\frac{t_{\\text{общ}}}{s_{\\text{общ}}}",
      "hint": "Средняя скорость считается как путь, делённый на время, а не наоборот."
    }
  ],
  "kin.03": [
    {
      "type": "wrong_power",
      "latex": "v = v_0 + a \\cdot t^2",
      "hint": "В формуле скорости при равноускоренном движении время не возводится в квадрат."
    },
    {
      "type": "swap_variable",
      "latex": "v = v_0 + g \\cdot t",
      "hint": "Здесь нужен общий символ ускорения a, а не частный случай g."
    }
  ],
  "kin.04": [
    {
      "type": "drop_coefficient",
      "latex": "s = v_0 t + a t^2",
      "hint": "У разгонного вклада обязательно есть делитель 2."
    },
    {
      "type": "wrong_power",
      "latex": "s = v_0 t + \\frac{a t}{2}",
      "hint": "Добавка от ускорения зависит от квадрата времени, а не от t."
    }
  ],
  "kin.05": [
    {
      "type": "drop_coefficient",
      "latex": "s = (v + v_0) \\cdot t",
      "hint": "Средняя скорость здесь равна полусумме скоростей, поэтому деление на 2 обязательно."
    }
  ],
  "kin.06": [
    {
      "type": "drop_coefficient",
      "latex": "v^2 = v_0^2 + as",
      "hint": "В формуле без времени перед as обязательно стоит множитель 2."
    },
    {
      "type": "wrong_power",
      "latex": "v = v_0^2 + 2as",
      "hint": "Связь без времени работает через квадрат скорости."
    }
  ],
  "kin.07": [
    {
      "type": "drop_coefficient",
      "latex": "h = g t^2",
      "hint": "При свободном падении без начальной скорости сохраняется деление на 2."
    },
    {
      "type": "wrong_power",
      "latex": "h = \\frac{g t}{2}",
      "hint": "Высота падения растёт как t^2, а не линейно по времени."
    }
  ],
  "kin.08": [
    {
      "type": "swap_variable",
      "latex": "v = g \\cdot h",
      "hint": "Скорость свободного падения зависит от времени, а не от высоты напрямую."
    },
    {
      "type": "wrong_power",
      "latex": "v = g \\cdot t^2",
      "hint": "Скорость при свободном падении растёт линейно по времени."
    }
  ],
  "kin.09": [
    {
      "type": "swap_fraction",
      "latex": "v = \\frac{T}{2 \\pi R}",
      "hint": "Линейная скорость при движении по окружности равна длине окружности, делённой на период."
    },
    {
      "type": "drop_coefficient",
      "latex": "v = \\frac{R}{T}",
      "hint": "За один оборот тело проходит 2πR, поэтому 2π нельзя терять."
    }
  ],
  "kin.10": [
    {
      "type": "swap_fraction",
      "latex": "T = \\nu",
      "hint": "Период и частота обратны друг другу."
    }
  ],
  "kin.11": [
    {
      "type": "drop_coefficient",
      "latex": "\\omega = \\frac{1}{T} = \\nu",
      "hint": "Угловая скорость связана с полным оборотом 2π радиан, поэтому 2π обязательно."
    },
    {
      "type": "swap_fraction",
      "latex": "\\omega = \\frac{T}{2\\pi}",
      "hint": "При росте периода угловая скорость уменьшается, значит T должен быть в знаменателе."
    }
  ],
  "kin.12": [
    {
      "type": "wrong_power",
      "latex": "a_{\\text{цс}} = \\frac{v}{R} = \\omega R",
      "hint": "Центростремительное ускорение зависит от квадрата скорости и квадрата угловой скорости."
    },
    {
      "type": "swap_variable",
      "latex": "a_{\\text{цс}} = \\frac{v^2}{T}",
      "hint": "В формуле кругового движения нужен радиус R, а не период T."
    }
  ],
  "dyn.01": [
    {
      "type": "swap_fraction",
      "latex": "a = \\frac{m}{F}",
      "hint": "Ускорение обратно пропорционально массе: большая масса — меньше ускорение."
    },
    {
      "type": "swap_variable",
      "latex": "F = a / m",
      "hint": "Сила пропорциональна массе и ускорению, нужно умножение, а не деление."
    }
  ],
  "dyn.02": [
    {
      "type": "swap_variable",
      "latex": "f = \\mu + N",
      "hint": "Сила трения зависит от произведения коэффициента и нормальной силы."
    },
    {
      "type": "drop_coefficient",
      "latex": "f = N",
      "hint": "Коэффициент трения μ определяет, какую часть нормальной силы составляет трение."
    }
  ],
  "dyn.03": [
    {
      "type": "swap_variable",
      "latex": "F_g = m + g",
      "hint": "Вес — произведение массы на ускорение свободного падения."
    },
    {
      "type": "wrong_power",
      "latex": "F_g = m \\cdot g^2",
      "hint": "g не возводится в степень в формуле веса."
    }
  ],
  "dyn.04": [
    {
      "type": "wrong_power",
      "latex": "F_c = \\frac{m v}{R}",
      "hint": "Центростремительная сила зависит от квадрата скорости."
    },
    {
      "type": "swap_variable",
      "latex": "F_c = \\frac{v^2}{m R}",
      "hint": "Масса умножается на ускорение, она в числителе."
    }
  ],
  "dyn.05": [
    {
      "type": "swap_fraction",
      "latex": "F_{AB} = F_{BA}",
      "hint": "Силы действия и противодействия противоположны по направлению."
    }
  ],
  "dyn.06": [
    {
      "type": "swap_variable",
      "latex": "F = \\Delta x / k",
      "hint": "Сила упругости пропорциональна деформации, k в числителе."
    },
    {
      "type": "drop_coefficient",
      "latex": "F = \\Delta x",
      "hint": "Жёсткость k показывает, насколько сильно пружина сопротивляется деформации."
    }
  ],
  "cons.01": [
    {
      "type": "swap_variable",
      "latex": "p = v / m",
      "hint": "Импульс — произведение, а не отношение."
    }
  ],
  "cons.02": [
    {
      "type": "swap_fraction",
      "latex": "m_1 v_1 - m_2 v_2 = m_1 v_1' - m_2 v_2'",
      "hint": "В законе сохранения импульса складываются импульсы, а не вычитаются."
    }
  ],
  "cons.03": [
    {
      "type": "drop_coefficient",
      "latex": "E_k = m v^2",
      "hint": "Кинетическая энергия содержит делитель 2 в формуле."
    },
    {
      "type": "wrong_power",
      "latex": "E_k = \\frac{m v}{2}",
      "hint": "Энергия зависит от квадрата скорости, а не от первой степени."
    }
  ],
  "cons.04": [
    {
      "type": "swap_variable",
      "latex": "E_p = m \\cdot g / h",
      "hint": "Потенциальная энергия растёт с высотой, h в числителе."
    },
    {
      "type": "wrong_power",
      "latex": "E_p = m \\cdot g \\cdot h^2",
      "hint": "Потенциальная энергия линейна по высоте, без квадрата."
    }
  ],
  "cons.05": [
    {
      "type": "swap_variable",
      "latex": "E_k - E_p = \\text{const}",
      "hint": "При сохранении механической энергии кинетическая и потенциальная складываются."
    }
  ],
  "cons.06": [
    {
      "type": "drop_coefficient",
      "latex": "A = F \\cdot s",
      "hint": "Угол между силой и перемещением влияет на работу через косинус."
    },
    {
      "type": "wrong_power",
      "latex": "A = F^2 \\cdot s",
      "hint": "Работа линейна по силе, не зависит от её квадрата."
    }
  ],
  "cons.07": [
    {
      "type": "swap_fraction",
      "latex": "P = \\frac{t}{A}",
      "hint": "Мощность — работа, делённая на время, а не наоборот."
    },
    {
      "type": "swap_variable",
      "latex": "P = F / v",
      "hint": "Мощность может быть выражена как произведение силы и скорости."
    }
  ],
  "stat.01": [
    {
      "type": "swap_fraction",
      "latex": "\\sum F = \\text{max}",
      "hint": "При равновесии сумма всех сил должна быть нулевой."
    }
  ],
  "hydro.01": [
    {
      "type": "swap_fraction",
      "latex": "P = \\frac{S}{F}",
      "hint": "Давление — сила, делённая на площадь."
    },
    {
      "type": "wrong_power",
      "latex": "P = F \\cdot S",
      "hint": "Давление — это отношение силы к площади, а не произведение."
    }
  ],
  "hydro.02": [
    {
      "type": "drop_coefficient",
      "latex": "P = P_0 + \\rho \\cdot g \\cdot h / 2",
      "hint": "Гидростатическое давление растёт линейно с глубиной, без делителя."
    },
    {
      "type": "swap_variable",
      "latex": "P = \\rho \\cdot g \\cdot h",
      "hint": "Полное давление включает атмосферное давление P₀."
    }
  ],
  "hydro.03": [
    {
      "type": "swap_variable",
      "latex": "F_A = m \\cdot g \\cdot V",
      "hint": "Архимедова сила зависит от плотности жидкости, а не от плотности тела."
    },
    {
      "type": "drop_coefficient",
      "latex": "F_A = \\rho \\cdot V",
      "hint": "Архимедова сила равна весу вытесненной жидкости: ρgV."
    }
  ],
  "hydro.04": [
    {
      "type": "swap_fraction",
      "latex": "\\frac{S_1}{F_1} = \\frac{S_2}{F_2}",
      "hint": "В гидравлическом прессе давление одинаково, поэтому F/S постоянно."
    },
    {
      "type": "swap_variable",
      "latex": "F_1 \\cdot S_1 = F_2 \\cdot S_2",
      "hint": "Закон Паскаля основан на равенстве давлений, а не на равенстве произведений."
    }
  ],
  "kin.13": [
    {
      "type": "swap_fraction",
      "latex": "\\nu = \\frac{t}{N}",
      "hint": "Частота равна числу оборотов за время, а не времени на один оборот."
    },
    {
      "type": "swap_variable",
      "latex": "\\nu = N \\cdot t",
      "hint": "При увеличении времени при том же числе оборотов частота уменьшается, поэтому t должно быть в знаменателе."
    }
  ],
  "kin.14": [
    {
      "type": "swap_fraction",
      "latex": "T = \\frac{N}{t}",
      "hint": "Период равен времени одного оборота, значит время должно стоять в числителе."
    },
    {
      "type": "swap_variable",
      "latex": "T = t \\cdot N",
      "hint": "Чем больше оборотов за фиксированное время, тем меньше период, а не больше."
    }
  ],
  "kin.15": [
    {
      "type": "swap_fraction",
      "latex": "\\nu = T",
      "hint": "Частота и период обратны друг другу, а не равны."
    },
    {
      "type": "swap_variable",
      "latex": "\\nu = \\frac{T}{1}",
      "hint": "Если период растёт, частота уменьшается, поэтому T должно стоять в знаменателе."
    }
  ],
  "kin.16": [
    {
      "type": "swap_fraction",
      "latex": "v = \\frac{T}{2\\pi R}",
      "hint": "Скорость равна длине окружности, делённой на период, а не наоборот."
    },
    {
      "type": "drop_coefficient",
      "latex": "v = \\frac{R}{T}",
      "hint": "За один оборот точка проходит 2πR, поэтому множитель 2π терять нельзя."
    }
  ],
  "kin.17": [
    {
      "type": "swap_fraction",
      "latex": "\\phi = \\frac{R}{l}",
      "hint": "Радианная мера угла равна длине дуги, делённой на радиус."
    },
    {
      "type": "swap_variable",
      "latex": "\\phi = l \\cdot R",
      "hint": "При увеличении радиуса при той же дуге угол уменьшается, поэтому R должно быть в знаменателе."
    }
  ],
  "kin.18": [
    {
      "type": "swap_fraction",
      "latex": "\\omega = \\frac{t}{\\phi}",
      "hint": "Угловая скорость равна углу поворота за время, а не времени на угол."
    },
    {
      "type": "swap_variable",
      "latex": "\\omega = \\phi \\cdot t",
      "hint": "При фиксированном угле большему времени соответствует меньшая угловая скорость."
    }
  ],
  "kin.19": [
    {
      "type": "drop_coefficient",
      "latex": "\\omega = \\frac{1}{T}",
      "hint": "За один оборот тело проходит угол 2π рад, поэтому множитель 2π обязателен."
    },
    {
      "type": "swap_fraction",
      "latex": "\\omega = \\frac{T}{2\\pi}",
      "hint": "При увеличении периода угловая скорость уменьшается, значит T должно быть в знаменателе."
    }
  ],
  "kin.20": [
    {
      "type": "swap_variable",
      "latex": "v = \\frac{\\omega}{R}",
      "hint": "Чем больше радиус при той же угловой скорости, тем больше линейная скорость, поэтому R должно умножаться."
    },
    {
      "type": "wrong_power",
      "latex": "v = \\omega R^2",
      "hint": "Линейная скорость растёт пропорционально радиусу, а не квадрату радиуса."
    }
  ],
  "kin.21": [
    {
      "type": "wrong_power",
      "latex": "a_{\\text{цс}} = \\frac{v}{R}",
      "hint": "Центростремительное ускорение зависит от квадрата линейной скорости."
    },
    {
      "type": "swap_variable",
      "latex": "a_{\\text{цс}} = \\frac{v^2}{T}",
      "hint": "В этой формуле нужен радиус окружности, а не период вращения."
    }
  ],
  "kin.22": [
    {
      "type": "wrong_power",
      "latex": "a_{\\text{цс}} = \\omega R",
      "hint": "Центростремительное ускорение зависит от квадрата угловой скорости."
    },
    {
      "type": "swap_variable",
      "latex": "a_{\\text{цс}} = \\frac{\\omega^2}{R}",
      "hint": "При фиксированной угловой скорости увеличение радиуса увеличивает ускорение, поэтому R должно быть в числителе."
    }
  ]
};
