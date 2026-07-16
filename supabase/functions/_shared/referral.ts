/**
 * Реферальная программа репетиторов v1 (attribution-only) — единая точка
 * привязки «кто привёл» (spec docs/delivery/features/ceo-analytics/spec.md
 * Stage 3, rule 101).
 *
 * Три метода привязки, ОДИН write-path:
 *   - 'signup'  — из auth-финализаторов через persistPromoAttributionAndTrack
 *                 (dynamic import + never-throw: реферал НЕ имеет права ронять
 *                 боевой auth-путь — прецедент rule 98 503-инцидента);
 *   - 'profile' — новичок вводит код позже (tutor-progress-api /referrals/claim);
 *   - 'admin'   — ретро-привязка из Пульса (Excel-кейс владельца); OVERWRITE-
 *                 семантика (админ — авторитет над first-write-wins).
 *
 * referred_by_tutor_id НЕ существует: код UNIQUE, резолв по коду в runtime.
 * Семейный кейс (custdev): несколько аккаунтов по одному коду — РАЗРЕШЕНО,
 * лимитов на код нет. Self-referral запрещён всегда.
 *
 * PII-free логи: значения кодов/имена НЕ логируются, только маркеры шагов.
 */
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logAnalyticsEvent } from "./analytics.ts";

export type ReferralMethod = "signup" | "profile" | "admin";

export type ReferralAttributionResult =
  | { ok: true; referrerName: string }
  | { ok: false; reason: "NO_CODE" | "NOT_FOUND" | "SELF" | "ALREADY_SET" | "WRITE_FAILED" };

/** Санитайз кода: 4–16 безопасных символов → UPPERCASE (коды генерятся в верхнем регистре). */
export function sanitizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 16);
  return /^[A-Za-z0-9_-]{4,16}$/.test(trimmed) ? trimmed.toUpperCase() : null;
}

function logReferralMarker(step: string): void {
  console.warn(
    JSON.stringify({ event: "referral_attribution", step, timestamp: new Date().toISOString() }),
  );
}

/**
 * Привязать реферальный код к профилю userId. Never-throw.
 *
 * - Резолв реферера по tutors.referral_code; NOT_FOUND / SELF → отказ.
 * - 'signup'/'profile': атомарный first-write-wins
 *   (UPDATE ... WHERE referred_by_code IS NULL); уже привязан → ALREADY_SET.
 * - 'admin': overwrite без IS NULL-условия (ретро-корректировка владельцем).
 * - Успех: событие referral_attributed + telegram рефереру (кроме 'admin' —
 *   ретро-привязка задним числом не должна слать «только что зарегистрировался»).
 */
export async function attributeReferral(
  admin: SupabaseClient,
  userId: string,
  rawCode: unknown,
  method: ReferralMethod,
): Promise<ReferralAttributionResult> {
  try {
    const code = sanitizeReferralCode(rawCode);
    if (!code) return { ok: false, reason: "NO_CODE" };

    // Резолв реферера (service_role — RLS не мешает).
    const { data: referrer, error: refError } = await admin
      .from("tutors")
      .select("id, user_id, name, telegram_id")
      .eq("referral_code", code)
      .maybeSingle();
    if (refError) {
      logReferralMarker("resolve_failed");
      return { ok: false, reason: "WRITE_FAILED" };
    }
    if (!referrer) return { ok: false, reason: "NOT_FOUND" };
    if ((referrer.user_id as string) === userId) return { ok: false, reason: "SELF" };

    // Запись: first-write-wins для signup/profile, overwrite для admin.
    let query = admin
      .from("profiles")
      .update({ referred_by_code: code, referred_at: new Date().toISOString() })
      .eq("id", userId);
    if (method !== "admin") {
      query = query.is("referred_by_code", null);
    }
    const { data: updated, error: updateError } = await query.select("id");
    if (updateError) {
      logReferralMarker("update_failed");
      return { ok: false, reason: "WRITE_FAILED" };
    }
    if (!updated || updated.length === 0) {
      // Условие IS NULL не сматчилось → уже привязан (или профиля нет).
      return { ok: false, reason: "ALREADY_SET" };
    }

    // Телеметрия воронки (PII-free: id + категория метода).
    await logAnalyticsEvent(admin, {
      event_name: "referral_attributed",
      actor_user_id: userId,
      tutor_id: referrer.id as string,
      source: method,
    });

    const referrerName =
      typeof referrer.name === "string" && referrer.name.trim() ? referrer.name.trim() : "Коллега";

    // Мгновенный крючок рефереру: «код сработал». Кроме admin-ретро-привязки.
    if (method !== "admin") {
      const telegramId =
        typeof referrer.telegram_id === "string" ? referrer.telegram_id.trim() : "";
      if (telegramId) {
        try {
          // Dynamic import: не тащим telegram-модуль в boot-граф auth-финализаторов.
          const { sendTelegramMessage } = await import("./telegram-send.ts");
          const newcomerName = await resolveNewcomerName(admin, userId);
          await sendTelegramMessage(
            telegramId,
            `🎉 Ваш код приглашения сработал — <b>${escapeHtml(newcomerName)}</b> зарегистрировался(ась) в СократAI.\n` +
              `Статус приглашённых — в профиле: https://sokratai.ru/tutor/profile`,
          );
        } catch (_e) {
          logReferralMarker("notify_failed");
        }
      }
    }

    return { ok: true, referrerName };
  } catch (_e) {
    logReferralMarker("threw");
    return { ok: false, reason: "WRITE_FAILED" };
  }
}

/** Имя новичка для уведомления рефереру: tutors.name → profiles.username → нейтрально. */
async function resolveNewcomerName(admin: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data: tutorRow } = await admin
      .from("tutors")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();
    const tutorName = typeof tutorRow?.name === "string" ? tutorRow.name.trim() : "";
    if (tutorName) return tutorName;

    const { data: profile } = await admin
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    const username = typeof profile?.username === "string" ? profile.username.trim() : "";
    if (username) return username;
  } catch (_e) {
    // best-effort
  }
  return "новый репетитор";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
