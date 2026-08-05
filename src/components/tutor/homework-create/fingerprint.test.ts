import { describe, expect, it } from 'vitest';
import { computeTaskContentFingerprint } from './types';

/**
 * Тесты на client-side divergence-детект «Обновить в Базе».
 *
 * Зачем: fingerprint сравнивается снимок-при-импорте vs живой драфт, и кнопка
 * «Обновить в Базе» показывается ТОЛЬКО при расхождении. Ошибка не падает:
 * false-diff — репетитора зря дёргают кнопкой, false-same — реальная правка
 * молча не доезжает до задачи-источника Базы. Ревью-фикс P1 (2026-07-06)
 * специально включил каскад-поля (exam/difficulty/topic_id/subtopic_id/
 * source_label) в отпечаток — «правка только классификации» обязана быть
 * видимой. Закрепляем и нормализацию пустых к null: edit-prefill каскад не
 * грузит, и без неё каждый edit показывал бы фантомное «изменено».
 */

const base = {
  task_text: 'Найдите силу тока',
  correct_answer: '2',
  check_format: 'short_answer',
  max_score: 1,
};

describe('computeTaskContentFingerprint — divergence-детект', () => {
  it('одинаковый контент → одинаковый отпечаток; порядок ключей входа не важен (проекция позиционная)', () => {
    const a = computeTaskContentFingerprint({ ...base, topic_id: 't-1' });
    const b = computeTaskContentFingerprint({
      topic_id: 't-1',
      max_score: 1,
      check_format: 'short_answer',
      correct_answer: '2',
      task_text: 'Найдите силу тока',
    });
    expect(a).toBe(b);
  });

  it('правка каскад-поля МЕНЯЕТ отпечаток: topic_id, exam, difficulty видны детекту (ревью-фикс P1 2026-07-06)', () => {
    const before = computeTaskContentFingerprint({ ...base, topic_id: 't-1', exam: 'ege', difficulty: 3 });
    expect(computeTaskContentFingerprint({ ...base, topic_id: 't-2', exam: 'ege', difficulty: 3 })).not.toBe(before);
    expect(computeTaskContentFingerprint({ ...base, topic_id: 't-1', exam: 'oge', difficulty: 3 })).not.toBe(before);
    expect(computeTaskContentFingerprint({ ...base, topic_id: 't-1', exam: 'ege', difficulty: 4 })).not.toBe(before);
  });

  it('пустые каскад-значения нормализуются к null: отсутствие ключа, "" и null дают ОДИН отпечаток (нет false-diff на edit-prefill)', () => {
    const absent = computeTaskContentFingerprint(base);
    expect(computeTaskContentFingerprint({ ...base, exam: '', topic_id: '', source_label: '   ' })).toBe(absent);
    expect(computeTaskContentFingerprint({ ...base, exam: null, topic_id: null, source_label: null })).toBe(absent);
  });

  it('текстовые поля триммятся: пробелы по краям — не «изменение»', () => {
    expect(computeTaskContentFingerprint({ ...base, task_text: '  Найдите силу тока  ' })).toBe(
      computeTaskContentFingerprint(base),
    );
  });

  it('options_json участвует в отпечатке; порядок ключей ВНУТРИ него значим (сырой JSON.stringify — фиксируем как есть)', () => {
    const opts = { kind: 'single_choice', options: [{ key: '1', text: 'а' }, { key: '2', text: 'б' }] };
    const withOpts = computeTaskContentFingerprint({ ...base, options_json: opts });
    expect(withOpts).not.toBe(computeTaskContentFingerprint(base));
    // Перестановка ключей во вложенном объекте меняет строку JSON.stringify —
    // возможен false-diff, если снимок и драфт строят объект разными путями.
    // На практике обе стороны идут через одни конвертеры; поведение закрепляем.
    const reordered = { options: [{ text: 'а', key: '1' }, { key: '2', text: 'б' }], kind: 'single_choice' };
    expect(computeTaskContentFingerprint({ ...base, options_json: reordered })).not.toBe(withOpts);
  });
});
