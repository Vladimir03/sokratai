/**
 * HEIC/HEIF → JPEG декодирование на клиенте (wasm libheif через `heic-to`).
 *
 * ЗАЧЕМ: айфоны снимают в HEIC, а декодировать его в `<img>` умеет только
 * Safari 17+. До этого модуля `compressForUpload` при неудаче нативного
 * декода молча загружал сырой .heic → репетитор на Windows видел
 * «HEIC — скачать», ученик на iOS 15/16 не видел своё фото, а AI-грейдер
 * проверял решение НЕ видя фото (Gemini не декодирует HEIC).
 *
 * Единственный модуль, знающий про `heic-to`. Сам пакет (~2.9 МБ, wasm
 * инлайном) грузится ТОЛЬКО через динамический import внутри
 * `decodeHeicToJpegBlob` — обычные JPEG/PNG-пользователи чанк не скачивают.
 * НЕ добавлять в vite manualChunks: именованный чанк попал бы в eager
 * preload-граф (katex-инцидент).
 */

/** Битый/недекодируемый HEIC. Сообщение показывается ученику как есть. */
export class HeicDecodeError extends Error {
  constructor() {
    super('Не удалось обработать фото с iPhone. Попробуй переснять или отправить как JPEG.');
    this.name = 'HeicDecodeError';
  }
}

/**
 * HEIC-детект по MIME И имени: iOS-пикер через «Выбрать файлы» часто отдаёт
 * пустой `file.type`, тогда спасает расширение.
 */
export function isHeicLikeFile(file: Pick<File, 'type' | 'name'>): boolean {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

/** HEIC-детект по URL (в т.ч. signed URL с query: `…/photo.heic?token=…`). */
export function isHeicLikeUrl(src: string): boolean {
  return /\.(heic|heif)(\?|$)/i.test(src);
}

type HeicModule = typeof import('heic-to');

let modulePromise: Promise<HeicModule> | null = null;

function loadHeicModule(): Promise<HeicModule> {
  if (!modulePromise) {
    const attempt = import('heic-to');
    // Сетевой сбой загрузки чанка не должен «залипать» навсегда — сбрасываем
    // кэш, чтобы следующий вызов повторил загрузку.
    attempt.catch(() => {
      if (modulePromise === attempt) modulePromise = null;
    });
    modulePromise = attempt;
  }
  return modulePromise;
}

/**
 * Семафор: не больше 2 параллельных wasm-декодов. Сообщение с 5 фото на
 * телефоне не должно запускать 5 декодов по ~100 МБ пиковой памяти каждый.
 */
const MAX_CONCURRENT_DECODES = 2;
let activeDecodes = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeDecodes < MAX_CONCURRENT_DECODES) {
    activeDecodes += 1;
    return Promise.resolve();
  }
  // Слот передаётся напрямую от release к waiter — activeDecodes не меняется.
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) {
    next();
  } else {
    activeDecodes = Math.max(0, activeDecodes - 1);
  }
}

/** Только для тестов семафора. */
export function __getActiveDecodeCount(): number {
  return activeDecodes;
}

/**
 * Декодирует HEIC/HEIF в JPEG-blob. Бросает `HeicDecodeError` при любом сбое
 * (битый файл, не загрузился wasm-чанк) — вызывающий решает fail-open/closed.
 */
export async function decodeHeicToJpegBlob(input: Blob, quality = 0.92): Promise<Blob> {
  await acquireSlot();
  try {
    const mod = await loadHeicModule();
    const blob = await mod.heicTo({ blob: input, type: 'image/jpeg', quality });
    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new HeicDecodeError();
    }
    return blob;
  } catch (err) {
    if (err instanceof HeicDecodeError) throw err;
    console.warn('[heicDecode] decode failed', err);
    throw new HeicDecodeError();
  } finally {
    releaseSlot();
  }
}
