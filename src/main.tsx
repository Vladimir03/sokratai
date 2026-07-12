import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./registerServiceWorker";
import { listenForSubscriptionChanges } from "./lib/pushApi";
import { initPwaInstallCapture } from "./lib/pwaInstall";

// Регистрируем Service Worker для offline работы
registerServiceWorker();

// Listen for push subscription renewal messages from the service worker
listenForSubscriptionChanges();

// Захват beforeinstallprompt ДО рендера — событие фаерится раньше маунта React
initPwaInstallCapture();

createRoot(document.getElementById("root")!).render(<App />);
