// Single-flight очередь автосохранения (архитектурный рефакторинг после
// ревью 5.6: логика вынесена из компонента в чистый класс — её теперь можно
// тестировать без React, а Whiteboard.tsx перестаёт быть 700-строчным богом).
//
// Инварианты (P0 из ревью, НЕ ослаблять):
// • Одновременно живёт максимум ОДИН цикл сохранения. Повторный flush()
//   возвращает тот же promise. Поэтому более старый снапшот физически не
//   может перезаписать более новый: писатель всегда один, и он в конце
//   цикла перечитывает очередь.
// • Цикл дренит очередь ДО КОНЦА: страницы, испачканные во время сохранения,
//   сохраняются в том же цикле.
// • Ошибка возвращает несохранённые id в очередь и планирует авторетрай.
//   Молчаливая потеря конспекта запрещена.
// • 'saved' сообщается ТОЛЬКО при пустой очереди без ошибок.

export type AutosaveStatus = 'saved' | 'saving' | 'error';

export interface AutosaveQueueOptions {
  /** Сохранить одну страницу. Бросает исключение при неудаче. */
  savePage: (pageId: string) => Promise<void>;
  /** Смена статуса — для UI-индикатора. */
  onStatus: (status: AutosaveStatus) => void;
  /** Дебаунс после markDirty, мс. */
  delayMs?: number;
  /** Пауза перед авторетраем после ошибки, мс. */
  retryMs?: number;
  /**
   * Потолок ожидания: flush не позже этого от ПЕРВОГО markDirty после чистого
   * состояния. Без него непрерывное черкание (штрихи чаще delayMs) бесконечно
   * перезаводит дебаунс, и партнёр не видит ничего до паузы.
   */
  maxWaitMs?: number;
}

const DEFAULT_DELAY_MS = 900;
const DEFAULT_RETRY_MS = 5000;

/**
 * Дебаунс автосейва досок: 300 мс (было 900 — фикс латентности 31.07,
 * «ученик→репетитор нужно ≤1 с»). markDirty зовётся на commit штриха
 * (pointerup), не на точку: ≤1-2 сейва/с на пишущего, edge и Realtime-фанаут
 * держат с запасом. Пара к BOARD_AUTOSAVE_MAX_WAIT_MS.
 */
export const BOARD_AUTOSAVE_DELAY_MS = 300;
/** Потолок ожидания для досок: при непрерывном черкании сейв не позже 1 с. */
export const BOARD_AUTOSAVE_MAX_WAIT_MS = 1000;

export class AutosaveQueue {
  private dirty = new Set<string>();
  private flushPromise: Promise<boolean> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private status: AutosaveStatus = 'saved';
  /** Момент первого markDirty после чистого состояния — для maxWaitMs. */
  private firstDirtyAt: number | null = null;

  constructor(private readonly options: AutosaveQueueOptions) {}

  get isDirty(): boolean {
    return this.dirty.size > 0;
  }

  get isSaving(): boolean {
    return this.flushPromise !== null;
  }

  /** Пометить страницу изменённой и перезавести дебаунс. */
  markDirty(pageId: string): void {
    if (this.disposed) return;
    this.dirty.add(pageId);
    // Ошибка не «понижается» до saving новыми правками — пользователь должен
    // видеть красный статус, пока хоть что-то не сохранено.
    this.setStatus(this.status === 'error' ? 'error' : 'saving');
    if (this.firstDirtyAt === null) this.firstDirtyAt = Date.now();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    // Потолок ожидания: непрерывное черкание не должно бесконечно перезаводить
    // дебаунс — flush не позже maxWaitMs от первой грязи (латентность ≤1 с).
    const maxWait = this.options.maxWaitMs;
    if (maxWait && !this.flushPromise && Date.now() - this.firstDirtyAt >= maxWait) {
      this.debounceTimer = null;
      void this.flush();
      return;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.options.delayMs ?? DEFAULT_DELAY_MS);
  }

  /** Снять страницу с учёта (например, после её удаления). */
  forget(pageId: string): void {
    this.dirty.delete(pageId);
    // Ошибка могла относиться к забытой странице: если очередь опустела и
    // ничего не в полёте — статус обязан вернуться к правде (ревью 5.6, р.4).
    if (this.dirty.size === 0 && !this.flushPromise && this.status === 'error') {
      this.setStatus('saved');
    }
  }

  /**
   * Дренит очередь до конца. true — всё сохранено. Параллельный вызов
   * получает тот же promise (single-flight).
   */
  flush(): Promise<boolean> {
    if (this.flushPromise) return this.flushPromise;
    if (this.dirty.size === 0) {
      if (this.status !== 'error') this.setStatus('saved');
      return Promise.resolve(this.status !== 'error');
    }

    const run = (async (): Promise<boolean> => {
      this.setStatus('saving');
      // Окно maxWait закрывается стартом цикла: правки во время полёта откроют
      // новое (их дренит этот же цикл, но таймер следующего burst'а — с нуля).
      this.firstDirtyAt = null;
      try {
        while (this.dirty.size > 0) {
          const ids = Array.from(this.dirty);
          this.dirty = new Set();
          for (let i = 0; i < ids.length; i++) {
            try {
              // Последовательно: параллельный залп на нестабильной сети
              // (RU DPI, rule 95) повышает шанс частичной потери.
              await this.options.savePage(ids[i]);
            } catch (err) {
              // Всё несохранённое — обратно в очередь, включая упавшую страницу.
              for (let j = i; j < ids.length; j++) this.dirty.add(ids[j]);
              throw err;
            }
          }
        }
        this.setStatus('saved');
        return true;
      } catch {
        this.setStatus('error');
        if (!this.disposed) {
          if (this.retryTimer) clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.flush();
          }, this.options.retryMs ?? DEFAULT_RETRY_MS);
        }
        return false;
      } finally {
        this.flushPromise = null;
      }
    })();

    this.flushPromise = run;
    return run;
  }

  /** Останавливает таймеры. Уже начатый сетевой цикл добежит сам (best-effort). */
  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.debounceTimer = null;
    this.retryTimer = null;
  }

  private setStatus(status: AutosaveStatus): void {
    if (this.disposed || this.status === status) return;
    this.status = status;
    this.options.onStatus(status);
  }
}
