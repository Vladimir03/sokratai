import { describe, expect, it } from 'vitest';
import {
  hintOveruseThreshold,
  REMIND_MESSAGE_MAX_CHARS,
  REMIND_MESSAGE_MIN_CHARS,
  remindPresetMessage,
} from './homeworkResultsConstants';

/**
 * Тесты на константы Homework Results v2.
 *
 * Зачем: `hintOveruseThreshold` — порог чипа «злоупотребляет подсказками», его
 * тихий сдвиг меняет, кого репетитор увидит «красным», без единой ошибки в
 * логах. `remindPresetMessage` — дефолт диалога «Напомнить»; его лимиты ОБЯЗАНЫ
 * совпадать с backend-валидацией handleRemindStudent (комментарий в исходнике),
 * поэтому границы фиксируем числами, а не «какие-то есть».
 */

describe('hintOveruseThreshold — 60% задач, вверх, пол 1', () => {
  it('пример из доки: 5 задач → 3 подсказки триггерят чип', () => {
    expect(hintOveruseThreshold(5)).toBe(3);
  });

  it('округление ВВЕРХ: 2 задачи → ceil(1.2) = 2, 10 задач → 6', () => {
    expect(hintOveruseThreshold(2)).toBe(2);
    expect(hintOveruseThreshold(10)).toBe(6);
  });

  it('пол 1: даже у пустого/крошечного ДЗ порог не ноль (иначе чип у всех сразу)', () => {
    expect(hintOveruseThreshold(0)).toBe(1);
    expect(hintOveruseThreshold(1)).toBe(1);
  });
});

describe('remindPresetMessage — тёплый пресет без давления', () => {
  it('подставляет название ДЗ в «ёлочки», текст ровно как в коде', () => {
    expect(remindPresetMessage('Кинематика №3')).toBe(
      'Привет! Напоминаю про ДЗ «Кинематика №3». Если что-то непонятно — напиши, разберём вместе.',
    );
  });

  it('пустой заголовок не выбрасывает — получаются пустые «» (фиксируем как есть)', () => {
    expect(remindPresetMessage('')).toContain('ДЗ «»');
  });

  it('дефолтный пресет с реальным названием влезает в backend-границы 1..2000', () => {
    expect(REMIND_MESSAGE_MIN_CHARS).toBe(1);
    expect(REMIND_MESSAGE_MAX_CHARS).toBe(2000);
    const msg = remindPresetMessage('Очень длинное название домашнего задания по физике');
    expect(msg.length).toBeGreaterThanOrEqual(REMIND_MESSAGE_MIN_CHARS);
    expect(msg.length).toBeLessThanOrEqual(REMIND_MESSAGE_MAX_CHARS);
  });
});
