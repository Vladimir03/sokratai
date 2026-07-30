import { describe, expect, it } from 'vitest';

import { normalizeHeicCacheKey } from './useHeicImage';

describe('normalizeHeicCacheKey', () => {
  it('срезает query — signed-токены ротируются, путь стабилен', () => {
    expect(
      normalizeHeicCacheKey(
        'https://api.sokratai.ru/storage/v1/object/sign/homework-submissions/u/a/1.heic?token=abc',
      ),
    ).toBe('https://api.sokratai.ru/storage/v1/object/sign/homework-submissions/u/a/1.heic');
  });

  it('две выдачи одного файла с разными токенами дают один ключ', () => {
    const a = normalizeHeicCacheKey('https://api.sokratai.ru/x/photo.heic?token=first');
    const b = normalizeHeicCacheKey('https://api.sokratai.ru/x/photo.heic?token=second-rotated');
    expect(a).toBe(b);
  });

  it('разные файлы дают разные ключи', () => {
    expect(normalizeHeicCacheKey('https://x.ru/a/1.heic?t=1')).not.toBe(
      normalizeHeicCacheKey('https://x.ru/a/2.heic?t=1'),
    );
  });

  it('невалидный URL не бросает — возвращает исходную строку как ключ', () => {
    expect(normalizeHeicCacheKey('blob:not-a-standard-url')).toBeTruthy();
  });
});
