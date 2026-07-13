/**
 * Флаг «репетитор увидел демо-разбор» (первое «вау», v2.1 W1 / фича
 * egor-qr-onboarding). Гейтит community-CTA (`CommunityJoinCard`): зовём в
 * сообщество ПОСЛЕ ценности, не до (UX doc 16 / rule 90).
 *
 * Per-browser localStorage. В ТОЙ ЖЕ вкладке `storage`-событие не стреляет
 * (только между вкладками), поэтому шлём свой `window` event —
 * `CommunityJoinCard` перерисовывается сразу после открытия демо, без reload.
 */

const DEMO_SEEN_KEY = "sokrat-demo-seen";
const DEMO_SEEN_EVENT = "sokrat-demo-seen";

/** Ставит флаг «демо просмотрено/прогнано» + уведомляет слушателей в этой вкладке. */
export function markDemoSeen(): void {
  try {
    if (localStorage.getItem(DEMO_SEEN_KEY) === "1") return; // уже стоит — тихо выходим
    localStorage.setItem(DEMO_SEEN_KEY, "1");
  } catch {
    // localStorage недоступен (Safari private) — всё равно уведомим текущую сессию
  }
  try {
    window.dispatchEvent(new Event(DEMO_SEEN_EVENT));
  } catch {
    // ignore
  }
}

export function hasDemoSeen(): boolean {
  try {
    return localStorage.getItem(DEMO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Подписка на «демо просмотрено»: same-tab custom event + cross-tab `storage`.
 * Возвращает функцию отписки.
 */
export function subscribeDemoSeen(callback: () => void): () => void {
  const onCustom = () => callback();
  const onStorage = (e: StorageEvent) => {
    if (e.key === DEMO_SEEN_KEY) callback();
  };
  window.addEventListener(DEMO_SEEN_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(DEMO_SEEN_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
