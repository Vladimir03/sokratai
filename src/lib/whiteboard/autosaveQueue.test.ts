import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveQueue, type AutosaveStatus } from './autosaveQueue';

// Инварианты P0 из ревью 5.6: single-flight, дренаж до конца, возврат в
// очередь при ошибке, честный статус. Класс чистый — тестируется без React.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AutosaveQueue', () => {
  let statuses: AutosaveStatus[];

  beforeEach(() => {
    vi.useFakeTimers();
    statuses = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('single-flight: параллельный flush получает тот же promise', async () => {
    const gate = deferred<void>();
    const savePage = vi.fn().mockReturnValue(gate.promise);
    const q = new AutosaveQueue({ savePage, onStatus: (s) => statuses.push(s) });

    q.markDirty('a');
    const first = q.flush();
    const second = q.flush();
    expect(second).toBe(first);

    gate.resolve();
    await expect(first).resolves.toBe(true);
    expect(savePage).toHaveBeenCalledTimes(1);
  });

  it('дренит страницы, испачканные ВО ВРЕМЯ сохранения, тем же циклом', async () => {
    const gates = [deferred<void>(), deferred<void>()];
    let call = 0;
    const savePage = vi.fn().mockImplementation(() => gates[call++].promise);
    const q = new AutosaveQueue({ savePage, onStatus: (s) => statuses.push(s) });

    q.markDirty('a');
    const flush = q.flush();
    // Пока страница a в полёте — репетитор дописал штрих на b.
    q.markDirty('b');
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    gates[1].resolve();

    await expect(flush).resolves.toBe(true);
    expect(savePage.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(statuses[statuses.length - 1]).toBe('saved');
  });

  it('ошибка возвращает несохранённое в очередь и авторетраит', async () => {
    const savePage = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const q = new AutosaveQueue({
      savePage,
      onStatus: (s) => statuses.push(s),
      retryMs: 1000,
    });

    q.markDirty('a');
    q.markDirty('b');
    await expect(q.flush()).resolves.toBe(false);
    expect(statuses[statuses.length - 1]).toBe('error');
    expect(q.isDirty).toBe(true);

    // Авторетрай через retryMs добивает очередь без участия пользователя.
    await vi.advanceTimersByTimeAsync(1000);
    expect(q.isDirty).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('saved');
    // 1 неудачная + 2 успешные (обе страницы вернулись в очередь).
    expect(savePage).toHaveBeenCalledTimes(3);
  });

  it('markDirty дебаунсит и запускает flush сам', async () => {
    const savePage = vi.fn().mockResolvedValue(undefined);
    const q = new AutosaveQueue({ savePage, onStatus: () => undefined, delayMs: 900 });

    q.markDirty('a');
    await vi.advanceTimersByTimeAsync(800);
    expect(savePage).not.toHaveBeenCalled();
    q.markDirty('a'); // перезаводит таймер
    await vi.advanceTimersByTimeAsync(800);
    expect(savePage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(savePage).toHaveBeenCalledTimes(1);
  });

  it('статус error не понижается новыми правками до успешного сохранения', async () => {
    const savePage = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const q = new AutosaveQueue({ savePage, onStatus: (s) => statuses.push(s), retryMs: 60000 });

    q.markDirty('a');
    await q.flush();
    expect(statuses[statuses.length - 1]).toBe('error');
    q.markDirty('b');
    expect(statuses[statuses.length - 1]).toBe('error');
  });

  it('flush без грязных страниц — мгновенный true', async () => {
    const savePage = vi.fn();
    const q = new AutosaveQueue({ savePage, onStatus: () => undefined });
    await expect(q.flush()).resolves.toBe(true);
    expect(savePage).not.toHaveBeenCalled();
  });

  it('dispose останавливает таймеры (ретрай не стреляет после ухода)', async () => {
    const savePage = vi.fn().mockRejectedValue(new Error('x'));
    const q = new AutosaveQueue({ savePage, onStatus: () => undefined, retryMs: 1000 });
    q.markDirty('a');
    await q.flush();
    q.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(savePage).toHaveBeenCalledTimes(1);
  });
});
