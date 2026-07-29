import { describe, expect, it } from 'vitest';
import { reconcileElements } from './reconcile';
import { bumpVersion, createStroke, createText, type BoardElement } from './model';

// 409-конфликт (Этап 3): LWW по (version, versionNonce) + щит активного
// редактирования. Детерминизм тай-брейка — фундамент: обе стороны обязаны
// сойтись к ОДНОМУ результату независимо от порядка применения.

function el(label: string): BoardElement {
  return createText(0, 0, label, '#000', 6);
}

describe('reconcileElements', () => {
  it('большая версия побеждает в обе стороны', () => {
    const base = el('a');
    const newer = bumpVersion(base, { text: 'новее' } as Partial<BoardElement>);
    const r1 = reconcileElements([newer], [base]);
    expect((r1.merged[0] as { text: string }).text).toBe('новее');
    expect(r1.divergesFromRemote).toBe(true);

    const r2 = reconcileElements([base], [newer]);
    expect((r2.merged[0] as { text: string }).text).toBe('новее');
    expect(r2.divergesFromRemote).toBe(false);
  });

  it('при равных версиях побеждает МЕНЬШИЙ nonce — детерминированно с обеих сторон', () => {
    const base = el('x');
    const a: BoardElement = { ...base, version: 5, versionNonce: 100 };
    const b: BoardElement = { ...base, version: 5, versionNonce: 200 };
    const fromA = reconcileElements([a], [b]);
    const fromB = reconcileElements([b], [a]);
    expect(fromA.merged[0].versionNonce).toBe(100);
    expect(fromB.merged[0].versionNonce).toBe(100);
  });

  it('щит активного редактирования: protected локальный побеждает даже старой версией', () => {
    const base = el('щит');
    const localOld: BoardElement = { ...base, version: 1, versionNonce: 999 };
    const remoteNew: BoardElement = { ...base, version: 7, versionNonce: 1 };
    const result = reconcileElements([localOld], [remoteNew], new Set([base.id]));
    expect(result.merged[0].version).toBe(1);
    expect(result.divergesFromRemote).toBe(true);
  });

  it('новые локальные элементы доливаются, серверные незнакомые — принимаются', () => {
    const shared = el('общий');
    const localOnly = createStroke([0, 0, 0.5, 5, 5, 0.5], '#000', 1);
    const remoteOnly = el('серверный');
    const result = reconcileElements([shared, localOnly], [shared, remoteOnly]);
    const ids = result.merged.map((m) => m.id);
    expect(ids).toContain(localOnly.id);
    expect(ids).toContain(remoteOnly.id);
    expect(result.divergesFromRemote).toBe(true);
  });

  it('идентичные сцены → divergesFromRemote=false (пересохранение не нужно)', () => {
    const a = el('1');
    const b = el('2');
    const result = reconcileElements([a, b], [a, b]);
    expect(result.divergesFromRemote).toBe(false);
    expect(result.merged).toHaveLength(2);
  });

  it('порядок результата — по seq (z-порядок сцены)', () => {
    const first = el('низ');
    const second = el('верх');
    const result = reconcileElements([second], [first, second]);
    expect(result.merged.map((m) => m.seq)).toEqual(
      [...result.merged.map((m) => m.seq)].sort((x, y) => x - y),
    );
  });
});
