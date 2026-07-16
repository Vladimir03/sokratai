/**
 * Промо-носитель QR-канала Егора (P0, фронт — фича egor-qr-onboarding).
 *
 * Захватывает `?ref`/`?promo`/`?utm_*` из URL в localStorage при заходе на
 * `/egor` и на страницы регистрации, чтобы обещанная скидка (`BLINOV_20`) не
 * потерялась по дороге до кабинета (сегодня `RegisterTutor` эти параметры
 * выбрасывает). Идемпотентно: непустое значение НЕ перезатирается (первый
 * источник побеждает) — повторный заход с пустыми параметрами ничего не стирает.
 *
 * ВАЖНО: это ВРЕМЕННЫЙ носитель для тихого бейджа онбординга. Source of truth
 * для реальной скидки — сервер (`profiles.promo_code` из signUp-метаданных +
 * ветка в `yookassa-create-payment`). Клиентскому localStorage цену не доверяем
 * (anti-tamper).
 *
 * Значения санитайзятся при захвате И при чтении (cap 64 + безопасный charset
 * `[A-Za-z0-9_-]`, P2 #9): защищает от раздувания метаданных signUp (серверный
 * лимит 64 иначе отверг бы auth-запрос) и от инъекций произвольного текста.
 */

const PROMO_KEY = "sokrat-promo";
const REF_KEY = "sokrat-ref";
const UTM_KEY = "sokrat-utm";
/** Реферальный код КОЛЛЕГИ (`?rc=`, Stage 3 рефералки) — `?ref=` занят каналом. */
const RC_KEY = "sokrat-rc";

const MAX_TOKEN_LEN = 64;
const MAX_UTM_VALUE_LEN = 128;

// Действующий скидочный промокод + claim-дедлайн. ЗЕРКАЛО серверного
// `_shared/promo-intent.ts::PROMO_CLAIM_DEADLINES` — при смене править ОБА.
// Бейдж «−20% закреплено» показываем только для реально скидочного кода в окне
// акции, иначе он обещает то, чего сервер не даст (P0 #2).
const BLINOV_20_CODE = "BLINOV_20";
const BLINOV_20_CLAIM_DEADLINE_MS = Date.parse("2026-12-31T23:59:59Z");

export interface StoredPromo {
  /** Промокод (`BLINOV_20`), если захвачен. */
  promo: string | null;
  /** Источник (`egor`), если захвачен. */
  ref: string | null;
  /** Реферальный код коллеги-репетитора (`?rc=`), если захвачен. */
  rc: string | null;
  /** Собранные `utm_*` параметры, если были. */
  utm: Record<string, string> | null;
}

/** Санитайз токена атрибуции: cap 64 + безопасный charset. Иначе → null. */
function sanitizeToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_TOKEN_LEN);
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : null;
}

function readToken(params: URLSearchParams, name: string): string | null {
  return sanitizeToken(params.get(name));
}

/** Пишет значение, только если ключ ещё пуст (первый источник побеждает). */
function setIfEmpty(key: string, value: string | null): void {
  if (!value) return;
  try {
    const existing = localStorage.getItem(key)?.trim();
    if (existing) return; // не перезатираем непустое
    localStorage.setItem(key, value);
  } catch {
    // localStorage может быть недоступен (Safari private mode) — молча пропускаем
  }
}

/**
 * Захват `?ref`/`?promo`/`?utm_*` из URL в localStorage (идемпотентно + санитайз).
 * Вызывать на mount в `/egor` и на страницах регистрации.
 */
export function capturePromoFromUrl(params: URLSearchParams): void {
  setIfEmpty(PROMO_KEY, readToken(params, "promo"));
  setIfEmpty(REF_KEY, readToken(params, "ref"));
  setIfEmpty(RC_KEY, readToken(params, "rc"));

  // Все utm_* собираем в один JSON-объект (значения обрезаем по длине).
  const utm: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    const trimmed = typeof value === "string" ? value.trim().slice(0, MAX_UTM_VALUE_LEN) : "";
    if (key.startsWith("utm_") && trimmed) utm[key] = trimmed;
  }
  if (Object.keys(utm).length > 0) {
    try {
      const existing = localStorage.getItem(UTM_KEY)?.trim();
      if (!existing) localStorage.setItem(UTM_KEY, JSON.stringify(utm));
    } catch {
      // ignore
    }
  }
}

/** Только plain-object со строковыми значениями (P2 #9 — не массив/не мусор). */
function parseUtm(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v.slice(0, MAX_UTM_VALUE_LEN);
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Возвращает сохранённое промо/ref/utm (null-поля, если ничего не захвачено). */
export function getStoredPromo(): StoredPromo {
  let promo: string | null = null;
  let ref: string | null = null;
  let rc: string | null = null;
  let utm: Record<string, string> | null = null;
  try {
    // Re-санитайз на чтении: localStorage мог быть подправлен вручную.
    promo = sanitizeToken(localStorage.getItem(PROMO_KEY));
    ref = sanitizeToken(localStorage.getItem(REF_KEY));
    rc = sanitizeToken(localStorage.getItem(RC_KEY));
    utm = parseUtm(localStorage.getItem(UTM_KEY));
  } catch {
    // localStorage недоступен — отдаём то, что распарсили
  }
  return { promo, ref, rc, utm };
}

/**
 * true, если у пользователя закреплён ДЕЙСТВУЮЩИЙ скидочный промокод (для бейджа
 * «−20% закреплено»): точный `BLINOV_20` И акция ещё открыта на закрепление.
 * Иначе бейдж обещал бы скидку, которую сервер не даст (P0 #2).
 */
export function hasActiveDiscountPromo(): boolean {
  const { promo } = getStoredPromo();
  if (!promo || promo.toUpperCase() !== BLINOV_20_CODE) return false;
  return (
    Number.isFinite(BLINOV_20_CLAIM_DEADLINE_MS) &&
    Date.now() <= BLINOV_20_CLAIM_DEADLINE_MS
  );
}
