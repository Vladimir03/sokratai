// Тесты единого хелпера «полностью ли проверено ДЗ ученика» (homeworkReview.ts).
// Зачем: «проверено» = tutor_reviewed_at ИЛИ tutor_force_completed_at (решение
// владельца 2026-07-20, force-close = уже принятое решение репетитора). Регресс
// здесь = дезинформация на главной («Требует проверки» у проверенных работ) и
// вечно висящий бейдж у force-closed задач — репорт Елены 2026-06-18.
import { describe, expect, it } from 'vitest';
import { isStudentWorkFullyReviewed, isTaskScoreReviewed } from './homeworkReview';

describe('isTaskScoreReviewed', () => {
  it('оба поля null → НЕ проверено', () => {
    expect(
      isTaskScoreReviewed({ tutor_reviewed_at: null, tutor_force_completed_at: null }),
    ).toBe(false);
  });

  it('оба поля отсутствуют (deploy-skew: источник без колонок) → НЕ проверено', () => {
    expect(isTaskScoreReviewed({})).toBe(false);
  });

  it('только tutor_reviewed_at → проверено', () => {
    expect(
      isTaskScoreReviewed({
        tutor_reviewed_at: '2026-07-20T10:00:00Z',
        tutor_force_completed_at: null,
      }),
    ).toBe(true);
  });

  it('только tutor_force_completed_at (force-close) → проверено', () => {
    expect(
      isTaskScoreReviewed({
        tutor_reviewed_at: null,
        tutor_force_completed_at: '2026-07-20T10:00:00Z',
      }),
    ).toBe(true);
  });

  it('оба поля заполнены → проверено', () => {
    expect(
      isTaskScoreReviewed({
        tutor_reviewed_at: '2026-07-20T10:00:00Z',
        tutor_force_completed_at: '2026-07-21T10:00:00Z',
      }),
    ).toBe(true);
  });
});

describe('isStudentWorkFullyReviewed', () => {
  const t = (id: string) => ({ task_id: id });
  const reviewed = (id: string) => ({
    task_id: id,
    tutor_reviewed_at: '2026-07-20T10:00:00Z',
    tutor_force_completed_at: null,
  });
  const forced = (id: string) => ({
    task_id: id,
    tutor_reviewed_at: null,
    tutor_force_completed_at: '2026-07-20T10:00:00Z',
  });
  const unreviewed = (id: string) => ({
    task_id: id,
    tutor_reviewed_at: null,
    tutor_force_completed_at: null,
  });

  it('смесь reviewed_at и force_completed по всем задачам → полностью проверено', () => {
    expect(
      isStudentWorkFullyReviewed([t('a'), t('b'), t('c')], [
        reviewed('a'),
        forced('b'),
        reviewed('c'),
      ]),
    ).toBe(true);
  });

  it('хотя бы одна задача с непроверенным task_score → false', () => {
    expect(
      isStudentWorkFullyReviewed([t('a'), t('b')], [reviewed('a'), unreviewed('b')]),
    ).toBe(false);
  });

  it('задача без task_score вовсе (ученик не дошёл) → консервативно false', () => {
    expect(isStudentWorkFullyReviewed([t('a'), t('b')], [reviewed('a')])).toBe(false);
  });

  it('лишние task_scores чужих задач не делают работу проверенной', () => {
    // Проверенный score по задаче, которой нет в allTasks, не закрывает 'a'.
    expect(isStudentWorkFullyReviewed([t('a')], [reviewed('zzz')])).toBe(false);
  });

  it('пустой список задач → vacuously TRUE (задокументированный edge, code review P2)', () => {
    // Зафиксировано поведение из кода: ДЗ без задач НЕ висит вечно «на проверку».
    expect(isStudentWorkFullyReviewed([], [])).toBe(true);
    expect(isStudentWorkFullyReviewed([], [unreviewed('a')])).toBe(true);
  });
});
