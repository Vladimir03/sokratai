export interface Variable {
  symbol: string;
  name: string;
  unit: string;
}

export interface Proportionality {
  direct: string[];
  inverse: string[];
}

export type ExamTag = 'ЕГЭ' | 'ОГЭ' | 'ЕГЭ+ОГЭ';

export interface Formula {
  id: string;
  section: string;
  topic: string;
  name: string;
  buildTitle?: string;
  formula: string;
  formulaPlain: string;
  variables: Variable[];
  physicalMeaning: string;
  proportionality: Proportionality;
  dimensions: string;
  derivedFrom: string;
  whenToUse: string[];
  commonMistakes: string[];
  relatedFormulas: string[];
  difficulty: 1 | 2 | 3;
  /** ЕГЭ / ОГЭ / ЕГЭ+ОГЭ filter metadata, sourced from the «Экзамен» column. */
  exam?: ExamTag;
}

export type QuestionType = 'true_or_false' | 'build_formula' | 'situation_to_formula';

export type Layer = 1 | 2 | 3;

export interface BuildFormulaAnswer {
  numerator: string[];
  denominator: string[];
}

export interface FormulaQuestion {
  id: string;
  type: QuestionType;
  layer: Layer;
  formulaId: string;
  prompt: string;
  displayFormula?: string;
  options?: string[];
  correctAnswer: string | boolean | string[] | BuildFormulaAnswer;
  explanation: string;
  mutationType?: string;
}

export interface RoundConfig {
  section: string;
  questionCount: number;
  lives: number;
  formulaPool: Formula[];
  /**
   * Trainer mode. `v1` = simplified Duolingo-style раунд (только Layer 2 +
   * Layer 3, без SituationCard). По умолчанию `v2` — полный трёхслойный
   * раунд. Используется только в standalone trainer `/trainer`.
   */
  mode?: 'v1' | 'v2';
}

export interface AnswerRecord {
  questionId: string;
  formulaId: string;
  questionType: QuestionType;
  layer: Layer;
  correct: boolean;
  responseMs: number;
  selectedAnswer?: string | boolean | string[] | BuildFormulaAnswer | null;
  expectedAnswer?: string | boolean | string[] | BuildFormulaAnswer | null;
  mutationType?: string;
}

export interface WeakFormula {
  formulaId: string;
  weakLayer: Layer;
  errorDescription: string;
  confusedWith?: string[];
}

export interface RoundResult {
  score: number;
  total: number;
  livesRemaining: number;
  completed: boolean;
  durationSeconds: number;
  durationMs: number;
  answers: AnswerRecord[];
  weakFormulas: WeakFormula[];
  /** Longest streak of consecutive correct answers within this round. */
  maxCombo: number;
}
