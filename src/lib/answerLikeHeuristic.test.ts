// Тесты эвристики «похоже на голый финальный ответ» (answerLikeHeuristic.ts).
// Зачем: nudge-баннер в discussion-поле guided ДЗ (пилотный кейс Ульяны —
// ученики печатают «0,1» в обсуждение, и задача не закрывается). Контракт
// КОНСЕРВАТИВНЫЙ: ложное срабатывание на просьбе о помощи хуже пропуска
// (review P1-2 — «у меня не получается» блокировалось баннером).
import { describe, expect, it } from 'vitest';
import { looksLikeBareAnswer } from './answerLikeHeuristic';

describe('looksLikeBareAnswer', () => {
  it('голое число → true («42», «0,1», «2,5», «-5», «≈3»)', () => {
    expect(looksLikeBareAnswer('42')).toBe(true);
    expect(looksLikeBareAnswer('0,1')).toBe(true);
    expect(looksLikeBareAnswer('2,5')).toBe(true);
    expect(looksLikeBareAnswer('-5')).toBe(true);
    expect(looksLikeBareAnswer('≈3')).toBe(true);
  });

  it('число с единицами и короткое «= …» → true', () => {
    expect(looksLikeBareAnswer('2 м/с')).toBe(true);
    expect(looksLikeBareAnswer('= 12.5')).toBe(true);
  });

  it('ответ со связкой-префиксом → true («ответ: 42», «да я пишу 0,1»)', () => {
    // Пилотный кейс Ульяны дословно: extractAnswerCandidate срезает связки.
    expect(looksLikeBareAnswer('ответ: 42')).toBe(true);
    expect(looksLikeBareAnswer('да я пишу 0,1')).toBe(true);
    expect(looksLikeBareAnswer('получилось 7')).toBe(true);
  });

  it('формула, начинающаяся с буквы, → false (кандидат не имеет формы числа)', () => {
    // Shape-гейт требует цифру/знак В НАЧАЛЕ кандидата: «v = 2 м/с» начинается
    // с «v» — консервативно НЕ ответ (дострахует AI-маркер [[SUBMIT_CTA]]).
    expect(looksLikeBareAnswer('v = 2 м/с')).toBe(false);
    expect(looksLikeBareAnswer('x = 5')).toBe(false);
  });

  it('нормальное развёрнутое рассуждение → false (длина > 30)', () => {
    expect(
      looksLikeBareAnswer('сначала найдём ускорение через второй закон Ньютона'),
    ).toBe(false);
  });

  it('просьбы о помощи из review P1-2 → false', () => {
    // Ранняя версия («есть цифра ИЛИ префикс») ловила оба — регресс-фиксация.
    expect(looksLikeBareAnswer('у меня не получается')).toBe(false);
    expect(looksLikeBareAnswer('не понимаю шаг 2')).toBe(false);
  });

  it('вопрос («?») — легитимное обсуждение → false, даже если похож на ответ', () => {
    expect(looksLikeBareAnswer('0,1?')).toBe(false);
    expect(looksLikeBareAnswer('правильно будет 42?')).toBe(false);
  });

  it('пустая строка и пробелы → false', () => {
    expect(looksLikeBareAnswer('')).toBe(false);
    expect(looksLikeBareAnswer('   ')).toBe(false);
  });

  it('граница длины: 30 символов → true, 31 → false', () => {
    expect(looksLikeBareAnswer('1'.repeat(30))).toBe(true);
    expect(looksLikeBareAnswer('1'.repeat(31))).toBe(false);
  });

  it('граница слов: 4 «слова» → true, 5 → false', () => {
    expect(looksLikeBareAnswer('1 2 3 4')).toBe(true);
    expect(looksLikeBareAnswer('1 2 3 4 5')).toBe(false);
  });
});
