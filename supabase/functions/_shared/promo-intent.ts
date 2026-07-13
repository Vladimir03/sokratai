/**
 * Persist QR/referral marketing attribution (promo code + registration source)
 * into `profiles`. Shared by EVERY signup-finalization path (email-verify,
 * assign-tutor-role, oauth-{yandex,vk}-callback) so the write logic never drifts
 * (repo convention: cross-function shared code lives in `_shared/`).
 *
 * Reused columns — NO new migration (spec §5, fast-follow):
 *   - profiles.promo_code          (migration 20251130201642, no default → null = unset)
 *   - profiles.registration_source (migration 20251109155208, DEFAULT 'web')
 *
 * Values come from `promo`/`ref` in signup metadata: set client-side in
 * `signUp({ options: { data: { promo, ref } } })` for the email flows, or
 * threaded through the HMAC-signed OAuth state for Yandex/VK. Callers MUST gate
 * this to NEW TUTOR registrations (isNewUser + intendedRole=tutor / type=signup)
 * — attribution belongs to registration, not to logins or student signups.
 *
 * Atomic first-write-wins via CONDITIONAL UPDATE (WHERE encodes "unset") — no
 * read-then-write race:
 *   - promo_code: written only where currently NULL, and only before the
 *     campaign's claim deadline (PROMO_CLAIM_DEADLINES). After the deadline the
 *     code is not attached (no discount), but registration_source still is.
 *   - registration_source: written where NULL or the default placeholder 'web'
 *     (so the referral 'egor' overwrites the trigger-set default, but a real
 *     prior attribution is never clobbered).
 *
 * Anti-leak: `promo_code` is discount-sensitive — it is NOT returned by any
 * client endpoint (consumed only in the tutor-gated yookassa path behind
 * NOT_A_TUTOR). `registration_source` is benign self-attribution: the app
 * already shows a user THEIR OWN value in /profile, so it is not a tutor-secret
 * leak. The tutor-only gating in the callers keeps 'egor' off student profiles.
 *
 * PII-free: promo/ref VALUES are never logged (only a generic failure marker).
 * Error-safe: supabase-js returns { error } (it does NOT throw) — we check it
 * explicitly; a failure must NEVER block signup/auth finalization.
 */
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logAnalyticsEvent } from "./analytics.ts";

const MAX_ATTRIBUTION_LEN = 64;
const DEFAULT_REGISTRATION_SOURCE = "web";

// Claim-дедлайны кампаний: до какой даты промокод можно ЗАКРЕПИТЬ за НОВЫМ
// аккаунтом. После даты сам код не пишется (скидки не будет), но ref/источник
// сохраняются для аналитики. Уже закреплённые аккаунты кампанию дорабатывают —
// длительность/размер скидки считает потребитель (yookassa-create-payment), не
// здесь. Ключ — UPPERCASE-код. Менять дату — ЗДЕСЬ (single source).
const PROMO_CLAIM_DEADLINES: Record<string, number> = {
  BLINOV_20: Date.parse("2026-12-31T23:59:59Z"), // акция Егора (Иваново 2026-07)
};

/**
 * Санитайз атрибуции: короткий код/кампания. Разрешаем только безопасный набор
 * (буквы/цифры/`_`/`-`) — режет инъекции произвольного текста в
 * registration_source (показывается пользователю в /profile) и мусор. Cap длины
 * ДО серверного лимита, чтобы не раздувать метаданные.
 */
function sanitizeAttribution(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_ATTRIBUTION_LEN);
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : null;
}

/** true, если у промокода есть claim-дедлайн и он уже прошёл. */
function isPromoClaimExpired(promo: string): boolean {
  const deadline = PROMO_CLAIM_DEADLINES[promo.toUpperCase()];
  return deadline !== undefined && Number.isFinite(deadline) && Date.now() > deadline;
}

/** PII-free маркер сбоя записи атрибуции (значения promo/ref НЕ логируем). */
function logAttributionFailure(step: string): void {
  console.warn(
    JSON.stringify({
      event: "promo_attribution_persist_failed",
      step,
      timestamp: new Date().toISOString(),
    }),
  );
}

