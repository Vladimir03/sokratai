import { describe, expect, it } from 'vitest';
import {
  isQuarterTurn,
  normalizeDegrees,
  resolveRefsForUrls,
  rotateDegrees,
  storageRefFromUrl,
} from './photoOrientation';

/**
 * Нормализация угла — зеркало серверной в `photo_orientations_set`. Разойдутся
 * — и клиент покажет одно, а ученик с AI увидят другое.
 */
describe('normalizeDegrees', () => {
  it('пропускает допустимые значения', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(90)).toBe(90);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(270)).toBe(270);
  });

  it('заворачивает отрицательные и большие', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(-360)).toBe(0);
    expect(normalizeDegrees(450)).toBe(90);
    expect(normalizeDegrees(720)).toBe(0);
  });

  it('мусор и промежуточные углы схлопывает в 0, а не роняет экран', () => {
    expect(normalizeDegrees(45)).toBe(0);
    expect(normalizeDegrees(Number.NaN)).toBe(0);
    expect(normalizeDegrees(null)).toBe(0);
    expect(normalizeDegrees(undefined)).toBe(0);
    expect(normalizeDegrees('90')).toBe(90);
  });
});

describe('rotateDegrees', () => {
  it('крутит по кругу в обе стороны', () => {
    expect(rotateDegrees(0, 90)).toBe(90);
    expect(rotateDegrees(270, 90)).toBe(0);
    expect(rotateDegrees(0, -90)).toBe(270);
  });

  it('четыре шага возвращают в исходное', () => {
    let value = rotateDegrees(0, 90);
    value = rotateDegrees(value, 90);
    value = rotateDegrees(value, 90);
    value = rotateDegrees(value, 90);
    expect(value).toBe(0);
  });
});

describe('isQuarterTurn', () => {
  it('верно только для 90 и 270 — на них меняются стороны кадра', () => {
    expect(isQuarterTurn(0)).toBe(false);
    expect(isQuarterTurn(90)).toBe(true);
    expect(isQuarterTurn(180)).toBe(false);
    expect(isQuarterTurn(270)).toBe(true);
  });
});

/**
 * Восстановление ref из подписанной ссылки: благодаря ему поворот сохраняется
 * и там, где бэкенд отдаёт только URL (пробники, материалы), без прокидывания
 * второго поля через edge.
 */
describe('storageRefFromUrl', () => {
  it('разбирает подписанную ссылку', () => {
    expect(
      storageRefFromUrl(
        'https://api.sokratai.ru/storage/v1/object/sign/homework-images/abc/def.jpg?token=eyJ',
      ),
    ).toBe('storage://homework-images/abc/def.jpg');
  });

  it('разбирает public и authenticated', () => {
    expect(
      storageRefFromUrl('https://api.sokratai.ru/storage/v1/object/public/kb-attachments/a/b.png'),
    ).toBe('storage://kb-attachments/a/b.png');
    expect(
      storageRefFromUrl('https://api.sokratai.ru/storage/v1/object/authenticated/board-images/x.jpg'),
    ).toBe('storage://board-images/x.jpg');
  });

  it('декодирует percent-последовательности до вида, в котором ref хранится', () => {
    expect(
      storageRefFromUrl(
        'https://api.sokratai.ru/storage/v1/object/sign/lesson-materials/%D1%84%D0%BE%D1%82%D0%BE.jpg?token=x',
      ),
    ).toBe('storage://lesson-materials/фото.jpg');
  });

  it('готовый storage-ref возвращает как есть', () => {
    expect(storageRefFromUrl('storage://bucket/path.jpg')).toBe('storage://bucket/path.jpg');
  });

  it('чужие ссылки не притворяются ref — иначе поворот лёг бы на случайный ключ (внутри resolveRefsForUrls тоже)', () => {
    expect(storageRefFromUrl('https://example.com/photo.jpg')).toBeNull();
    expect(storageRefFromUrl('blob:https://sokratai.ru/8f0c')).toBeNull();
    expect(storageRefFromUrl('data:image/png;base64,AAA')).toBeNull();
    expect(storageRefFromUrl('')).toBeNull();
    expect(storageRefFromUrl(null)).toBeNull();
    expect(storageRefFromUrl(undefined)).toBeNull();
  });
});

/**
 * Регрессия из ревью волны 1: бэкенд подписывает ссылки через
 * `createSignedStorageUrls`, а тот ВЫКИДЫВАЕТ неподписавшиеся файлы. Массив
 * URL становится короче массива ref'ов, и позиционное сопоставление начинает
 * врать: репетитор поворачивает B, а угол записывается в ref A.
 */
describe('resolveRefsForUrls', () => {
  const A = 'storage://homework-images/a.jpg';
  const B = 'storage://homework-images/b.jpg';
  const C = 'storage://homework-images/c.jpg';
  const signed = (name: string) =>
    `https://api.sokratai.ru/storage/v1/object/sign/homework-images/${name}?token=eyJ`;

  it('при совпадении длин уважает позиционные ref', () => {
    expect(resolveRefsForUrls([signed('a.jpg'), signed('b.jpg')], [A, B])).toEqual([A, B]);
  });

  it('ПЕРВЫЙ файл удалён из хранилища — оставшийся URL не получает чужой ref', () => {
    // refs = [A, B], но подписался только B.
    const result = resolveRefsForUrls([signed('b.jpg')], [A, B]);
    expect(result).toEqual([B]);
    expect(result[0]).not.toBe(A);
  });

  it('СРЕДНИЙ файл удалён — хвост не съезжает на позицию выше', () => {
    const result = resolveRefsForUrls([signed('a.jpg'), signed('c.jpg')], [A, B, C]);
    expect(result).toEqual([A, C]);
    expect(result[1]).not.toBe(B);
  });

  it('без позиционных ref восстанавливает их из ссылок', () => {
    expect(resolveRefsForUrls([signed('a.jpg')], null)).toEqual([A]);
    expect(resolveRefsForUrls([signed('a.jpg')])).toEqual([A]);
  });

  it('не-storage ссылка даёт null, а не случайный ключ', () => {
    expect(resolveRefsForUrls(['https://example.com/x.jpg', signed('b.jpg')])).toEqual([null, B]);
  });

  it('пустой список — пустой результат', () => {
    expect(resolveRefsForUrls([], [A, B])).toEqual([]);
  });
});
