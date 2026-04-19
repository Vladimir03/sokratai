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
  /**
   * Короткий якорь для блока «Запомни:» в FeedbackOverlay. Одно-два
   * предложения, формулируются репетитором (колонка «Запомни» в гугл-таблице
   * или поле `memoryHook` в `egorFormulas.ts`). Если не задано — fallback на
   * regex-эвристику в `getLayer1MemoryCue`.
   */
  memoryHook?: string;
  /**
   * Может ли формула участвовать в BuildFormulaCard (Layer 2 — «собери
   * правую часть»). Источник — колонка «Для сборки/не для сборки» в
   * гугл-таблице (v1 tab). Теоретические утверждения и громоздкие формулы
   * помечаются `buildable: false` → идут только в TrueOrFalseCard без
   * мутации (утверждение целиком верно/неверно).
   *
   * Default (undefined) трактуется как `true` — backward-compat для v2
   * каталога, где колонки ещё нет.
   */
  buildable?: boolean;
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
  /**
   * Легенда к токенам пула BuildFormulaCard — используется при case-
   * ambiguity (в пуле и `T`, и `t`, или `N`/`n` и т.д.), чтобы ученик
   * не путал одинаковые буквы разного регистра. Каждая запись — токен
   * + короткое пояснение «имя (единица)». Показывается только когда
   * реально есть коллизия.
   */
  tokenLegend?: Array<{ token: string; label: string }>;
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
