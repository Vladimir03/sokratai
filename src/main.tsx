// ПЕРВЫМ импортом: side-effect модуль патчит прототипы для Safari/iOS 15.0–15.3
// (Array.at / Object.hasOwn — их тянут jspdf и svg2pdf.js). Порядок важен:
// зависимости вычисляются в порядке импортов, поэтому патч должен стоять выше App.
import "./lib/compat/legacySafari";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./registerServiceWorker";
import { ensurePushSubscriptionSaved, listenForSubscriptionChanges } from "./lib/pushApi";
import { initPwaInstallCapture } from "./lib/pwaInstall";
import { installChunkReloadGuards, markChunkReloadResolved } from "./lib/chunkReload";
import { reportClientError } from "./lib/clientErrorReport";
import { installGlobalErrorReporter } from "./lib/globalErrorReporter";
import { installWebVitals } from "./lib/webVitals";
import { ensurePendingMockInviteClaimed } from "./lib/mockExamPublicApi";

// Авто-восстановление при «Failed to fetch dynamically imported module» — ДО
// всего остального: стейл-чанк после деплоя / DPI-обрыв → тихая перезагрузка,
// а не краш-оверлей «неустранимая ошибка» (репорт Ульяны/Софьи, rule 95).
// Колбэк, а не импорт внутри модуля: последний рубеж не должен тянуть supabase.
installChunkReloadGuards((message) => reportClientError(message, "chunk"));

// Глобальная телеметрия uncaught-ошибок. Ставится ПОСЛЕ chunk-гарда: chunk-
// ошибками владеет он, репортер их пропускает (иначе двойные записи).
installGlobalErrorReporter();

// Полевые Core Web Vitals. ДО рендера: TTFB и FCP наступают раньше маунта
// React, и подписка после него их бы не увидела. Замеры копятся и уходят
// одним батчем, когда страница скрывается.
installWebVitals();

// Регистрируем Service Worker для offline работы
registerServiceWorker();

// Listen for push subscription renewal messages from the service worker
listenForSubscriptionChanges();

// Self-heal: браузерная push-подписка есть, а на бэкенде потерялась (сбой
// сохранения в прошлом) → тихо досохраняем (идемпотентный upsert)
void ensurePushSubscriptionSaved();

// Self-heal: анонимная попытка пробника из публичного приглашения ждёт
// привязки к аккаунту, а возврат после подтверждения email / OAuth прошёл мимо
// экрана `/p/mock-invite/:slug/start`. Идемпотентно и тихо (2026-08-02).
ensurePendingMockInviteClaimed();

// Захват beforeinstallprompt ДО рендера — событие фаерится раньше маунта React
initPwaInstallCapture();

createRoot(document.getElementById("root")!).render(<App />);

// Приложение стартовало — снимаем reload-marker, если 5с проработали без новой
// chunk-ошибки (подтверждённая стабильная загрузка). Пока флаг стоит, повторная
// chunk-ошибка НЕ перезагружает (показывается UI) — защита от петли.
markChunkReloadResolved();
