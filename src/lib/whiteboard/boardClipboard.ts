// Внутренний буфер обмена доски (B3, репорт Елены: «Ctrl+C/V вставляет
// предыдущее содержимое буфера, свой объект не копируется»).
//
// Причина бага Фазы 1: копирования объектов не существовало вовсе, а Ctrl+V
// перехватывался вставкой КАРТИНОК из буфера ОС — репетитор получал последний
// скриншот вместо своего штриха. Порядок теперь такой: Ctrl+V сначала смотрит
// во внутренний буфер (скопированные элементы доски), и только если он пуст —
// в буфер ОС за картинкой.
//
// Буфер — модульный синглтон: живёт между досками одной вкладки (скопировать
// на одной доске, вставить на другой — легально). В буфер ОС пишем best-effort
// маркер, чтобы СВЕЖАЯ ОС-картинка (скриншот после Ctrl+C объектов) могла
// победить: если маркер в ОС не совпадает с внутренним счётчиком — значит,
// после копирования объектов в ОС положили что-то новее.

import {
  type BoardElement,
  elementBoundsCached,
  parseElements,
  reassignIdentity,
  translateElement,
} from './model';

const OS_MARKER_PREFIX = 'sokratai-board-clip:';
/** Смещение вставки, чтобы копия не легла точно на оригинал. */
const PASTE_OFFSET_MM = 5;

let clipSeq = 0;
let internal: { seq: number; elements: BoardElement[] } | null = null;

/** Скопировать элементы (глубокая фиксация через сериализацию — буфер иммутабелен). */
export function copyElements(elements: BoardElement[]): number {
  if (elements.length === 0) return 0;
  clipSeq += 1;
  internal = {
    seq: clipSeq,
    elements: parseElements(JSON.parse(JSON.stringify(elements))),
  };
  // Маркер в ОС-буфер: если пользователь потом сделает скриншот, ОС-буфер
  // перестанет совпадать с маркером и Ctrl+V честно вставит скриншот.
  // writeText — Promise: отказ Safari/iOS прилетает АСИНХРОННО, синхронный
  // try/catch его не ловит → был бы unhandled rejection в client_error.
  try {
    navigator.clipboard?.writeText?.(`${OS_MARKER_PREFIX}${clipSeq}`)?.catch(() => undefined);
  } catch {
    // Нет прав на clipboard — не страшно, внутренний буфер всё равно работает.
  }
  return internal.elements.length;
}

export function hasInternalClipboard(): boolean {
  return internal !== null && internal.elements.length > 0;
}

/**
 * Решает, чья вставка: внутренняя или ОС. `osText` — текст из события paste
 * (если ОС-буфер держит наш маркер — вставляем внутреннее; если там текст или
 * картинка новее маркера — приоритет у ОС).
 */
export function shouldUseInternalClipboard(event: ClipboardEvent): boolean {
  if (!hasInternalClipboard()) return false;
  const items = event.clipboardData;
  if (!items) return true;
  const text = items.getData('text/plain');
  if (text.startsWith(OS_MARKER_PREFIX)) {
    // Наш маркер: сверяем поколение — вдруг это маркер от старого копирования,
    // а внутренний буфер уже перезаписан (не важно — маркер значит «наше»).
    return true;
  }
  // В ОС-буфере посторонний текст или файлы → пользователь копировал что-то
  // ПОСЛЕ наших объектов. Но пустой текст при наличии файлов-картинок — это
  // скриншот: отдаём приоритет ОС.
  const hasOsPayload = text.length > 0 || (items.files?.length ?? 0) > 0;
  return !hasOsPayload;
}

/**
 * Вставка: клоны с новыми id/seq (createElementId через parseElements не
 * генерит — поэтому пересобираем руками) и смещением. `around` — центр вставки
 * в ЛОКАЛЬНЫХ координатах целевой рамки; если не задан — смещение от оригинала.
 */
export function pasteElements(around?: { x: number; y: number }): BoardElement[] {
  if (!internal || internal.elements.length === 0) return [];
  const source = internal.elements;

  let dx = PASTE_OFFSET_MM;
  let dy = PASTE_OFFSET_MM;
  if (around) {
    // Центр исходной группы → в точку вставки.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < source.length; i++) {
      const b = elementBoundsCached(source[i]);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    dx = around.x - (minX + maxX) / 2;
    dy = around.y - (minY + maxY) / 2;
  }

  // Сдвиг + полная новая идентичность (id/seq/nonce — model.reassignIdentity):
  // копия обязана быть самостоятельной сущностью поверх сцены.
  return source.map((el) => reassignIdentity(translateElement(el, dx, dy)));
}
