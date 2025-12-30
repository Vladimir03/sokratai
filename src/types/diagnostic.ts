// Типы для модуля диагностики

import type { EGENumber, EgeProblem } from './practice';

export type DiagnosticStatus = 'in_progress' | 'completed' | 'abandoned';
export type TopicRecommendation = 'strong' | 'average' | 'weak';

// Результат по одной теме
export interface TopicScore {
  ege_number: EGENumber;
  topic_name: string;
  correct: number;
  total: number;
  score: number; // 0-100%
  recommendation: TopicRecommendation;
}

// Сессия диагностики
export interface DiagnosticSession {
  id: string;
  user_id: string;
  status: DiagnosticStatus;
  
  // Результаты (null пока не завершена)
  predicted_primary_score: number | null;
  predicted_test_score: number | null;
  topic_scores: Record<number, TopicScore>;
  weak_topics: number[];
  strong_topics: number[];
  recommended_start_topic: number | null;
  
  // Прогресс
  current_question: number;
  total_questions: number;
  
  // Время
  started_at: string;
  completed_at: string | null;
  time_spent_seconds: number | null;
}

// Ответ на вопрос диагностики
export interface DiagnosticAnswer {
  id: string;
  session_id: string;
  problem_id: string;
  ege_number: number;
  user_answer: string;
  is_correct: boolean;
  time_spent_seconds: number | null;
  question_order: number;
}

// Вопрос диагностики для UI
export interface DiagnosticQuestion {
  problem: EgeProblem;
  questionNumber: number;
  totalQuestions: number;
}

// Финальный результат диагностики
export interface DiagnosticResult {
  primaryScore: number;        // 0-12 первичных баллов
  testScore: number;           // 0-100 тестовых баллов
  topicScores: TopicScore[];   // Результаты по темам
  weakTopics: TopicScore[];    // Слабые темы
  strongTopics: TopicScore[];  // Сильные темы
  recommendedTopic: TopicScore | null; // С чего начать
  totalQuestions: number;
  correctAnswers: number;
  timeSpentMinutes: number;
}

// Состояние хука диагностики
export interface DiagnosticState {
  session: DiagnosticSession | null;
  currentProblem: EgeProblem | null;
  problems: EgeProblem[];
  answers: DiagnosticAnswer[];
  isLoading: boolean;
  error: string | null;
  result: DiagnosticResult | null;
}

// Первичные баллы за каждое задание первой части ЕГЭ
export const PRIMARY_SCORES: Record<number, number> = {
  1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1,
  7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1
};

// Максимум первичных баллов за первую часть
export const MAX_PRIMARY_SCORE_PART1 = 12;

// Примерная шкала перевода первичных в тестовые (упрощённая)
// Реальная шкала меняется каждый год
export function primaryToTestScore(primary: number): number {
  // Линейная интерполяция: 0 первичных = 0, 12 первичных ≈ 62 тестовых
  // (первая часть даёт максимум ~62 балла из 100)
  const maxTestFromPart1 = 62;
  const ratio = primary / MAX_PRIMARY_SCORE_PART1;
  return Math.round(ratio * maxTestFromPart1);
}

// Константы
export const DIAGNOSTIC_TOTAL_QUESTIONS = 12;
export const DIAGNOSTIC_COOLDOWN_DAYS = 0;

