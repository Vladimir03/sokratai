/**
 * Set-password migration (RU-compliance, rule 96 «406-ФЗ»).
 *
 * Existing Telegram-only accounts set an email+password on their EXISTING
 * account via a one-time token delivered by the bot command `/parol`. Public
 * edge (`student-set-password`, verify_jwt=false, token-authorized) — invoke
 * auto-attaches the anon publishable key in apikey + Authorization (rule 96
 * #11a), so it passes the gateway without a session. Host = api.sokratai.ru
 * (RU-safe, hardcoded in supabaseClient).
 */
import { supabase } from '@/lib/supabaseClient';
import { extractEdgeFunctionError } from '@/lib/edgeFunctionError';

function throwWithCode(message: string, code?: string): never {
  const err = new Error(message);
  if (code) (err as Error & { code?: string }).code = code;
  throw err;
}

/** POST student-set-password — set email+password on the token's account. */
export async function setPasswordByToken(
  token: string,
  email: string,
  password: string,
): Promise<{ ok: boolean; email: string }> {
  const { data, error } = await supabase.functions.invoke('student-set-password', {
    body: { token, email, password },
  });
  if (error) {
    const { message, code } = await extractEdgeFunctionError(error, data, 'Не удалось сохранить пароль');
    throwWithCode(message, code);
  }
  return data as { ok: boolean; email: string };
}
