// LWW-reconcile сцены листа (Этап 3, конфликт-путь 409 REV_CONFLICT).
//
// Модель — экскалидровский консенсус (research фазы P0): элемент целиком
// побеждает по (version, versionNonce); при РАВНЫХ version детерминированный
// тай-брейк — МЕНЬШИЙ versionNonce (одинаков на всех клиентах, порядок
// применения не важен). CRDT сознательно отвергнут: «каждый пишет в своей
// зоне», коллизии на одном элементе редки (ученик ↔ репетитор в его зоне).
//
// Известное ограничение v1 (принято планом): tombstone'ов нет, поэтому
// element, УДАЛЁННЫЙ одной стороной и НЕ ТРОНУТЫЙ другой, при конфликте
// объединением «воскресает». Для зоны с одним основным писателем это
// крайне редкий случай; переход на tombstones — при жалобах пилота.

import type { BoardElement } from './model';

export interface ReconcileResult {
  merged: BoardElement[];
  /** true — результат отличается от серверной версии (нужно пересохранить). */
  divergesFromRemote: boolean;
}

function wins(local: BoardElement, remote: BoardElement): boolean {
  if (local.version !== remote.version) return local.version > remote.version;
  return local.versionNonce < remote.versionNonce;
}

/**
 * Слить локальную сцену с серверной после 409.
 * `protectedIds` — элементы, которые прямо сейчас редактируются локально
 * (transform-draft, свежая вставка): их локальная версия побеждает
 * БЕЗУСЛОВНО — «щит активного редактирования» (Excalidraw/Figma-паттерн:
 * без него у пользователя обрывало бы правку под руками).
 */
export function reconcileElements(
  local: BoardElement[],
  remote: BoardElement[],
  protectedIds: ReadonlySet<string> = new Set(),
): ReconcileResult {
  const localById = new Map<string, BoardElement>();
  for (let i = 0; i < local.length; i++) localById.set(local[i].id, local[i]);

  const merged: BoardElement[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < remote.length; i++) {
    const r = remote[i];
    const l = localById.get(r.id);
    seen.add(r.id);
    if (l && (protectedIds.has(r.id) || wins(l, r))) merged.push(l);
    else merged.push(r);
  }

  // Локальные элементы, которых сервер не знает (новые штрихи проигравшего).
  for (let i = 0; i < local.length; i++) {
    if (!seen.has(local[i].id)) merged.push(local[i]);
  }

  merged.sort((a, b) => a.seq - b.seq);

  const divergesFromRemote =
    merged.length !== remote.length ||
    merged.some((el, i) => el !== remote[i]);

  return { merged, divergesFromRemote };
}
