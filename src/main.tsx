import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./registerServiceWorker";
import { listenForSubscriptionChanges } from "./lib/pushApi";

// Регистрируем Service Worker для offline работы
registerServiceWorker();

// Listen for push subscription renewal messages from the service worker
listenForSubscriptionChanges();

createRoot(document.getElementById("root")!).render(<App />);
