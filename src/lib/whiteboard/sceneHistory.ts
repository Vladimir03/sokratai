// Undo/redo-история сцен по страницам (вынесена из Whiteboard.tsx — чистый
// класс, тестируемый без React; часть архитектурного рефакторинга после
// ревью 5.6).
//
// Снапшоты — ССЫЛКИ на иммутабельные массивы элементов. Structural sharing
// действует на сами элементы, но каждый снапшот держит массив из O(n) ссылок,
// т.е. верхняя граница — O(limit × элементов) на страницу (уточнение из
// ревью р.4; прежний комментарий занижал оценку). Лимит — единственный кап.

import type { BoardElement } from './model';

const DEFAULT_LIMIT = 60;

interface HistoryEntry {
  past: BoardElement[][];
  future: BoardElement[][];
}

export class SceneHistory {
  private entries = new Map<string, HistoryEntry>();

  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /**
   * Записать состояние ДО правки. Дедуп по ссылке: burst-операции (ластик за
   * один жест) зовут push с одним и тем же committed-снапшотом — в истории он
   * нужен один раз, иначе Ctrl+Z превращается в покадровую перемотку.
   */
  push(pageId: string, snapshot: BoardElement[]): void {
    const entry = this.entries.get(pageId) ?? { past: [], future: [] };
    if (entry.past[entry.past.length - 1] === snapshot) return;
    entry.past.push(snapshot);
    if (entry.past.length > this.limit) entry.past.shift();
    // Новая правка инвалидирует redo-ветку — иначе redo «воскрешал» бы
    // состояние из альтернативной реальности.
    entry.future = [];
    this.entries.set(pageId, entry);
  }

  /** Вернуть предыдущее состояние (текущее уходит в redo) или null. */
  undo(pageId: string, current: BoardElement[]): BoardElement[] | null {
    const entry = this.entries.get(pageId);
    if (!entry || entry.past.length === 0) return null;
    const previous = entry.past.pop() as BoardElement[];
    entry.future.push(current);
    return previous;
  }

  /** Вернуть отменённое состояние (текущее уходит в undo) или null. */
  redo(pageId: string, current: BoardElement[]): BoardElement[] | null {
    const entry = this.entries.get(pageId);
    if (!entry || entry.future.length === 0) return null;
    const next = entry.future.pop() as BoardElement[];
    entry.past.push(current);
    return next;
  }

  canUndo(pageId: string): boolean {
    return (this.entries.get(pageId)?.past.length ?? 0) > 0;
  }

  canRedo(pageId: string): boolean {
    return (this.entries.get(pageId)?.future.length ?? 0) > 0;
  }

  forget(pageId: string): void {
    this.entries.delete(pageId);
  }
}
