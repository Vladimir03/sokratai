export interface Variable {
  symbol: string;
  name: string;
  unit: string;
}

export interface Proportionality {
  direct: string[];
  inverse: string[];
}

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
}
