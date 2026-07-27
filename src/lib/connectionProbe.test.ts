import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeConnection, resetConnectionProbeCache } from './connectionProbe';

/**
 * Пробник запускается только по факту сбоя, поэтому его цена — не скорость, а
 * КОЛИЧЕСТВО запросов: восемь фото условия, упавших разом, не должны дать
 * восемь диагностических вызовов. Кэш и дедуп in-flight — главное, что здесь
 * проверяется.
 */
describe('probeConnection', () => {
  beforeEach(() => {
    resetConnectionProbeCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetConnectionProbeCache();
  });

  it('любой HTTP-ответ считает сервер достижимым (401 — тоже ответ)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response),
    );

    await expect(probeConnection()).resolves.toBe('server_ok');
  });

  it('сетевая ошибка или таймаут → server_unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    await expect(probeConnection()).resolves.toBe('server_unreachable');
  });

  it('второй вызов берёт вердикт из кэша, не дёргая сеть', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await probeConnection();
    await probeConnection();
    await probeConnection();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('параллельные вызовы схлопываются в один запрос', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([
      probeConnection(),
      probeConnection(),
      probeConnection(),
      probeConnection(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      'server_ok',
      'server_ok',
      'server_ok',
      'server_ok',
    ]);
  });

  it('после сброса кэша проверяет заново — иначе «Повторить» врал бы старым вердиктом', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeConnection()).resolves.toBe('server_unreachable');
    resetConnectionProbeCache();
    await expect(probeConnection()).resolves.toBe('server_ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('запрос идёт на наш RU-прокси, а не на заблокированный домен (rule 96)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await probeConnection();

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('api.sokratai.ru');
    expect(String(url)).not.toContain('supabase.co');
  });
});
