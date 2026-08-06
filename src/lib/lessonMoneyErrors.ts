/**
 * Маппинг RAISE-кодов money-RPC занятий → русские фразы (rule 97).
 * Отдельный модуль БЕЗ зависимостей (контроль-ревью Волны 2, P2): импорт из
 * tutorBalanceApi создавал транзитивный цикл tutorSchedule → tutorBalanceApi →
 * tutors → tutorSchedule. Используют и RPC-обёртки (tutorBalanceApi), и
 * updateLessonSeries (tutorSchedule) — триггер MOVE_VIA_RPC прилетает в обе.
 */
export function mapLessonCostError(rawMsg: string): { code?: string; error: string } {
  const msg = rawMsg || '';
  if (msg.includes('INVALID_AMOUNT')) return { code: 'INVALID_AMOUNT', error: 'Стоимость должна быть 0 или больше.' };
  if (msg.includes('INVALID_SCOPE')) return { code: 'INVALID_SCOPE', error: 'Не удалось применить к серии — обновите страницу.' };
  if (msg.includes('INVALID_TIME')) return { code: 'INVALID_TIME', error: 'Некорректное время переноса.' };
  if (msg.includes('INVALID_STUDENT')) return { code: 'INVALID_STUDENT', error: 'Ученик не найден.' };
  if (msg.includes('NOT_BOOKED')) return { code: 'NOT_BOOKED', error: 'Можно переносить только запланированные занятия.' };
  if (msg.includes('MOVE_VIA_RPC')) return { code: 'MOVE_VIA_RPC', error: 'Так перенести нельзя: прошедшие занятия переносятся по одному (если ошибка повторяется — обновите страницу).' };
  if (msg.includes('GROUP_LESSON')) return { code: 'GROUP_LESSON', error: 'Это групповое занятие — меняйте стоимость по участнику.' };
  if (msg.includes('PARTICIPANT_NOT_FOUND')) return { code: 'PARTICIPANT_NOT_FOUND', error: 'Участник не найден в занятии.' };
  if (msg.includes('NOT_OWNED')) return { code: 'NOT_OWNED', error: 'Занятие не найдено.' };
  if (msg.includes('NO_STUDENT')) return { code: 'NO_STUDENT', error: 'У занятия нет ученика.' };
  if (msg.includes('STUDENT_TUTOR_MISMATCH')) return { code: 'STUDENT_TUTOR_MISMATCH', error: 'Ученик принадлежит другому репетитору.' };
  if (msg.includes('LEDGER_CONFLICT') || msg.includes('LEDGER_DEBIT_RACE') || msg.includes('LEDGER_DEBIT_LOST')) {
    return { code: 'LEDGER_CONFLICT', error: 'Не удалось применить — обновите страницу и попробуйте ещё раз.' };
  }
  return { error: 'Не удалось изменить стоимость. Попробуйте ещё раз.' };
}
