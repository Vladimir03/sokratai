// Catalog of mechanics formulas. Data is sourced from the Google Sheet
// "Механика" via `scripts/import-formula-sheet.mjs`; this file only re-exports
// the generated arrays and exposes lookup helpers.

import type { Formula } from './types';
import {
  kinematicsFormulas,
  dynamicsFormulas,
  conservationFormulas,
  staticsFormulas,
  hydrostaticsFormulas,
} from './formulas.generated';

export {
  kinematicsFormulas,
  dynamicsFormulas,
  conservationFormulas,
  staticsFormulas,
  hydrostaticsFormulas,
};

export const mechanicsFormulas: Formula[] = [
  ...kinematicsFormulas,
  ...dynamicsFormulas,
  ...conservationFormulas,
  ...staticsFormulas,
  ...hydrostaticsFormulas,
];

const formulasById = new Map(mechanicsFormulas.map((formula) => [formula.id, formula]));

export function getFormulaById(id: string): Formula | undefined {
  return formulasById.get(id);
}

export function getRelatedFormulas(formulaId: string): Formula[] {
  const formula = getFormulaById(formulaId);

  if (!formula) {
    return [];
  }

  return formula.relatedFormulas
    .map((relatedId) => formulasById.get(relatedId))
    .filter((relatedFormula): relatedFormula is Formula => Boolean(relatedFormula));
}
