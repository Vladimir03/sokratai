import { describe, expect, it, vi } from 'vitest';

import {
  HeicDecodeError,
  __getActiveDecodeCount,
  decodeHeicToJpegBlob,
  isHeicLikeFile,
  isHeicLikeUrl,
} from './heicDecode';

// Реальный wasm в CI не гоняем — мокаем модуль целиком.
const heicToMock = vi.hoisted(() => vi.fn());
vi.mock('heic-to', () => ({
  heicTo: heicToMock,
  isHeic: vi.fn(),
}));

describe('isHeicLikeFile', () => {
  it('детектит по MIME', () => {
    expect(isHeicLikeFile({ type: 'image/heic', name: 'photo' })).toBe(true);
    expect(isHeicLikeFile({ type: 'image/heif', name: 'photo' })).toBe(true);
  });

  it('детектит по имени при пустом type (iOS-пикер «Выбрать файлы»)', () => {
    expect(isHeicLikeFile({ type: '', name: 'IMG_0042.heic' })).toBe(true);
    expect(isHeicLikeFile({ type: '', name: 'IMG_0042.HEIC' })).toBe(true);
    expect(isHeicLikeFile({ type: '', name: 'scan.heif' })).toBe(true);
  });

  it('не срабатывает на обычных форматах', () => {
    expect(isHeicLikeFile({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
    expect(isHeicLikeFile({ type: 'image/png', name: 'shot.png' })).toBe(false);
    expect(isHeicLikeFile({ type: 'application/pdf', name: 'doc.pdf' })).toBe(false);
    expect(isHeicLikeFile({ type: '', name: 'photo.jpg' })).toBe(false);
    // «heic» внутри имени, но не расширение
    expect(isHeicLikeFile({ type: 'image/jpeg', name: 'heic-guide.jpg' })).toBe(false);
  });
});

describe('isHeicLikeUrl', () => {
  it('детектит .heic/.heif, включая signed URL с query', () => {
    expect(isHeicLikeUrl('https://api.sokratai.ru/storage/x/photo.heic')).toBe(true);
    expect(isHeicLikeUrl('https://api.sokratai.ru/storage/x/photo.heic?token=abc')).toBe(true);
    expect(isHeicLikeUrl('https://api.sokratai.ru/storage/x/1785170142208-gayo4dsg.HEIF?t=1')).toBe(
      true,
    );
  });

  it('не срабатывает на jpg/png и на heic внутри пути', () => {
    expect(isHeicLikeUrl('https://x/photo.jpg?token=abc')).toBe(false);
    expect(isHeicLikeUrl('https://x/heic-folder/photo.png')).toBe(false);
  });
});

describe('decodeHeicToJpegBlob', () => {
  it('возвращает blob из heicTo', async () => {
    const out = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
    heicToMock.mockResolvedValueOnce(out);
    const result = await decodeHeicToJpegBlob(new Blob(['heic']), 0.9);
    expect(result).toBe(out);
    expect(heicToMock).toHaveBeenCalledWith({
      blob: expect.any(Blob),
      type: 'image/jpeg',
      quality: 0.9,
    });
  });

  it('битый файл → HeicDecodeError с русским сообщением', async () => {
    heicToMock.mockRejectedValueOnce(new Error('libheif: invalid input'));
    await expect(decodeHeicToJpegBlob(new Blob(['garbage']))).rejects.toBeInstanceOf(
      HeicDecodeError,
    );
    heicToMock.mockRejectedValueOnce(new Error('boom'));
    await expect(decodeHeicToJpegBlob(new Blob(['garbage']))).rejects.toThrow(
      /Не удалось обработать фото с iPhone/,
    );
  });

  it('пустой blob от декодера → HeicDecodeError', async () => {
    heicToMock.mockResolvedValueOnce(new Blob([]));
    await expect(decodeHeicToJpegBlob(new Blob(['x']))).rejects.toBeInstanceOf(HeicDecodeError);
  });

  it('семафор: не больше 2 параллельных декодов, очередь дожимается', async () => {
    const resolvers: Array<(b: Blob) => void> = [];
    heicToMock.mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    const p1 = decodeHeicToJpegBlob(new Blob(['1']));
    const p2 = decodeHeicToJpegBlob(new Blob(['2']));
    const p3 = decodeHeicToJpegBlob(new Blob(['3']));

    // Дать микротаскам провернуться: первые два должны войти, третий — ждать.
    await tick();
    expect(__getActiveDecodeCount()).toBe(2);
    expect(resolvers.length).toBe(2);

    resolvers[0](new Blob(['a'], { type: 'image/jpeg' }));
    await p1;
    // Слот передан третьему.
    await tick();
    expect(resolvers.length).toBe(3);

    resolvers[1](new Blob(['b'], { type: 'image/jpeg' }));
    resolvers[2](new Blob(['c'], { type: 'image/jpeg' }));
    await Promise.all([p2, p3]);
    expect(__getActiveDecodeCount()).toBe(0);
  });
});
