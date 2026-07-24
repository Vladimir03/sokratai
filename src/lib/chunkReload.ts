/**
 * Авто-восстановление при «Failed to fetch dynamically imported module».
 *
 * Причина крашей у учеников (репорт Ульяны/Софьи, 2026-07-20): lazy-чанк
 * (`React.lazy` → `import()`) не догружается — либо в кэше старый index.html
 * ссылается на хэш, которого уже нет после деплоя, либо РФ-DPI роняет запрос.
 *
 * Дизайн (после ревью ChatGPT-5.6 — НЕ упрощать обратно):
 *  • `vite:preloadError` глобально НЕ перехватываем: он фаерится и на
 *    спекулятивных prefetch (SideNav hover, у которых уже есть `.catch`) →
 *    авто-reload по нему стирал бы несохранённые данные при простом наведении
 *    курсора (P1). Реальную навигацию с битым чанком ловит `<ErrorBoundary>`
 *    (App.tsx оборачивает все роуты) — это чистый render-time сигнал «юзер
 *    заблокирован». Uncaught `import()` вне React — через `unhandledrejection`.
 *  • «Ровно один reload на эпизод» через **persisted-marker в localStorage**,
 *    снимаемый ТОЛЬКО после подтверждённой стабильной загрузки
 *    (`markChunkReloadResolved` из main.tsx через 5с без новых chunk-ошибок),
 *    а не окном-рейтлимитом (P1: окно лишь ограничивало частоту, петля жила).
 *    Нет localStorage → авто-reload НЕ делаем (показываем UI), чтобы не зациклить.
 *  • `preventDefault` — ТОЛЬКО если reload реально запущен (P1: иначе Vite
 *    резолвит `undefined` и глушит диагностику/ErrorBoundary).
 *  • Cache Storage НЕ чистим (P2): SW уже network-first для HTML, nginx отдаёт
 *    index.html `no-store` → reload и так берёт свежий shell; чистка убила бы
 *    валидные content-addressed чанки и offline-копию.
 *
 * Известное ограничение (нужен атомарный деплой / хранение старых assets):
 * гард не спасает загрузку СОБСТВЕННОГО entry-чанка — его код ещё не исполнился.
 */

const RELOAD_FLAG = "sokrat-chunk-reload-pending";

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

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // приватный режим / storage отключён
  }
}

/**
 * Перезагрузить страницу ОДИН раз за эпизод для получения свежего index.html +
 * хэшей чанков. Возвращает true, если reload реально запускается; false — если
 * запрещён (уже пробовали в этом эпизоде / нет localStorage) → вызывающий
 * должен показать UI, а НЕ preventDefault'ить.
 */
export function reloadForChunkError(): boolean {
  if (typeof window === "undefined") return false;
  const store = safeLocalStorage();
  if (!store) return false; // без persisted-хранилища авто-reload = риск петли
  try {
    if (store.getItem(RELOAD_FLAG)) {
      // Уже перезагружались в этом эпизоде и снова упало → reload не помог.
      return false;
    }
    store.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    return false;
  }
  try {
    window.location.reload();
  } catch {
    return false;
  }
  return true;
}

/**
 * Снять reload-marker после ПОДТВЕРЖДЁННОЙ стабильной загрузки (вызвать из
 * main.tsx после render). Флаг живёт через reload и снимается только если
 * приложение проработало `delayMs` без новой chunk-ошибки — тогда следующий
 * эпизод (новый деплой) снова сможет перезагрузиться ровно один раз.
 */
export function markChunkReloadResolved(delayMs = 5000): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    try {
      window.localStorage.removeItem(RELOAD_FLAG);
    } catch {
      /* noop */
    }
  }, delayMs);
}

/**
 * Тонкий safety-net на uncaught `import()` вне React (prefetch'и уже с `.catch`,
 * реальная навигация — через ErrorBoundary). Вызывать один раз в main.tsx.
 */
export function installChunkReloadGuards(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("unhandledrejection", (event) => {
    if (!isChunkLoadError(event.reason)) return;
    // preventDefault ТОЛЬКО если reload реально запущен (иначе даём ошибке
    // всплыть — пусть покажется recovery-UI/оверлей, а не тихо потеряется).
    if (reloadForChunkError()) event.preventDefault();
  });
}
