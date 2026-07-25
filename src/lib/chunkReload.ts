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
 *    (`markChunkReloadResolved` из main.tsx — `delayMs` БЕЗ новых chunk-ошибок;
 *    таймер пере-взводится, если ошибка пришла внутри окна), а не окном-
 *    рейтлимитом (P1: окно лишь ограничивало частоту, петля жила).
 *    Нет localStorage → авто-reload НЕ делаем (показываем UI), чтобы не зациклить.
 *  • Плюс durable circuit breaker (`RELOAD_LOG`): ≤`CIRCUIT_MAX` авто-reload за
 *    `CIRCUIT_WINDOW_MS`. Гарантия от петли не должна зависеть от того, верно ли
 *    мы определили границу «эпизода» — роут, падающий чуть позже окна тишины,
 *    иначе крутил бы reload по кругу.
 *  • `preventDefault` — ТОЛЬКО если reload реально запущен (P1: иначе Vite
 *    резолвит `undefined` и глушит диагностику/ErrorBoundary).
 *  • Cache Storage НЕ чистим (P2): SW уже network-first для HTML, nginx отдаёт
 *    index.html `no-store` → reload и так берёт свежий shell; чистка убила бы
 *    валидные content-addressed чанки и offline-копию.
 *  • Только `Date.now`/`setTimeout`/`localStorage` — Safari 15 (rule 80).
 *
 * Корневая причина закрыта на стороне деплоя (2026-07-25, `scripts/deploy/deploy.sh`:
 * append-only пул ассетов + retention 30 дней), поэтому этот модуль — ВТОРОЙ рубеж
 * для остаточных DPI-обрывов, а не единственная защита. Он по-прежнему не спасает
 * загрузку СОБСТВЕННОГО entry-чанка: его код ещё не исполнился.
 */

const RELOAD_FLAG = "sokrat-chunk-reload-pending";
const RELOAD_LOG = "sokrat-chunk-reload-log";
const CIRCUIT_WINDOW_MS = 10 * 60 * 1000;
const CIRCUIT_MAX = 3;
const CIRCUIT_LOG_MAX = 8;

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

/** Время последней chunk-ошибки в ЭТОЙ жизни страницы (0 = не было). */
let lastChunkErrorAt = 0;
let resolveTimer: number | null = null;

/**
 * Зафиксировать факт chunk-ошибки. Зовут ВСЕ точки входа (ErrorBoundary,
 * unhandledrejection), иначе окно тишины в `markChunkReloadResolved` посчитает
 * сбойную страницу стабильной и снимет анти-петлевой флаг.
 */
export function noteChunkError(): void {
  lastChunkErrorAt = Date.now();
}

/** Разобрать журнал авто-reload'ов, отбросив всё старше окна. */
function readRecentReloads(store: Storage): number[] {
  const raw = store.getItem(RELOAD_LOG);
  if (!raw) return [];
  const cutoff = Date.now() - CIRCUIT_WINDOW_MS;
  return raw
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > cutoff);
}

/**
 * Можно ли авто-перезагрузиться — БЕЗ side-effect'ов. Нужен вызывающим, чтобы
 * выбрать формулировку репорта/UI до того, как страница уедет в reload.
 */
export function canReloadForChunkError(): boolean {
  if (typeof window === "undefined") return false;
  const store = safeLocalStorage();
  if (!store) return false; // без persisted-хранилища авто-reload = риск петли
  try {
    if (store.getItem(RELOAD_FLAG)) return false; // уже пробовали в этом эпизоде
    return readRecentReloads(store).length < CIRCUIT_MAX;
  } catch {
    return false;
  }
}

/**
 * Перезагрузить страницу ОДИН раз за эпизод для получения свежего index.html +
 * хэшей чанков. Возвращает true, если reload реально запускается; false — если
 * запрещён (уже пробовали в этом эпизоде / выбит circuit breaker / нет
 * localStorage) → вызывающий должен показать UI, а НЕ preventDefault'ить.
 */
export function reloadForChunkError(): boolean {
  if (typeof window === "undefined") return false;
  const store = safeLocalStorage();
  if (!store) return false;
  try {
    if (store.getItem(RELOAD_FLAG)) {
      // Уже перезагружались в этом эпизоде и снова упало → reload не помог.
      return false;
    }
    const recent = readRecentReloads(store);
    if (recent.length >= CIRCUIT_MAX) {
      // Слишком часто за окно — дальше reload'ы только крутят петлю.
      return false;
    }
    const now = Date.now();
    store.setItem(RELOAD_FLAG, String(now));
    store.setItem(
      RELOAD_LOG,
      [...recent, now].slice(-CIRCUIT_LOG_MAX).join(","),
    );
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
 * приложение проработало `delayMs` БЕЗ новой chunk-ошибки: если ошибка пришла
 * внутри окна, таймер пере-взводится на остаток. Тогда следующий эпизод (новый
 * деплой) снова сможет перезагрузиться ровно один раз.
 */
export function markChunkReloadResolved(delayMs = 5000): void {
  if (typeof window === "undefined") return;

  const clearIfQuiet = () => {
    resolveTimer = null;
    if (lastChunkErrorAt !== 0) {
      const quietFor = Date.now() - lastChunkErrorAt;
      if (quietFor < delayMs) {
        // Ошибка была недавно — страница НЕ стабильна, ждём остаток окна.
        resolveTimer = window.setTimeout(clearIfQuiet, delayMs - quietFor);
        return;
      }
    }
    try {
      window.localStorage.removeItem(RELOAD_FLAG);
    } catch {
      /* noop */
    }
  };

  if (resolveTimer !== null) window.clearTimeout(resolveTimer);
  resolveTimer = window.setTimeout(clearIfQuiet, delayMs);
}

/**
 * Тонкий safety-net на uncaught `import()` вне React (prefetch'и уже с `.catch`,
 * реальная навигация — через ErrorBoundary). Вызывать один раз в main.tsx.
 *
 * `onChunkError` прокидывается КОЛБЭКОМ, а не импортом репортера: модуль
 * последнего рубежа не должен тянуть граф зависимостей supabase.
 */
export function installChunkReloadGuards(
  onChunkError?: (message: string) => void,
): void {
  if (typeof window === "undefined") return;
  window.addEventListener("unhandledrejection", (event) => {
    if (!isChunkLoadError(event.reason)) return;
    noteChunkError();
    const willReload = canReloadForChunkError();
    if (onChunkError) {
      const raw =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason ?? "chunk load error");
      // Репорт ДО reload: иначе вылеченные chunk-фейлы структурно невидимы.
      onChunkError(willReload ? raw : `[recovery-failed] ${raw}`);
    }
    // preventDefault ТОЛЬКО если reload реально запущен (иначе даём ошибке
    // всплыть — пусть покажется recovery-UI/оверлей, а не тихо потеряется).
    if (reloadForChunkError()) event.preventDefault();
  });
}
