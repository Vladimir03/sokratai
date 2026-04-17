// AUTO-GENERATED FILE — do not edit by hand.
// Source: scripts/data/mechanika-source.csv (sheet "Механика", статусы ready/review).
// Regenerate via: node scripts/import-formula-sheet.mjs

export interface BuildRecipe {
  displayFormula: string;
  numeratorTokens: string[];
  denominatorTokens: string[];
}

export const BUILD_RECIPES: Record<string, BuildRecipe> = {
  "kin.01": {
    "displayFormula": "s = v \\cdot t",
    "numeratorTokens": [
      "v",
      "t"
    ],
    "denominatorTokens": []
  },
  "kin.02": {
    "displayFormula": "v_{\\text{ср}} = \\frac{s_{\\text{общ}}}{t_{\\text{общ}}}",
    "numeratorTokens": [
      "s_{\\text{общ}}"
    ],
    "denominatorTokens": [
      "t_{\\text{общ}}"
    ]
  },
  "kin.03": {
    "displayFormula": "v = v_0 + a \\cdot t",
    "numeratorTokens": [
      "v_0",
      "a",
      "t"
    ],
    "denominatorTokens": []
  },
  "kin.04": {
    "displayFormula": "s = v_0 t + \\frac{a t^2}{2}",
    "numeratorTokens": [
      "v_0",
      "t",
      "a",
      "t^2"
    ],
    "denominatorTokens": [
      "2"
    ]
  },
  "kin.05": {
    "displayFormula": "s = \\frac{v + v_0}{2} \\cdot t",
    "numeratorTokens": [
      "v",
      "v_0",
      "t"
    ],
    "denominatorTokens": [
      "2"
    ]
  },
  "kin.06": {
    "displayFormula": "v^2 = v_0^2 + 2as",
    "numeratorTokens": [
      "v_0^2",
      "2",
      "a",
      "s"
    ],
    "denominatorTokens": []
  },
  "kin.07": {
    "displayFormula": "h = \\frac{g t^2}{2}",
    "numeratorTokens": [
      "g",
      "t^2"
    ],
    "denominatorTokens": [
      "2"
    ]
  },
  "kin.08": {
    "displayFormula": "v = g \\cdot t",
    "numeratorTokens": [
      "g",
      "t"
    ],
    "denominatorTokens": []
  },
  "kin.09": {
    "displayFormula": "v = \\frac{2 \\pi R}{T}",
    "numeratorTokens": [
      "2\\pi",
      "R"
    ],
    "denominatorTokens": [
      "T"
    ]
  },
  "kin.10": {
    "displayFormula": "T = \\frac{1}{\\nu}",
    "numeratorTokens": [
      "1"
    ],
    "denominatorTokens": [
      "\\nu"
    ]
  },
  "kin.11": {
    "displayFormula": "\\omega = \\frac{2\\pi}{T} = 2\\pi\\nu",
    "numeratorTokens": [
      "2\\pi"
    ],
    "denominatorTokens": [
      "T"
    ]
  },
  "kin.12": {
    "displayFormula": "a_{\\text{цс}} = \\frac{v^2}{R} = \\omega^2 R",
    "numeratorTokens": [
      "v^2"
    ],
    "denominatorTokens": [
      "R"
    ]
  },
  "dyn.01": {
    "displayFormula": "F = m \\cdot a",
    "numeratorTokens": [
      "F"
    ],
    "denominatorTokens": [
      "m",
      "a"
    ]
  },
  "dyn.02": {
    "displayFormula": "f = \\mu \\cdot N",
    "numeratorTokens": [
      "\\mu",
      "N"
    ],
    "denominatorTokens": []
  },
  "dyn.03": {
    "displayFormula": "F_g = m \\cdot g",
    "numeratorTokens": [
      "m",
      "g"
    ],
    "denominatorTokens": []
  },
  "dyn.04": {
    "displayFormula": "F_c = m \\cdot a_c = \\frac{m v^2}{R} = m \\omega^2 R",
    "numeratorTokens": [
      "m",
      "v^2"
    ],
    "denominatorTokens": [
      "R"
    ]
  },
  "dyn.05": {
    "displayFormula": "F_{AB} = -F_{BA}",
    "numeratorTokens": [
      "F_{AB}"
    ],
    "denominatorTokens": []
  },
  "dyn.06": {
    "displayFormula": "F = k \\cdot \\Delta x",
    "numeratorTokens": [
      "k",
      "\\Delta x"
    ],
    "denominatorTokens": []
  },
  "cons.01": {
    "displayFormula": "p = m \\cdot v",
    "numeratorTokens": [
      "m",
      "v"
    ],
    "denominatorTokens": []
  },
  "cons.02": {
    "displayFormula": "m_1 v_1 + m_2 v_2 = m_1 v_1' + m_2 v_2'",
    "numeratorTokens": [
      "m_1",
      "v_1",
      "m_2",
      "v_2"
    ],
    "denominatorTokens": []
  },
  "cons.03": {
    "displayFormula": "E_k = \\frac{m v^2}{2}",
    "numeratorTokens": [
      "m",
      "v^2"
    ],
    "denominatorTokens": [
      "2"
    ]
  },
  "cons.04": {
    "displayFormula": "E_p = m \\cdot g \\cdot h",
    "numeratorTokens": [
      "m",
      "g",
      "h"
    ],
    "denominatorTokens": []
  },
  "cons.05": {
    "displayFormula": "E_k + E_p = \\text{const}",
    "numeratorTokens": [
      "E_k",
      "E_p"
    ],
    "denominatorTokens": []
  },
  "cons.06": {
    "displayFormula": "A = F \\cdot s \\cdot \\cos(\\alpha)",
    "numeratorTokens": [
      "F",
      "s",
      "\\cos(\\alpha)"
    ],
    "denominatorTokens": []
  },
  "cons.07": {
    "displayFormula": "P = \\frac{A}{t} = F \\cdot v",
    "numeratorTokens": [
      "A"
    ],
    "denominatorTokens": [
      "t"
    ]
  },
  "stat.01": {
    "displayFormula": "\\sum F = 0",
    "numeratorTokens": [
      "F_1",
      "F_2"
    ],
    "denominatorTokens": []
  },
  "hydro.01": {
    "displayFormula": "P = \\frac{F}{S}",
    "numeratorTokens": [
      "F"
    ],
    "denominatorTokens": [
      "S"
    ]
  },
  "hydro.02": {
    "displayFormula": "P = P_0 + \\rho \\cdot g \\cdot h",
    "numeratorTokens": [
      "P_0",
      "\\rho",
      "g",
      "h"
    ],
    "denominatorTokens": []
  },
  "hydro.03": {
    "displayFormula": "F_A = \\rho \\cdot g \\cdot V",
    "numeratorTokens": [
      "\\rho",
      "g",
      "V"
    ],
    "denominatorTokens": []
  },
  "hydro.04": {
    "displayFormula": "\\frac{F_1}{S_1} = \\frac{F_2}{S_2}",
    "numeratorTokens": [
      "F_1",
      "S_2"
    ],
    "denominatorTokens": [
      "S_1",
      "F_2"
    ]
  },
  "kin.13": {
    "displayFormula": "\\nu=\\frac{N}{t}",
    "numeratorTokens": [
      "N"
    ],
    "denominatorTokens": [
      "t"
    ]
  },
  "kin.14": {
    "displayFormula": "T=\\frac{t}{N}",
    "numeratorTokens": [
      "t"
    ],
    "denominatorTokens": [
      "N"
    ]
  },
  "kin.15": {
    "displayFormula": "\\nu=\\frac{1}{T}",
    "numeratorTokens": [
      "1"
    ],
    "denominatorTokens": [
      "T"
    ]
  },
  "kin.16": {
    "displayFormula": "v=\\frac{2\\pi R}{T}",
    "numeratorTokens": [
      "2\\pi",
      "R"
    ],
    "denominatorTokens": [
      "T"
    ]
  },
  "kin.17": {
    "displayFormula": "\\phi=\\frac{l}{R}",
    "numeratorTokens": [
      "l"
    ],
    "denominatorTokens": [
      "R"
    ]
  },
  "kin.18": {
    "displayFormula": "\\omega=\\frac{\\phi}{t}",
    "numeratorTokens": [
      "\\phi"
    ],
    "denominatorTokens": [
      "t"
    ]
  },
  "kin.19": {
    "displayFormula": "\\omega=\\frac{2\\pi}{T}",
    "numeratorTokens": [
      "2\\pi"
    ],
    "denominatorTokens": [
      "T"
    ]
  },
  "kin.20": {
    "displayFormula": "v=\\omega R",
    "numeratorTokens": [
      "\\omega",
      "R"
    ],
    "denominatorTokens": []
  },
  "kin.21": {
    "displayFormula": "a_{\\text{цс}} = \\frac{v^2}{R}",
    "numeratorTokens": [
      "v^2"
    ],
    "denominatorTokens": [
      "R"
    ]
  },
  "kin.22": {
    "displayFormula": "a_{\\text{цс}}=\\omega^2R",
    "numeratorTokens": [
      "\\omega^2",
      "R"
    ],
    "denominatorTokens": []
  }
};

export const SUPPORTED_BUILD_FORMULA_IDS: ReadonlySet<string> = new Set([
  "kin.01",
  "kin.02",
  "kin.03",
  "kin.04",
  "kin.05",
  "kin.06",
  "kin.07",
  "kin.08",
  "kin.09",
  "kin.10",
  "kin.11",
  "kin.12",
  "dyn.01",
  "dyn.02",
  "dyn.03",
  "dyn.04",
  "dyn.05",
  "dyn.06",
  "cons.01",
  "cons.02",
  "cons.03",
  "cons.04",
  "cons.05",
  "cons.06",
  "cons.07",
  "stat.01",
  "hydro.01",
  "hydro.02",
  "hydro.03",
  "hydro.04",
  "kin.13",
  "kin.14",
  "kin.15",
  "kin.16",
  "kin.17",
  "kin.18",
  "kin.19",
  "kin.20",
  "kin.21",
  "kin.22"
]);
