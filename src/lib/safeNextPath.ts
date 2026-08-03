/**
 * Валидация параметра `?next=` — единая точка для всех auth-поверхностей.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ ИНЛАЙН-ПРОВЕРКА (внешнее ревью 2026-08-02, P0).
 * Прежний гард `startsWith('/') && !startsWith('//')` был скопирован в трёх
 * местах и во всех трёх пропускал open redirect:
 *
 *   /login?next=/%5Cevil.example
 *     → URLSearchParams декодирует в `/\evil.example`
 *     → гард доволен (начинается с «/», не с «//»)
 *     → браузер нормализует обратный слеш в прямой ⇒ `//evil.example`,
 *       то есть protocol-relative ссылка на ЧУЖОЙ хост
 *     → window.location.replace() уводит на https://evil.example/
 *
 * Поэтому проверяем не префиксом строки, а РАЗБОРОМ URL — единственное
 * надёжное правило «origin совпал с нашим». Плюс явно режем обратный слеш и
 * управляющие символы: их браузеры при разборе URL нормализуют или молча
 * выбрасывают, и строка после этого значит не то, что мы проверяли.
 *
 * Возвращаем ПЕРЕСОБРАННЫЙ путь (`pathname + search + hash`), а не исходную
 * строку: наружу не может уехать ничего, что не пережило разбор.
 */

/** Фолбэк-origin для сред без `window` (unit-тесты). Наружу не попадает. */
const FALLBACK_ORIGIN = 'https://sokratai.ru';

function currentOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return FALLBACK_ORIGIN;
}

/** Обратный слеш и управляющие символы (включая табы/переводы строк). */
function hasUnsafeChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return value.includes('\\');
}

/**
 * @returns безопасный внутренний путь (`/…`) либо `null`, если значение
 *          отсутствует, повреждено или ведёт на чужой origin.
 */
export function resolveSafeNextPath(
  raw: string | null | undefined,
  origin: string = currentOrigin(),
): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (hasUnsafeChars(value)) return null;

  // Только абсолютные внутренние пути: относительные («foo», «../foo») зависят
  // от текущей страницы и в редиректах после логина смысла не имеют.
  if (!value.startsWith('/')) return null;
  // Protocol-relative — чужой хост.
  if (value.startsWith('//')) return null;

  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Ссылка на другую auth-страницу с сохранением точки возврата.
 * `next` переносим только если он прошёл валидацию — иначе ведём «чисто».
 */
export function withSafeNext(basePath: string, next: string | null | undefined): string {
  const safe = resolveSafeNextPath(next);
  return safe ? `${basePath}?next=${encodeURIComponent(safe)}` : basePath;
}
