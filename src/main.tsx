import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./registerServiceWorker";

// Регистрируем Service Worker для offline работы
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
