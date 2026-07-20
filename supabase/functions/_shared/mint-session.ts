import { createClient } from "npm:@supabase/supabase-js@2";

export interface MintedSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Минтит СВЕЖУЮ сессию для пользователя (magiclink → verifyOtp, паттерн
 * student-claim). Нужно ПОСЛЕ смены пароля через `admin.updateUserById({password})`:
 * GoTrue при смене пароля удаляет ВСЕ session-строки пользователя, а access-token
 * несёт `session_id` → он мгновенно мёртв на каждом GoTrue-валидирующем endpoint
 * (edge, /auth/v1/user). Клиент, оставшийся на старых токенах, разлогинивается на
 * первом же edge-запросе (баг 2026-07-20: «вылетает на выборе класса после
 * регистрации» — репорт Егора). Вызывающий возвращает результат клиенту, тот
 * делает `supabase.auth.setSession(...)`.
 *
 * Fail-soft: любой сбой → null (клиент остаётся на старой сессии — не хуже, чем
 * без фикса; логируем PII-free).
 */
export async function mintFreshSession(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  anonKey: string,
  email: string,
): Promise<MintedSession | null> {
  try {
    const { data: linkData, error: genErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const hashedToken = linkData?.properties?.hashed_token;
    if (genErr || !hashedToken) {
      console.error(JSON.stringify({ event: "mint_session_generatelink_failed", error: genErr?.message ?? "no_hash" }));
      return null;
    }
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
      token_hash: hashedToken,
      type: "magiclink",
    });
    if (verifyErr || !verifyData?.session) {
      console.error(JSON.stringify({ event: "mint_session_verify_failed", error: verifyErr?.message ?? "no_session" }));
      return null;
    }
    return {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
      expires_in: verifyData.session.expires_in ?? 3600,
    };
  } catch (e) {
    console.error(JSON.stringify({ event: "mint_session_error", error: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}
