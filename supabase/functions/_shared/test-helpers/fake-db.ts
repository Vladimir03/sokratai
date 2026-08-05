// Фейковый PostgREST-клиент (стаб supabase-js) для vitest.
//
// Назначение: юнит-тесты Deno-модулей из `_shared/`, которые получают
// `SupabaseClient` ПАРАМЕТРОМ (например, student-progress-build.ts). Клиент
// там импортируется только как `import type` и стирается esbuild'ом, поэтому
// боевой пакет в тестах не нужен — достаточно объекта с той же цепочкой.
//
// Поддержанная цепочка (то, что реально зовут тестируемые модули, плюс
// дешёвые соседи для переиспользования):
//   .from(table).select(cols).eq().in().gte().lte().order().limit()
//   → await билдера (thenable → { data, error })
//   → .maybeSingle() / .single()
//
// Ограничения (осознанные):
// - `select()` НЕ режет колонки — строки фикстуры возвращаются целиком.
//   Anti-leak-инварианты («поле не должно попасть в SELECT») этим фейком
//   не проверяются: их место — ревью и grep, не юнит-тест.
// - `eq`/`in` фильтруют строгим `===`: типы значений в фикстурах должны
//   совпадать с тем, что передаёт код (строки — строками, числа — числами).
// - `gte`/`lte` сравнивают КАК СТРОКИ — корректно для ISO-дат, не для чисел.
// - Таблица без фикстуры читается как ПУСТАЯ (не ошибка): билдер прогресса
//   обходит десяток таблиц, перечислять пустые в каждом тесте — шум.
// - Модификаторов `neq`/`or`/`range`/`is` нет. Понадобятся — добавляйте
//   СЮДА, а не локальной копией в тесте (иначе стаб разъедется по файлам).

export type FakeRow = Record<string, unknown>;

export interface FakeDbError {
  message: string;
  code?: string;
}

/** Фикстура таблицы: либо просто строки, либо явный `{ data, error }`. */
export type FakeTableFixture =
  | FakeRow[]
  | { data: FakeRow[] | null; error: FakeDbError | null };

/** `Record<имя_таблицы, фикстура>` — единственный вход makeFakeDb. */
export type FakeDbFixtures = Record<string, FakeTableFixture>;

interface FakeQueryResult {
  data: unknown;
  error: FakeDbError | null;
}

class FakeQueryBuilder {
  private rows: FakeRow[];
  private error: FakeDbError | null;

  constructor(fixture: FakeTableFixture | undefined) {
    if (fixture == null) {
      this.rows = [];
      this.error = null;
    } else if (Array.isArray(fixture)) {
      this.rows = [...fixture]; // копия: фильтры не должны портить фикстуру
      this.error = null;
    } else {
      this.rows = [...(fixture.data ?? [])];
      this.error = fixture.error ?? null;
    }
  }

  /** Колонки не режем — см. шапку (anti-leak проверяется не здесь). */
  select(_columns?: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((r) => r[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    const allowed = new Set(values);
    this.rows = this.rows.filter((r) => allowed.has(r[column]));
    return this;
  }

  /** Строковое сравнение — задумано для ISO-дат. */
  gte(column: string, value: string): this {
    this.rows = this.rows.filter((r) => r[column] != null && String(r[column]) >= value);
    return this;
  }

  lte(column: string, value: string): this {
    this.rows = this.rows.filter((r) => r[column] != null && String(r[column]) <= value);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    const asc = opts?.ascending !== false;
    this.rows = [...this.rows].sort((a, b) => {
      const av = String(a[column] ?? "");
      const bv = String(b[column] ?? "");
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * (asc ? 1 : -1);
    });
    return this;
  }

  limit(count: number): this {
    this.rows = this.rows.slice(0, count);
    return this;
  }

  maybeSingle(): Promise<FakeQueryResult> {
    if (this.error) return Promise.resolve({ data: null, error: this.error });
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }

  single(): Promise<FakeQueryResult> {
    if (this.error) return Promise.resolve({ data: null, error: this.error });
    if (this.rows.length !== 1) {
      return Promise.resolve({
        data: null,
        error: {
          message: `single(): ожидалась ровно 1 строка, получено ${this.rows.length}`,
          code: "PGRST116",
        },
      });
    }
    return Promise.resolve({ data: this.rows[0], error: null });
  }

  /** Thenable: `await db.from(...).select(...).eq(...)` → `{ data, error }`. */
  then<TResult1 = FakeQueryResult, TResult2 = never>(
    onFulfilled?: ((value: FakeQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result: FakeQueryResult = this.error
      ? { data: null, error: this.error }
      : { data: this.rows, error: null };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  }
}

/**
 * Собрать фейковый клиент. В тестируемую функцию передавать через `as never`:
 * структурная совместимость с полным SupabaseClient не нужна — модули зовут
 * только from()-цепочку, а vitest типы не проверяет.
 */
export function makeFakeDb(fixtures: FakeDbFixtures): { from(table: string): FakeQueryBuilder } {
  return {
    from(table: string): FakeQueryBuilder {
      return new FakeQueryBuilder(fixtures[table]);
    },
  };
}
