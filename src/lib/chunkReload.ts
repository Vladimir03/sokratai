/**
 * Авто-восстановление при «Failed to fetch dynamically imported module».
 *
 * Причина крашей у учеников (репорт Ульяны/Софьи, 2026-07-20): lazy-чанк
 * (`React.lazy` → `import()`) не догружается — либо в кэше браузера/SW лежит
 * СТАРЫЙ index.html, ссылающийся на хэш чанка, которого уже нет на сервере
 * после деплоя, либо РФ-DPI роняет запрос. `import()` реджектится:
 *   • preload-фейл летит window-событием `vite:preloadError` ДО рендера lazy —
 *     React ErrorBoundary его НЕ видит, ловит глобальный оверлей платформы
 *     («произошла неустранимая ошибка»);
 *   • либо reject уходит в `unhandledrejection`.
 * Единственно надёжное лечение стейл-чанка — перезагрузить страницу, чтобы
 * получить свежий index.html + новые хэши. Делаем это АВТОМАТИЧЕСКИ (ученику
 * ничего нажимать не надо), но РОВНО ОДИН раз в короткое окно — иначе
 * по-настоящему битый чанк зациклил бы reload.
 *
 * Инвариант rule 95: SW уже отдаёт index.html network-first и хэш-чанки
 * cache-first + `Response.error()` (не undefined). Это устраняет octet-stream,
 * но НЕ реджект `import()` при реально отсутствующем чанке — его закрывает
 * этот модуль на уровне приложения.
 */

const RELOAD_TS_KEY = "sokrat-chunk-reload-ts";
// Окно защиты от петли: если уже перезагружались < 15с назад и снова упало —
// значит чанк битый по-настоящему (не стейл), reload не поможет → показываем UI.
const RELOAD_GUARD_MS = 15_000;

const CHUNK_ERROR_SIGNATURES = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "failed to load module script",
  "dynamically imported module",
  "chunkloaderror",
];

/** Похоже ли на сбой загрузки lazy-чанка (стейл после деплоя / DPI-обрыв). */
export function isChunkLoadError(err: unknown): boolean {
  const raw =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === "string"
        ? err
        : err && typeof err === "object" && "message" in err
          ? String((err as { message?: unknown }).message ?? "")
          : "";
  const msg = raw.toLowerCase();
  if (!msg) return false;
  if (CHUNK_ERROR_SIGNATURES.some((s) => msg.includes(s))) return true;
  return /loading (?:css )?chunk\s+[\w-]+\s+failed/.test(msg);
}

/**
 * Перезагрузить страницу ОДИН раз для получения свежего index.html + чанков.
 * Чистит Cache Storage (иначе SW/браузер переотдаст стейл-shell), затем reload.
 * Возвращает true, если reload запускается; false — если сработала защита от
 * петли (уже перезагружались только что) → вызывающий должен показать UI.
 */
export function reloadForChunkError(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_TS_KEY) || "0");
    if (Date.now() - last < RELOAD_GUARD_MS) return false; // защита от петли
    window.sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()));
  } catch {
    // sessionStorage недоступен (приватный режим и т.п.) — всё равно один reload
    // лучше, чем краш; риск петли принимаем (редкий кейс).
  }
  try {
    if ("caches" in window) {
      window.caches
        .keys()
        .then((names) => Promise.all(names.map((n) => window.caches.delete(n))))
        .catch(() => {})
        .finally(() => window.location.reload());
    } else {
      window.location.reload();
    }
  } catch {
    try {
      window.location.reload();
    } catch {
      /* noop */
    }
  }
  return true;
}

/**
 * Ставит глобальные обработчики (вызывать один раз в main.tsx ДО рендера):
 *  • `vite:preloadError` — официальный хук Vite на сбой modulepreload lazy-чанка;
 *  • `unhandledrejection` — reject `import()`, ушедший мимо React;
 *  • `error` (capture) — некоторые браузеры отдают сбой module-script так.
 * Для chunk-ошибок гасит дефолт (`preventDefault`) — чтобы платформенный оверлей
 * «неустранимая ошибка» не показался — и авто-перезагружает.
 */
export function installChunkReloadGuards(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault(); // не даём Vite пере-бросить ошибку в оверлей
    reloadForChunkError();
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) {
      event.preventDefault();
      reloadForChunkError();
    }
  });

  window.addEventListener(
    "error",
    (event) => {
      if (isChunkLoadError(event.message) || isChunkLoadError((event as ErrorEvent).error)) {
        reloadForChunkError();
      }
    },
    true,
  );
}
