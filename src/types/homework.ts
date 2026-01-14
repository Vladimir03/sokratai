export type Priority = 'urgent' | 'important' | 'later';
export type TaskStatus = 'not_started' | 'in_progress' | 'completed';

export interface HomeworkSet {
  id: string;
  user_id: string;
  subject: string;
  topic: string;
  photo_url?: string;
  deadline?: string;
  priority: Priority;
  created_at: string;
  updated_at: string;
  tasks?: HomeworkTask[];
}

export interface HomeworkTask {
  id: string;
  homework_set_id: string;
  task_number: string;
  condition_text?: string;
  condition_photo_url?: string;
  ai_analysis?: {
    difficulty: string;
    type: string;
    hints: string[];
    solution_steps: string[];
  };
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface HomeworkChatMessage {
  id: string;
  homework_task_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// Предметы сгруппированы по типу: технические (приоритет), гуманитарные, естественные
export const SUBJECTS = [
  // 🔬 Технические (приоритет)
  { id: 'algebra', name: 'Алгебра', emoji: '📈', category: 'technical' },
  { id: 'geometry', name: 'Геометрия', emoji: '📐', category: 'technical' },
  { id: 'physics', name: 'Физика', emoji: '⚛️', category: 'technical' },
  { id: 'informatics', name: 'Информатика', emoji: '💻', category: 'technical' },

  // 📚 Гуманитарные
  { id: 'russian', name: 'Русский язык', emoji: '📖', category: 'humanities' },
  { id: 'literature', name: 'Литература', emoji: '📗', category: 'humanities' },
  { id: 'history', name: 'История', emoji: '📜', category: 'humanities' },
  { id: 'social', name: 'Обществознание', emoji: '⚖️', category: 'humanities' },
  { id: 'english', name: 'Английский язык', emoji: '🇬🇧', category: 'humanities' },

  // 🧬 Естественные
  { id: 'chemistry', name: 'Химия', emoji: '🧪', category: 'natural' },
  { id: 'biology', name: 'Биология', emoji: '🧬', category: 'natural' },
  { id: 'geography', name: 'География', emoji: '🌍', category: 'natural' },

  // Другое
  { id: 'other', name: 'Другое', emoji: '📝', category: 'other' }
];

export const PRIORITY_CONFIG = {
  urgent: { label: 'Срочно', color: 'red', emoji: '🔴' },
  important: { label: 'Важно', color: 'yellow', emoji: '🟡' },
  later: { label: 'Позже', color: 'green', emoji: '🟢' }
};
