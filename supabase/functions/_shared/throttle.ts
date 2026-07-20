/**
 * Общий rate-limit по ключу за окно (таблица auth_otp_throttle, service-role).
 * Извлечён verbatim из student-otp-request (review P1 #5) для реюза в
 * student-claim (подбор короткого claim-кода) и будущих публичных endpoint'ов.
 *
 * Возвращает allowed. Fail-open при сбое (вход важнее). Read-modify-write —
 * приблизительно (гонка допустима для троттлинга).
 */
import type { createClient } from "npm:@supabase/supabase-js@2";

export async function throttleCheck(
  admin: ReturnType<typeof createClient>,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const nowMs = Date.now();
    const { data: row } = await admin
      .from("auth_otp_throttle")
      .select("attempts, window_start")
      .eq("throttle_key", key)
      .maybeSingle();
    if (row) {
      const ws = Date.parse(row.window_start as string);
      if (nowMs - ws < windowMs) {
        if ((row.attempts as number) >= max) return false;
        await admin.from("auth_otp_throttle").update({ attempts: (row.attempts as number) + 1 }).eq("throttle_key", key);
      } else {
        await admin.from("auth_otp_throttle").update({ attempts: 1, window_start: new Date().toISOString() }).eq("throttle_key", key);
      }
    } else {
      await admin.from("auth_otp_throttle").insert({ throttle_key: key, attempts: 1, window_start: new Date().toISOString() });
    }
    return true;
  } catch (e) {
    console.warn(JSON.stringify({ event: "throttle_check_failed", key_prefix: key.split(":")[0], error: e instanceof Error ? e.message : String(e) }));
    return true; // fail-open
  }
}
