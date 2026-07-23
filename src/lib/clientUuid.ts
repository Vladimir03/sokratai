/**
 * UUID v4, генерируемый на клиенте.
 *
 * `crypto.randomUUID()` доступен только с Safari 15.4 и только по HTTPS, а наш
 * baseline — Safari 15 / iOS 15 (rule 80), поэтому нужен fallback. Реализация
 * жила в `tutorStudentChatApi.ts` (`generateClientMsgId`); вынесена сюда, чтобы
 * второй потребитель (идемпотентность сохранения шаблона ДЗ) не копировал её —
 * копия примитива = тот же класс дрейфа, что мы чиним в шаблонах.
 *
 * Fallback НЕ криптостойкий (Math.random) — годится для идемпотентных ключей и
 * client-side id, но НЕ для секретов/токенов.
 */
export function generateClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  let uuid = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) uuid += '-';
    else if (i === 14) uuid += '4';
    else if (i === 19) uuid += hex[(Math.random() * 4 + 8) | 0];
    else uuid += hex[(Math.random() * 16) | 0];
  }
  return uuid;
}
