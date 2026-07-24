import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./registerServiceWorker";
import { ensurePushSubscriptionSaved, listenForSubscriptionChanges } from "./lib/pushApi";
import { initPwaInstallCapture } from "./lib/pwaInstall";
import { installChunkReloadGuards, markChunkReloadResolved } from "./lib/chunkReload";

// Авто-восстановление при «Failed to fetch dynamically imported module» — ДО
// всего остального: стейл-чанк после деплоя / DPI-обрыв → тихая перезагрузка,
// а не краш-оверлей «неустранимая ошибка» (репорт Ульяны/Софьи, rule 95).
installChunkReloadGuards();

// Регистрируем Service Worker для offline работы
registerServiceWorker();

// Listen for push subscription renewal messages from the service worker
listenForSubscriptionChanges();

// Self-heal: браузерная push-подписка есть, а на бэкенде потерялась (сбой
// сохранения в прошлом) → тихо досохраняем (идемпотентный upsert)
void ensurePushSubscriptionSaved();

// Захват beforeinstallprompt ДО рендера — событие фаерится раньше маунта React
initPwaInstallCapture();

createRoot(document.getElementById("root")!).render(<App />);

// Приложение стартовало — снимаем reload-marker, если 5с проработали без новой
// chunk-ошибки (подтверждённая стабильная загрузка). Пока флаг стоит, повторная
// chunk-ошибка НЕ перезагружает (показывается UI) — защита от петли.
markChunkReloadResolved();
