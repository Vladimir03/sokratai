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

export const SUBJECTS = [
  { id: 'geometry', name: 'Геометрия', emoji: '📐' },
  { id: 'algebra', name: 'Алгебра', emoji: '📈' },
  { id: 'physics', name: 'Физика', emoji: '⚛️' },
  { id: 'chemistry', name: 'Химия', emoji: '🧪' },
  { id: 'informatics', name: 'Информатика', emoji: '💻' },
  { id: 'other', name: 'Другое', emoji: '📝' }
];

export const PRIORITY_CONFIG = {
  urgent: { label: 'Срочно', color: 'red', emoji: '🔴' },
  important: { label: 'Важно', color: 'yellow', emoji: '🟡' },
  later: { label: 'Позже', color: 'green', emoji: '🟢' }
};
