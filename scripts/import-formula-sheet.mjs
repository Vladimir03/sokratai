#!/usr/bin/env node
/**
 * Import "Механика" sheet → generated TS catalogs for the formula trainer.
 *
 * Reads `scripts/data/mechanika-source.csv`, filters rows by status
 * (`ready` or `review`), and writes three generated files:
 *   - src/lib/formulaEngine/formulas.generated.ts
 *   - src/lib/formulaEngine/recipes.generated.ts
 *   - src/lib/formulaEngine/mutations.generated.ts
 *
 * Re-run after refreshing the CSV snapshot:
 *   node scripts/import-formula-sheet.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'scripts/data/mechanika-source.csv');
const OUT_DIR = path.join(ROOT, 'src/lib/formulaEngine');

// ---------- CSV parser ----------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\r') {
        // skip
      } else field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------- Field parsers ----------
function stripOuterDollars(latex) {
  const trimmed = latex.trim();
  // Only strip if both ends are bare $ and no internal $ as delimiters
  if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeMathToken(token) {
  return token
    .replace(/_\{([А-Яа-яЁё]+)\}/gu, '_{\\text{$1}}')
    .replace(/_([А-Яа-яЁё]+)/gu, '_{\\text{$1}}');
}

function normalizeLatexCyrillic(latex) {
  // Apply same substitution to whole LaTeX expressions (a_цс → a_{\text{цс}})
  return latex
    .replace(/_\{([А-Яа-яЁё]+)\}/gu, '_{\\text{$1}}')
    .replace(/_([А-Яа-яЁё])/gu, '_{\\text{$1}}');
}

function parseVariables(raw) {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Format: "symbol — name (unit)"  OR  "symbol — name"
      const m = line.match(/^(.+?)\s*[—–-]\s*(.+?)(?:\s*\(([^)]*)\))?$/u);
      if (!m) {
        return { symbol: line, name: line, unit: '' };
      }
      return {
        symbol: m[1].trim(),
        name: m[2].trim(),
        unit: (m[3] || '').trim(),
      };
    });
}

function parseProportionality(raw) {
  const result = { direct: [], inverse: [] };
  if (!raw) return result;
  for (const lineRaw of raw.split('\n')) {
    const line = lineRaw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    let bucket = null;
    let body = line;
    if (lower.startsWith('прямая')) {
      bucket = 'direct';
      body = line.replace(/^прямая\s*:?/iu, '').trim();
    } else if (lower.startsWith('обратная')) {
      bucket = 'inverse';
      body = line.replace(/^обратная\s*:?/iu, '').trim();
    }
    if (!bucket) continue;
    const items = body
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    result[bucket].push(...items);
  }
  return result;
}

function parseListField(raw) {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.replace(/^[\s•\-–—*]+/u, '').trim())
    .filter(Boolean);
}

function parseRelatedFormulas(raw) {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDifficulty(raw) {
  const n = Number.parseInt(String(raw || '').trim(), 10);
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
}

function parseExam(raw) {
  const v = String(raw || '').trim();
  if (v === 'ЕГЭ' || v === 'ОГЭ' || v === 'ЕГЭ+ОГЭ') return v;
  return null;
}

function parseMutations(raw) {
  if (!raw) return [];
  const mutations = [];
  for (const lineRaw of raw.split('\n')) {
    const line = lineRaw.trim();
    if (!line) continue;
    // Format: "type; latex; hint"
    const parts = line.split(';');
    if (parts.length < 3) continue;
    const type = parts[0].trim();
    const latex = parts[1].trim();
    const hint = parts.slice(2).join(';').trim();
    if (!type || !latex || !hint) continue;
    mutations.push({
      type,
      latex: normalizeLatexCyrillic(latex),
      hint,
    });
  }
  return mutations;
}

function parseRecipe(raw, displayLatex) {
  if (!raw) return null;
  // Format: "numerator: a, b | denominator: c"
  const text = raw.trim();
  const numMatch = text.match(/numerator\s*:\s*([^|]*)/iu);
  const denMatch = text.match(/denominator\s*:\s*(.*)$/iu);
  if (!numMatch && !denMatch) return null;
  const splitTokens = (s) =>
    (s || '')
      .trim()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map(normalizeMathToken);
  return {
    displayFormula: displayLatex,
    numeratorTokens: splitTokens(numMatch?.[1]),
    denominatorTokens: splitTokens(denMatch?.[1]),
  };
}

// ---------- Section bucket ----------
const SECTION_TO_BUCKET = {
  Кинематика: 'kinematics',
  Динамика: 'dynamics',
  'Законы сохранения': 'conservation',
  Статика: 'statics',
  Гидростатика: 'hydrostatics',
};

// ---------- Main ----------
function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH}`);
    process.exit(1);
  }
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(csv);
  const headers = rows[0];

  const idx = (label) => headers.findIndex((h) => h.toLowerCase().startsWith(label.toLowerCase()));
  const COL = {
    id: 0,
    exam: idx('Экзамен'),
    section: idx('Раздел'),
    topic: idx('Тема'),
    subtopic: idx('Подтема'),
    name: idx('Название'),
    buildTitle: idx('Подсказка'),
    latex: idx('Формула (LaTeX)'),
    plain: idx('Формула (текст)'),
    variables: idx('Переменные'),
    physicalMeaning: idx('Физический смысл'),
    proportionality: idx('Зависимости'),
    dimensions: idx('Размерности'),
    derivedFrom: idx('Откуда'),
    whenToUse: idx('Когда применять'),
    commonMistakes: idx('Частые ошибки'),
    relatedFormulas: idx('Связанные'),
    difficulty: idx('Сложность'),
    mutations: idx('Мутации'),
    recipe: idx('Рецепт'),
    status: idx('Статус'),
  };

  const buckets = {
    kinematics: [],
    dynamics: [],
    conservation: [],
    statics: [],
    hydrostatics: [],
  };
  const mutationsMap = {};
  const recipesMap = {};
  const supportedBuildIds = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = (r[COL.id] || '').trim();
    if (!id) continue;
    const status = (r[COL.status] || '').trim().toLowerCase();
    if (status !== 'ready' && status !== 'review') continue;

    const topic = (r[COL.topic] || '').trim();
    const subtopic = (r[COL.subtopic] || '').trim();
    const sectionKey = SECTION_TO_BUCKET[topic];
    if (!sectionKey) {
      console.warn(`Unknown section "${topic}" for ${id}; skipping`);
      continue;
    }

    const latexStripped = stripOuterDollars(r[COL.latex] || '');
    const formulaLatex = normalizeLatexCyrillic(latexStripped);
    const formulaPlain = (r[COL.plain] || '').trim();

    const formula = {
      id,
      section: topic, // Кинематика/Динамика/...
      topic: subtopic ? `${topic} — ${subtopic}` : topic,
      name: (r[COL.name] || '').trim(),
      buildTitle: (r[COL.buildTitle] || '').trim() || undefined,
      formula: formulaLatex,
      formulaPlain,
      variables: parseVariables(r[COL.variables]),
      physicalMeaning: (r[COL.physicalMeaning] || '').trim(),
      proportionality: parseProportionality(r[COL.proportionality]),
      dimensions: (r[COL.dimensions] || '').trim(),
      derivedFrom: (r[COL.derivedFrom] || '').trim(),
      whenToUse: parseListField(r[COL.whenToUse]),
      commonMistakes: parseListField(r[COL.commonMistakes]),
      relatedFormulas: parseRelatedFormulas(r[COL.relatedFormulas]),
      difficulty: parseDifficulty(r[COL.difficulty]),
    };
    const exam = parseExam(r[COL.exam]);
    if (exam) formula.exam = exam;

    buckets[sectionKey].push(formula);

    const muts = parseMutations(r[COL.mutations]);
    if (muts.length > 0) mutationsMap[id] = muts;

    const recipe = parseRecipe(r[COL.recipe], formulaLatex);
    if (recipe) {
      recipesMap[id] = recipe;
      supportedBuildIds.push(id);
    }
  }

  // ---------- Render TS files ----------
  const HEADER = '// AUTO-GENERATED FILE — do not edit by hand.\n// Source: scripts/data/mechanika-source.csv (sheet "Механика", статусы ready/review).\n// Regenerate via: node scripts/import-formula-sheet.mjs\n';

  const json = (v) => JSON.stringify(v, null, 2);

  const formulasOut = `${HEADER}
import type { Formula } from './types';

export const kinematicsFormulas: Formula[] = ${json(buckets.kinematics)};

export const dynamicsFormulas: Formula[] = ${json(buckets.dynamics)};

export const conservationFormulas: Formula[] = ${json(buckets.conservation)};

export const staticsFormulas: Formula[] = ${json(buckets.statics)};

export const hydrostaticsFormulas: Formula[] = ${json(buckets.hydrostatics)};
`;

  const recipesOut = `${HEADER}
export interface BuildRecipe {
  displayFormula: string;
  numeratorTokens: string[];
  denominatorTokens: string[];
}

export const BUILD_RECIPES: Record<string, BuildRecipe> = ${json(recipesMap)};

export const SUPPORTED_BUILD_FORMULA_IDS: ReadonlySet<string> = new Set(${json(supportedBuildIds)});
`;

  const mutationsOut = `${HEADER}
export type MutationType = 'swap_fraction' | 'drop_coefficient' | 'wrong_power' | 'swap_variable';

export interface FormulaMutation {
  type: MutationType;
  latex: string;
  hint: string;
}

export const MUTATION_LIBRARY: Record<string, FormulaMutation[]> = ${json(mutationsMap)};
`;

  fs.writeFileSync(path.join(OUT_DIR, 'formulas.generated.ts'), formulasOut);
  fs.writeFileSync(path.join(OUT_DIR, 'recipes.generated.ts'), recipesOut);
  fs.writeFileSync(path.join(OUT_DIR, 'mutations.generated.ts'), mutationsOut);

  const total = Object.values(buckets).reduce((s, arr) => s + arr.length, 0);
  console.log('Generated:');
  console.log(`  formulas: ${total} (kin=${buckets.kinematics.length}, dyn=${buckets.dynamics.length}, cons=${buckets.conservation.length}, stat=${buckets.statics.length}, hydro=${buckets.hydrostatics.length})`);
  console.log(`  recipes:  ${Object.keys(recipesMap).length}`);
  console.log(`  mutations: ${Object.keys(mutationsMap).length}`);
}

main();
