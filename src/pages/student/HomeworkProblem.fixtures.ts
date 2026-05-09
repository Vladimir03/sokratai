/**
 * Mock fixtures for the new student homework-problem screen (Phase 1).
 *
 * Шкаф для дизайн-сверки и визуального QA. Никаких реальных backend-вызовов.
 * Когда backend (Phase 2) будет готов — этот файл удаляется и replaced
 * на React Query запросы:
 *   - GET /homework/:hwId/tasks/:taskId
 *   - GET /homework/:hwId/tasks/:taskId/draft
 *   - GET /homework/:hwId/tasks/:taskId/chat
 *
 * Дизайн-источник — `docs/design_handoff_homework_chat/` README.
 *
 * При расширении: держи этот файл рядом с `HomeworkProblem.tsx` (НЕ в
 * `src/__fixtures__/`), чтобы было очевидно "throwaway dev-only data".
 * При тесте verdict-overlay'ов (correct / no-work / step-error / unclear) —
 * меняй `mockSubmitState` ниже.
 */

export type TaskKind = 'numeric' | 'extended' | 'proof';

export interface ProblemTaskFixture {
  /** uuid задачи (мок-формат для URL paramматчинга) */
  task_id: string;
  /** uuid домашки родителя */
  homework_id: string;
  /** Заголовок ДЗ */
  homework_title: string;
  /** Предмет — для top-bar eyebrow */
  subject: string;
  /** Положение задачи в ДЗ (1-based) */
  task_no: number;
  /** Всего задач в ДЗ */
  task_total: number;
  /** Текущий заработанный балл (0..max). Уже посчитан backend (override > earned > ai). */
  task_score: number;
  /** Максимальный балл за задачу */
  task_score_max: number;
  /** Тип задачи — определяет required-поля в SubmitSheet */
  task_kind: TaskKind;
  /** Тело условия (plain text — может содержать KaTeX `$...$` инлайнами) */
  body: string;
  /** Главный вопрос задачи (отдельный <p> в expanded ProblemContext) */
  question: string;
  /** Дано — список величин для warm-up "Дано/Найти" блока */
  given: { sym: string; val: string; unit: string }[];
  /** Что нужно найти — LaTeX. Финальный «- ?» добавляется на UI. */
  find: string;
  /** Единица измерения для числового ответа в SubmitSheet */
  answer_unit: string;
  /** Прогресс задач для step-indicator. 1-based индексы тех, что done. */
  done_task_indices: number[];
  /** Сколько подсказок раскрыто (0..max_hints) */
  hints_revealed: number;
  /** Максимум подсказок (обычно 3). Каждая раскрытая — -1 балл. */
  max_hints: number;
}

export interface ProblemChatMessageFixture {
  id: string;
  /** Кто сказал. `system` рендерится как divider по центру. */
  who: 'system' | 'ai' | 'user' | 'typing';
  /** Текст сообщения (plain или с inline-LaTeX) */
  text?: string;
  /** Для AI — kicker над bubble (по умолчанию «СОКРАТ»). */
  kicker?: string;
  /** Опциональный quote-attachment в AI bubble (зелёный левый бордер). */
  attachment?: { kind: 'quote'; text: string };
  /** ISO timestamp. Mock-данные — все близки по времени. */
  created_at?: string;
}

// ─── Канонический пример: ЕГЭ-физика, колебания и волны ──────────────────────

export const mockTask: ProblemTaskFixture = {
  task_id: 'mock-task-3',
  homework_id: 'mock-hw-energy',
  homework_title: 'Изменение энергии и начало колебаний',
  subject: 'Физика',
  task_no: 3,
  task_total: 9,
  task_score: 2,
  task_score_max: 2,
  task_kind: 'extended',
  body: 'Маленький шарик массы 0,2 кг, подвешенный на пружине жёсткостью 50 Н/м, отклоняют от положения равновесия на 4 см и отпускают без начальной скорости.',
  question: 'Найдите максимальную скорость шарика во время колебаний.',
  given: [
    { sym: 'm', val: '0{,}2', unit: 'кг' },
    { sym: 'k', val: '50', unit: 'Н/м' },
    { sym: 'x', val: '0{,}04', unit: 'м' },
  ],
  find: 'v_{max}',
  answer_unit: 'м/с',
  done_task_indices: [1, 2],
  hints_revealed: 1,
  max_hints: 3,
};

export const mockChatThread: ProblemChatMessageFixture[] = [
  {
    id: 'sys-intro',
    who: 'system',
    text: 'Сократ AI помогает наводящими вопросами — без готовых ответов',
  },
  {
    id: 'ai-1',
    who: 'ai',
    kicker: 'Сократ',
    text: 'Привет, Артём! Давай разберёмся вместе. Шарик отвели в сторону и отпустили — какая энергия у него в этот момент? Подумай: он движется или покоится?',
    created_at: '2026-04-26T10:00:30Z',
  },
  {
    id: 'u-1',
    who: 'user',
    text: 'Он покоится. Значит кинетической нет, есть только потенциальная',
    created_at: '2026-04-26T10:01:10Z',
  },
  {
    id: 'ai-2',
    who: 'ai',
    kicker: 'Сократ',
    text: 'Точно. Запомнил формулу потенциальной энергии для пружины — энергии деформации? Она зависит от двух величин.',
    created_at: '2026-04-26T10:01:35Z',
  },
  {
    id: 'u-2',
    who: 'user',
    text: 'От жёсткости и квадрата отклонения',
    created_at: '2026-04-26T10:02:05Z',
  },
  {
    id: 'ai-3',
    who: 'ai',
    kicker: 'Сократ',
    text: 'Идеально. А теперь представь шарик в момент, когда он проходит положение равновесия. Что у него с потенциальной энергией?',
    attachment: { kind: 'quote', text: 'положение равновесия → x = 0' },
    created_at: '2026-04-26T10:02:30Z',
  },
  {
    id: 'u-3',
    who: 'user',
    text: 'Она равна нулю',
    created_at: '2026-04-26T10:03:00Z',
  },
  {
    id: 'ai-4',
    who: 'ai',
    kicker: 'Сократ',
    text: 'Куда же тогда «делась» вся энергия? Закон сохранения энергии подскажет.',
    created_at: '2026-04-26T10:03:25Z',
  },
  {
    id: 'u-4',
    who: 'user',
    text: 'Перешла в кинетическую. И тогда скорость как раз максимальная!',
    created_at: '2026-04-26T10:04:00Z',
  },
  // Optional typing indicator — keep at the end of the thread to demo the
  // animation. Comment out for "no AI thinking" state.
  { id: 'typing', who: 'typing' },
];
