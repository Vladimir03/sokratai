/**
 * Глобальная телеметрия uncaught-ошибок → `client-error-report` → /admin.
 *
 * ЗАЧЕМ: писателей было ровно два — `ErrorBoundary` и `MarkdownErrorBoundary`,
 * то есть в `/admin` попадали ТОЛЬКО краши React-рендера. `window.onerror` не
 * существовал, а единственный `unhandledrejection` (`chunkReload.ts`) ничего не
 * репортил. Всё асинхронное вне рендера — отклонённые промисы в хендлерах,
 * упавшие мутации, сбои fetch — было невидимо. Мы узнавали о проблемах из
 * скриншотов в Telegram.
 *
 * Границы ответственности:
 *  • chunk-ошибками владеет `chunkReload` / `ErrorBoundary` — здесь мы их
 *    ПРОПУСКАЕМ (иначе двойные записи). Связи по порядку слушателей нет:
 *    проверка чисто по сигнатуре ошибки, а не по `defaultPrevented`.
 *  • Ошибки ресурсов (битые <img>) НЕ слушаем намеренно: на плохом канале
 *    аватарки затопят эндпоинт и выжгут серверный кап 120/60с, спрятав
 *    настоящие краши.
 *  • Сетевой класс идёт отдельным kind `net` с жёстким лимитом на сессию: один
 *    плохой канал не должен съесть весь бюджет репортов.
 */
import { isChunkLoadError } from "@/lib/chunkReload";
import { reportClientError } from "@/lib/clientErrorReport";
import { isNetworkError, toErrorMessage } from "@/lib/queryResilience";

/** Сетевые сбои под DPI массовы — репортим как сигнал, а не как поток. */
const NET_REPORT_INTERVAL_MS = 10 * 60 * 1000;
let lastNetReportAt = 0;
let installed = false;

function reportNetworkClass(message: string): void {
  const now = Date.now();
  if (now - lastNetReportAt < NET_REPORT_INTERVAL_MS) return;
  lastNetReportAt = now;
  reportClientError(message, "net");
}

/**
 * Отчёт о сбое запроса. Вызывается из `QueryCache.onError`.
 * `hasData=false` означает, что у пользователя РЕАЛЬНО пусто — фоновый рефетч
 * поверх отрисованных данных не инцидент (rule 95: degraded ≠ critical).
 */
export function reportQueryError(error: unknown, queryKey: readonly unknown[]): void {
  const key = queryKey
    .map((p) => (typeof p === "string" || typeof p === "number" ? String(p) : "?"))
    .join(":");
  const message = `[${key}] ${toErrorMessage(error)}`;
  if (isNetworkError(error)) {
    reportNetworkClass(message);
    return;
  }
  reportClientError(message, "query");
}

/** Отчёт о сбое мутации. Вызывается из `MutationCache.onError`. */
export function reportMutationError(
  error: unknown,
  mutationKey?: readonly unknown[],
): void {
  const key = mutationKey
    ? mutationKey
        .map((p) => (typeof p === "string" || typeof p === "number" ? String(p) : "?"))
        .join(":")
    : "unkeyed";
  const message = `[${key}] ${toErrorMessage(error)}`;
  if (isNetworkError(error)) {
    reportNetworkClass(message);
    return;
  }
  reportClientError(message, "mutation");
}

export function installGlobalErrorReporter(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  // addEventListener, а НЕ присваивание window.onerror — присваивание затирает
  // чужие обработчики (в т.ч. платформенные).
  window.addEventListener("error", (event) => {
    try {
      // Ошибки загрузки ресурсов (img/script/link) не имеют `error` и всплывают
      // только в capture-фазе — сюда не доходят, и это намеренно.
      const err = event.error;
      if (!err && !event.message) return;
      if (isChunkLoadError(err ?? event.message)) return; // владеет chunkReload
      const message = err ? toErrorMessage(err) : String(event.message);
      if (!message) return;
      if (isNetworkError(message)) {
        reportNetworkClass(message);
        return;
      }
      reportClientError(message, "window");
    } catch {
      /* телеметрия никогда не ломает приложение */
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason;
      if (isChunkLoadError(reason)) return; // владеет chunkReload
      const message = toErrorMessage(reason);
      if (!message || message === "undefined") return;
      if (isNetworkError(message)) {
        reportNetworkClass(message);
        return;
      }
      reportClientError(message, "promise");
    } catch {
      /* noop */
    }
  });
}
