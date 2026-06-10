/**
 * Эвристика «похоже на голый финальный ответ» для discussion-поля guided
 * homework (2026-06-10, graceful-stirring-treasure).
 *
 * Пилотный кейс (Ульяна): ученики печатают финальный ответ («0,1»,
 * «Да я пишу 0,1») в scoring-neutral поле обсуждения — AI ведёт сократический
 * диалог, задача не закрывается. На numeric-задачах перед отправкой такого
 * сообщения в `/chat` показывается nudge-баннер «Похоже, это готовый ответ»
 * с one-tap маршрутизацией в нормальный `checkAnswer` грейдинг.
 *
 * Контракт: КОНСЕРВАТИВНО — лучше недо-сработать (сообщение уйдёт в чат, AI
 * допокроет через [[SUBMIT_CTA]]-маркер), чем дёргать баннер на каждое
 * сообщение. Никакого скоринга здесь нет — чистая текстовая эвристика.
 */

/** Префиксы-связки, которые ученики пишут перед самим ответом. */
const ANSWER_PREFIX_RE =
  /^(ответ\s*[:=\-—]?|получилось\s*[:=\-—]?|получается\s*[:=\-—]?|у меня\s+|вышло\s*[:=\-—]?|итог\s*[:=\-—]?|=\s*)/i;

/** Маркер AI-детекции финального ответа в guided /chat (см. chat/index.ts). */
export const SUBMIT_CTA_MARKER = '[[SUBMIT_CTA]]';

/**
 * Убирает маркер [[SUBMIT_CTA]] из текста AI-ответа — в UI и в БД токен
 * попадать не должен (репетитор в GuidedThreadViewer его не видит).
 */
export function stripSubmitMarker(text: string): string {
  if (!text.includes(SUBMIT_CTA_MARKER)) return text;
  return text.split(SUBMIT_CTA_MARKER).join('').replace(/\s+$/, '');
}

/**
 * Стриминговый вариант stripSubmitMarker (review P0-2): guided-задачи БЕЗ
 * эталона репетитора идут через pass-through SSE (`chat/index.ts`
 * guardedAgainstSolutionLeak=false), и маркер может прийти разрезанным по
 * дельтам — «[[SUBMIT» вспыхнул бы в UI на кадр-два. Помимо удаления полных
 * маркеров придерживаем хвост текста, если он является префиксом маркера
 * (допечатается следующей дельтой). Только для display-стейта; финальный
 * текст чистится обычным stripSubmitMarker по полному контенту.
 */
export function stripSubmitMarkerStreaming(text: string): string {
  const stripped = text.includes(SUBMIT_CTA_MARKER)
    ? text.split(SUBMIT_CTA_MARKER).join('')
    : text;
  const maxHold = Math.min(SUBMIT_CTA_MARKER.length - 1, stripped.length);
  for (let len = maxHold; len > 0; len--) {
    if (stripped.endsWith(SUBMIT_CTA_MARKER.slice(0, len))) {
      return stripped.slice(0, stripped.length - len);
    }
  }
  return stripped;
}

/**
 * `true`, если сообщение в обсуждении выглядит как голый финальный ответ,
 * а не вопрос/шаг рассуждения. Условия (все консервативные):
 *  - нет «?» (вопрос — легитимное обсуждение);
 *  - коротко: ≤ 30 символов и ≤ 4 «слов»;
 *  - ПОСЛЕ среза связок кандидат имеет ФОРМУ числового ответа — начинается
 *    с цифры/знака («0,1», «-5», «= 12.5», «≈3»).
 *
 * Review P1-2 fix: ранний вариант («есть цифра ИЛИ префикс») ловил «у меня
 * не получается» (префикс) и «не понимаю шаг 2» (цифра) — блокировал баннером
 * нормальные просьбы о помощи. Shape-гейт на кандидате это закрывает;
 * пропущенные развёрнутые ответы дострахует AI-маркер [[SUBMIT_CTA]].
 */
export function looksLikeBareAnswer(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.includes('?')) return false;
  if (trimmed.length > 30) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 4) return false;
  return /^[-+=≈]?\s*\d/.test(extractAnswerCandidate(trimmed));
}

/**
 * Срезает ответный префикс («ответ:», «получилось», «=», «да я пишу» …) и
 * возвращает чистое значение для отправки в `checkAnswer`. Если после среза
 * пусто — возвращает исходный trimmed текст (fail-safe).
 */
export function extractAnswerCandidate(raw: string): string {
  let value = raw.trim();
  // Срезаем связки итеративно: «да я пишу 0,1» → «0,1»; «ответ: = 5» → «5».
  // Ограничение в 4 итерации — защита от зацикливания на патологическом вводе.
  for (let i = 0; i < 4; i++) {
    const next = value
      .replace(/^(да|ну|вот|я)\s+/i, '')
      .replace(/^(пишу|написал[а]?|думаю|считаю)\s+/i, '')
      .replace(ANSWER_PREFIX_RE, '')
      .trim();
    if (next === value) break;
    value = next;
  }
  return value.length > 0 ? value : raw.trim();
}
