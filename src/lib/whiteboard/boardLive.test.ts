import { describe, expect, it } from 'vitest';
import { BRING_FRESH_MS, shouldApplyBring, stablePeerColor } from './boardLive';

describe('stablePeerColor', () => {
  it('детерминирован: один key → один цвет на любом клиенте', () => {
    expect(stablePeerColor('tutor')).toBe(stablePeerColor('tutor'));
    expect(stablePeerColor('student:abc')).toBe(stablePeerColor('student:abc'));
  });

  it('возвращает hex из палитры', () => {
    expect(stablePeerColor('student:xyz')).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('разные ключи чаще всего получают разные цвета (не константа)', () => {
    const colors = new Set(
      ['tutor', 'student:a', 'student:b', 'student:c', 'student:d', 'student:e'].map(
        stablePeerColor,
      ),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('shouldApplyBring', () => {
  const now = 1_700_000_000_000;

  it('применяет свежий bring с новым seq', () => {
    expect(
      shouldApplyBring({ seq: 10, at: new Date(now - 5_000).toISOString() }, 5, now),
    ).toBe(true);
  });

  it('дедупит по seq: повтор из поллинга не дёргает камеру второй раз', () => {
    expect(shouldApplyBring({ seq: 10 }, 10, now)).toBe(false);
    expect(shouldApplyBring({ seq: 9 }, 10, now)).toBe(false);
  });

  it('игнорирует протухший bring (вкладка гостя открыта позже урока)', () => {
    const stale = new Date(now - BRING_FRESH_MS - 1_000).toISOString();
    expect(shouldApplyBring({ seq: 10, at: stale }, 0, now)).toBe(false);
  });

  it('без метки времени (broadcast, всегда живой) — применяет', () => {
    expect(shouldApplyBring({ seq: 3, at: null }, 0, now)).toBe(true);
  });

  it('отвергает нечисловой seq', () => {
    expect(shouldApplyBring({ seq: Number.NaN }, 0, now)).toBe(false);
  });
});
