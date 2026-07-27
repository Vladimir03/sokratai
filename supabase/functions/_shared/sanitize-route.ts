/**
 * Санитизация маршрута для PII-free телеметрии — ЕДИНЫЙ источник правды.
 *
 * ЗАЧЕМ ОБЩИЙ МОДУЛЬ: маски применяют минимум две функции (`client-error-report`,
 * `web-vitals-report`), и расхождение между ними тихо ломает ровно то, ради чего
 * они существуют. Разъехавшиеся маски = либо утёкший bearer-токен в одной
 * поверхности, либо два разных написания одного маршрута в /admin, из-за чего
 * p75 считается по половине выборки. Это тот же класс, что ≥9 копий словаря
 * предметов (AGENTS.md) — новый писатель телеметрии импортирует ЭТОТ модуль,
 * а не копирует регэкспы.
 *
 * Инварианты:
 *  • query и hash отбрасываются ВСЕГДА (там живут signed-URL токены);
 *  • bearer-маршруты маскируются ЦЕЛИКОМ по префиксу — короткие 8-символьные
 *    slug'и `/invite/:code` и `/p/:slug` НЕ ловятся эвристикой по длине
 *    (ревью ChatGPT-5.6 2026-07-15 P1);
 *  • всё, что не распознано, всё равно проходит генерик-маскировку сегментов.
 */

export const ROUTE_MAX = 200;

/**
 * Маршруты, где сам сегмент ЯВЛЯЕТСЯ секретом (ссылка = доступ). Маскируются
 * целиком по префиксу, до генерик-правил. Добавляешь публичную ссылку-доступ →
 * добавляй сюда, иначе токен уедет в телеметрию.
 */
const ROUTE_MASKS: Array<[RegExp, string]> = [
  [/^\/c\/.+/i, "/c/:token"],
  [/^\/invite\/.+/i, "/invite/:code"],
  [/^\/p\/mock-result\/.+/i, "/p/mock-result/:slug"],
  [/^\/p\/.+/i, "/p/:slug"],
];

/** pathname без query/hash + маскировка динамических сегментов. */
export function sanitizeRoute(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  const pathname = raw.split("?")[0].split("#")[0];
  for (const [re, masked] of ROUTE_MASKS) {
    if (re.test(pathname)) return masked;
  }
  const masked = pathname
    .split("/")
    .map((seg) =>
      /^[0-9a-f-]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{16,}$/.test(seg) || /^\d+$/.test(seg)
        ? ":id"
        : seg,
    )
    .join("/");
  return masked.slice(0, ROUTE_MAX);
}
