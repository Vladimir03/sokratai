/**
 * Фолбэк-конвертация УЖЕ загруженных .heic на стороне зрителя.
 *
 * ЗАЧЕМ: до 2026-07-30 сырые HEIC попадали в storage (см. `heicDecode.ts`),
 * и репетитор на Windows видел вместо решения ученика карточку
 * «HEIC — скачать» (баг Ирины Бочаровой). Новые загрузки конвертируются при
 * отправке, а этот хук делает видимой ИСТОРИЮ: `<img>` не смог отрендерить →
 * скачиваем байты по signed URL → wasm-декод → objectURL.
 *
 * Кэш конвертаций module-level: ключ — путь БЕЗ query (signed-токены
 * ротируются при каждом резолве, путь стабилен), поэтому превью и
 * fullscreen-диалог делят одну запись = один декод на фото. LRU ~20 с
 * revokeObjectURL при вытеснении; на unmount НЕ revoke — диалоги ремоунтятся.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { decodeHeicToJpegBlob, isHeicLikeUrl } from '@/lib/heicDecode';

const CACHE_CAP = 20;
const convertedCache = new Map<string, Promise<string>>();

/** Exported for tests. Стабильный ключ кэша: origin+pathname без query. */
export function normalizeHeicCacheKey(src: string): string {
  try {
    const url = new URL(src, 'https://sokratai.ru');
    return `${url.origin}${url.pathname}`;
  } catch {
    return src;
  }
}

function getConvertedObjectUrl(src: string): Promise<string> {
  const key = normalizeHeicCacheKey(src);
  const existing = convertedCache.get(key);
  if (existing) {
    // LRU-touch: Map держит порядок вставки.
    convertedCache.delete(key);
    convertedCache.set(key, existing);
    return existing;
  }

  const promise = (async () => {
    const resp = await fetch(src);
    if (!resp.ok) {
      throw new Error(`heic fetch failed: ${resp.status}`);
    }
    const blob = await resp.blob();
    const jpeg = await decodeHeicToJpegBlob(blob);
    return URL.createObjectURL(jpeg);
  })();

  convertedCache.set(key, promise);
  // Неудачи не кэшируем — signed URL мог просто протухнуть.
  promise.catch(() => {
    if (convertedCache.get(key) === promise) convertedCache.delete(key);
  });

  if (convertedCache.size > CACHE_CAP) {
    const oldestKey = convertedCache.keys().next().value;
    if (oldestKey !== undefined && oldestKey !== key) {
      const evicted = convertedCache.get(oldestKey);
      convertedCache.delete(oldestKey);
      evicted?.then((url) => URL.revokeObjectURL(url)).catch(() => {});
    }
  }

  return promise;
}

export type HeicImageState = 'ok' | 'converting' | 'failed';

/**
 * Обвязка для `<img>` с HEIC-фолбэком:
 *
 *   const { effectiveSrc, state, onImgError } = useHeicImage(src);
 *   state === 'converting' → скелетон; 'failed' → карточка «скачать»;
 *   иначе <img src={effectiveSrc} onError={onImgError} />.
 */
export function useHeicImage(src: string): {
  effectiveSrc: string;
  state: HeicImageState;
  onImgError: () => void;
} {
  const [state, setState] = useState<HeicImageState>('ok');
  const [convertedSrc, setConvertedSrc] = useState<string | null>(null);
  const srcRef = useRef(src);
  const attemptedForRef = useRef<string | null>(null);

  useEffect(() => {
    srcRef.current = src;
    setState('ok');
    setConvertedSrc(null);
  }, [src]);

  const onImgError = useCallback(() => {
    const forSrc = src;
    // Не-HEIC либо повторный сбой уже после конвертации (например, objectURL
    // вытеснен из кэша) → честный failed, без циклов.
    if (!isHeicLikeUrl(forSrc) || attemptedForRef.current === forSrc) {
      setState('failed');
      return;
    }
    attemptedForRef.current = forSrc;
    setState('converting');
    getConvertedObjectUrl(forSrc).then(
      (url) => {
        if (srcRef.current === forSrc) {
          setConvertedSrc(url);
          setState('ok');
        }
      },
      () => {
        if (srcRef.current === forSrc) setState('failed');
      },
    );
  }, [src]);

  return { effectiveSrc: convertedSrc ?? src, state, onImgError };
}
