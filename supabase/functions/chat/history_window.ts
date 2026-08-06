/**
 * Серверный потолок окна истории чата (2026-08-07). **Страховка, а не экономия.**
 *
 * ЗАЧЕМ. Окно уже режут ВСЕ три вызывающих: `src/pages/Chat.tsx` (`slice(-15)`),
 * `GuidedHomeworkWorkspace` (`MAX_CONTEXT_MESSAGES = 15`) и `telegram-bot`
 * (20 из БД → `compactHistoryForTelegram`). Но edge принимал `body.messages`
 * на веру — это было единственное неподтверждаемое поле в пути, где всё
 * остальное сервер перепроверяет по БД (subject / exam_type / cefr / rubric,
 * anti-tamper, rule 40). Зациклившаяся вкладка или новый вызывающий без капа
 * могли бы выжечь месячный лимит AI-кредитов за минуты, а узнали бы мы об этом
 * постфактум из дайджеста.
 *
 * Пороги заведомо выше живого трафика (замер за 30 дней по `token_usage_logs`:
 * p50 = 5 298 токенов промпта, p99 = 12 934, максимум 14 645 — это ~15 сообщений
 * плюс системный промпт), поэтому на нормальной работе гард НЕ срабатывает и
 * качество ответа не меняется. Срабатывание = баг вызывающего, поэтому оно
 * логируется отдельным warn.
 *
 * ⚠️ **Не путать с экономией.** Обрезка «дорогого хвоста» чата дала бы
 * $0,03/мес: весь хвост >8k токенов за 30 дней стоит $0,26. Ужимать окно ради
 * денег НЕ нужно — деньги лежат в загрузчике задач (78% счёта AI), а не здесь.
 * Вынесено в отдельный модуль, потому что `index.ts` не импортируется в vitest
 * (top-level `Deno.serve`) — конвенция репо.
 */

/** Потолок числа сообщений: вдвое выше клиентских 15 — в норме не срабатывает. */
export const MAX_HISTORY_MESSAGES = 30;

/** Потолок суммарного ТЕКСТА истории, символов (≈20k токенов). */
export const MAX_HISTORY_CHARS = 60_000;

/** Длина текста сообщения: строка или multimodal-массив частей. */
export function messageTextLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let sum = 0;
  for (const part of content) {
    if (part && typeof part === "object") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") sum += text.length;
    }
  }
  return sum;
}

/**
 * Обрезать историю до потолка.
 *
 * Инварианты:
 *  - **последнее сообщение не выбрасывается НИКОГДА** — это текущий вопрос
 *    ученика; выбросив его, мы попросили бы модель ответить на пустоту.
 *    Поэтому одно сверхдлинное сообщение проходит как есть: его длину режет
 *    отдельный `MAX_MESSAGE_LENGTH` на входе, а не этот гард;
 *  - режем с самых СТАРЫХ: свежий контекст ценнее давнего;
 *  - картинки считаются нулевой длиной — они резолвятся сервером ПОСЛЕ обрезки,
 *    и их бюджет держит отдельный `MAX_IMAGE_BYTES`.
 */
export function capHistoryWindow(
  messages: unknown[],
): { messages: unknown[]; dropped: number } {
  if (messages.length <= 1) return { messages, dropped: 0 };

  let out = messages.length > MAX_HISTORY_MESSAGES
    ? messages.slice(-MAX_HISTORY_MESSAGES)
    : messages;

  let total = 0;
  for (const msg of out) {
    total += messageTextLength((msg as { content?: unknown } | null)?.content);
  }
  let start = 0;
  while (total > MAX_HISTORY_CHARS && start < out.length - 1) {
    total -= messageTextLength((out[start] as { content?: unknown } | null)?.content);
    start += 1;
  }
  if (start > 0) out = out.slice(start);

  return { messages: out, dropped: messages.length - out.length };
}
