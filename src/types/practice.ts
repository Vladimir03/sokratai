// Типы для тренажёра ЕГЭ по математике

export type EGENumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19;

export type AnswerType = 'integer' | 'decimal' | 'fraction' | 'multiple_choice' | 'text' | 'sequence';

export interface EgeProblem {
  id: string;
  ege_number: EGENumber;
  year: number;
  variant_source?: string;
  source_id?: string;
  condition_text: string;
  condition_image_url?: string;
  answer_type: AnswerType;
  correct_answer: string;
  answer_tolerance: number;
  solution_text?: string;
  solution_video_url?: string;
  hints: string[];
  topic: string;
  subtopic?: string;
  difficulty: 1 | 2 | 3;
  tags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CheckAnswerResult {
  is_correct: boolean;
  correct_answer: string;
  solution_text?: string;
  hints: string[];
}

export interface UserEgeProgress {
  ege_number: EGENumber;
  total_attempts: number;
  correct_attempts: number;
  accuracy: number;
  current_difficulty: 1 | 2 | 3;
  last_practiced_at: string;
  problem_statuses: Record<string, 'correct' | 'incorrect'>;
}

export interface PracticeSession {
  id: string;
  user_id: string;
  date: string;
  problems_solved: number;
  correct_answers: number;
  xp_earned: number;
}

export interface TodayStats {
  current_streak: number;
  problems_solved_today: number;
  correct_today: number;
  daily_goal_problems: number;
  xp_today: number;
}

// Метаданные для номеров ЕГЭ
export const EGE_NUMBERS: Record<EGENumber, { name: string; topic: string; maxPoints: number; part: 1 | 2 }> = {
  1: { name: 'Планиметрия', topic: 'geometry', maxPoints: 1, part: 1 },
  2: { name: 'Векторы', topic: 'vectors', maxPoints: 1, part: 1 },
  3: { name: 'Стереометрия', topic: 'stereometry', maxPoints: 1, part: 1 },
  4: { name: 'Теория вероятностей', topic: 'probability', maxPoints: 1, part: 1 },
  5: { name: 'Теория вероятностей (сложная)', topic: 'probability', maxPoints: 1, part: 1 },
  6: { name: 'Уравнения', topic: 'equations', maxPoints: 1, part: 1 },
  7: { name: 'Производная', topic: 'calculus', maxPoints: 1, part: 1 },
  8: { name: 'Первообразная', topic: 'calculus', maxPoints: 1, part: 1 },
  9: { name: 'Текстовые задачи', topic: 'word_problems', maxPoints: 1, part: 1 },
  10: { name: 'Функции', topic: 'functions', maxPoints: 1, part: 1 },
  11: { name: 'Прикладные задачи', topic: 'applied', maxPoints: 1, part: 1 },
  12: { name: 'Наиб./наим. значение', topic: 'optimization', maxPoints: 1, part: 1 },
  13: { name: 'Стереометрия (часть 2)', topic: 'stereometry', maxPoints: 3, part: 2 },
  14: { name: 'Неравенства', topic: 'inequalities', maxPoints: 2, part: 2 },
  15: { name: 'Финансовая математика', topic: 'finance', maxPoints: 2, part: 2 },
  16: { name: 'Планиметрия (часть 2)', topic: 'geometry', maxPoints: 3, part: 2 },
  17: { name: 'Задачи с параметром', topic: 'parameters', maxPoints: 4, part: 2 },
  18: { name: 'Числа и их свойства', topic: 'number_theory', maxPoints: 4, part: 2 },
  19: { name: 'Нестандартные задачи', topic: 'creative', maxPoints: 2, part: 2 },
};

// Сложность
export const DIFFICULTY_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Лёгкий',
  2: 'Средний',
  3: 'Сложный',
};

