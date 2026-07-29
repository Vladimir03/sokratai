import { describe, expect, it } from 'vitest';
import { SceneHistory } from './sceneHistory';
import { createText, type BoardElement } from './model';

function scene(...labels: string[]): BoardElement[] {
  return labels.map((label) => createText(0, 0, label, '#000', 6));
}

describe('SceneHistory', () => {
  it('undo/redo симметричны', () => {
    const h = new SceneHistory();
    const v1 = scene('a');
    const v2 = scene('a', 'b');
    h.push('p', v1);

    const undone = h.undo('p', v2);
    expect(undone).toBe(v1);
    expect(h.canRedo('p')).toBe(true);

    const redone = h.redo('p', v1);
    expect(redone).toBe(v2);
    expect(h.canUndo('p')).toBe(true);
  });

  it('дедуп по ссылке: burst ластика даёт ОДНУ запись', () => {
    const h = new SceneHistory();
    const before = scene('a', 'b', 'c');
    // Один жест ластика: несколько onEraseElements с тем же committed-снапшотом.
    h.push('p', before);
    h.push('p', before);
    h.push('p', before);

    expect(h.undo('p', scene())).toBe(before);
    expect(h.canUndo('p')).toBe(false);
  });

  it('новая правка стирает redo-ветку', () => {
    const h = new SceneHistory();
    const v1 = scene('a');
    const v2 = scene('a', 'b');
    h.push('p', v1);
    h.undo('p', v2);
    expect(h.canRedo('p')).toBe(true);

    h.push('p', scene('a', 'c'));
    expect(h.canRedo('p')).toBe(false);
  });

  it('лимит выталкивает старейшие снапшоты, а не новые', () => {
    const h = new SceneHistory(3);
    const snapshots = [scene('1'), scene('2'), scene('3'), scene('4')];
    snapshots.forEach((s) => h.push('p', s));

    expect(h.undo('p', scene('x'))).toBe(snapshots[3]);
    expect(h.undo('p', snapshots[3])).toBe(snapshots[2]);
    expect(h.undo('p', snapshots[2])).toBe(snapshots[1]);
    // snapshots[0] вытолкнут лимитом.
    expect(h.undo('p', snapshots[1])).toBeNull();
  });

  it('страницы независимы, forget чистит только свою', () => {
    const h = new SceneHistory();
    h.push('p1', scene('a'));
    h.push('p2', scene('b'));
    h.forget('p1');
    expect(h.canUndo('p1')).toBe(false);
    expect(h.canUndo('p2')).toBe(true);
  });
});