export async function persistPromoAttribution(
  admin: SupabaseClient,
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<void> {
  const promo = sanitizeAttribution(metadata?.promo);
  const ref = sanitizeAttribution(metadata?.ref);
  if (!promo && !ref) return;

  try {
    // promo_code — атомарный first-write-wins: UPDATE только там, где ещё NULL,
    // и только до claim-дедлайна кампании.
    if (promo && !isPromoClaimExpired(promo)) {
      const { error } = await admin
        .from("profiles")
        .update({ promo_code: promo })
        .eq("id", userId)
        .is("promo_code", null);
      if (error) logAttributionFailure("promo_code");
    }

    // registration_source — пишем поверх NULL или дефолтного 'web' (условие в
    // WHERE = атомарно, без гонки read→update). Реальный прежний источник цел.
    if (ref) {
      const { error } = await admin
        .from("profiles")
        .update({ registration_source: ref })
        .eq("id", userId)
        .or(
          `registration_source.is.null,registration_source.eq.${DEFAULT_REGISTRATION_SOURCE}`,
        );
      if (error) logAttributionFailure("registration_source");
    }
  } catch (_e) {
    // Thrown (network) failure — тоже best-effort: НЕ блокируем регистрацию/auth.
    logAttributionFailure("threw");
  }
}

/**
 * persistPromoAttribution + серверная воронка QR-канала (P2, item 6). Вызывают
 * все tutor-registration финализаторы (email-verify type=signup / assign-tutor-
 * role / oauth callbacks isNewUser+tutor) — атрибуция + события в одном месте.
 * События PII-free (id + категории ref/флаги), join к profiles/tutor_students по
 * actor_user_id. Fire-and-forget (logAnalyticsEvent не бросает).
 */
export async function persistPromoAttributionAndTrack(
  admin: SupabaseClient,
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<void> {
  const promo = sanitizeAttribution(metadata?.promo);
  const ref = sanitizeAttribution(metadata?.ref);

  await persistPromoAttribution(admin, userId, metadata);

  // Топ воронки: лид пришёл из QR/referral-канала (ref или promo).
  if (ref || promo) {
    await logAnalyticsEvent(admin, {
      event_name: "qr_lead_registered",
      actor_user_id: userId,
      source: ref,
      meta: { has_promo: Boolean(promo), has_ref: Boolean(ref) },
    });
  }
  // Промо реально закреплено (в окне claim-акции) — второй шаг воронки.
  if (promo && !isPromoClaimExpired(promo)) {
    await logAnalyticsEvent(admin, {
      event_name: "promo_captured",
      actor_user_id: userId,
      source: ref ?? null,
    });
  }
}

/**
 * Мягкий дозвон-канал (P2, item 7): пишет `profiles.telegram_username` из
 * signUp-метаданных (поле опционально на RegisterTutor). Идемпотентно (только
 * если ещё пусто), санитайз telegram-хендла, значение НЕ логируем, сбой не
 * блокирует регистрацию. Не трогает auth-логику (rule 96). Пишется только там,
 * где метаданные его несут (tutor email-форма) — student-signup его не шлёт.
 */
export async function persistTutorTelegramFromMetadata(
  admin: SupabaseClient,
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<void> {
  const raw = typeof metadata?.telegram === "string" ? metadata.telegram.trim() : "";
  const handle = raw.replace(/^@+/, "").slice(0, 32);
  if (!/^[A-Za-z0-9_]{4,32}$/.test(handle)) return; // пусто/невалидно — пропускаем

  try {
    const { error } = await admin
      .from("profiles")
      .update({ telegram_username: handle })
      .eq("id", userId)
      .is("telegram_username", null); // не перезатираем уже указанный
    if (error) {
      console.warn(
        JSON.stringify({
          event: "tutor_telegram_persist_failed",
          timestamp: new Date().toISOString(),
        }),
      );
    }
  } catch (_e) {
    console.warn(
      JSON.stringify({
        event: "tutor_telegram_persist_failed",
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
