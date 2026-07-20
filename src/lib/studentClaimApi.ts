/**
 * Онбординг-активация v2 — клиент для беспарольного claim, регистрации и OTP-входа.
 *
 * Все три edge-функции вызываются через supabase.functions.invoke: клиент шлёт
 * anon publishable key в apikey + Authorization (rule 96 #11a) даже без сессии,
 * поэтому проходит gateway и при verify_jwt=true, и при =false. Хост — api.sokratai.ru
 * (RU-safe, hardcoded в supabaseClient).
 */
import { supabase } from '@/lib/supabaseClient';
import { extractEdgeFunctionError } from '@/lib/edgeFunctionError';

export interface ClaimPreview {
  assignment_id: string;
  title: string;
  subject: string | null;
  task_count: number;
  entry_task_id: string | null;
}

export interface ClaimResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  tutor_name: string | null;
  preview: ClaimPreview | null;
}

function throwWithCode(message: string, code?: string): never {
  const err = new Error(message);
  if (code) (err as Error & { code?: string }).code = code;
  throw err;
}

/** POST student-claim — минт сессии по коду (многоразовый до регистрации,
 *  №43 2026-07-20; НЕ consume), превью первой ДЗ. */
export async function claimStudentByToken(token: string, channel = 'link'): Promise<ClaimResult> {
  const { data, error } = await supabase.functions.invoke('student-claim', {
    body: { token, channel },
  });
  if (error) {
    const { message, code } = await extractEdgeFunctionError(error, data, 'Не удалось открыть ссылку');
    throwWithCode(message, code);
  }
  return data as ClaimResult;
}

export interface RegisterStudentResult {
  ok: boolean;
  email: string;
  /** Свежая сессия (смена пароля отозвала старую) — клиент ОБЯЗАН setSession. */
  session?: { access_token: string; refresh_token: string; expires_in: number } | null;
}

/** POST student-register — доустановка email+пароля поверх claim-сессии. */
export async function registerStudent(email: string, password: string): Promise<RegisterStudentResult> {
  const { data, error } = await supabase.functions.invoke('student-register', {
    body: { email, password },
  });
  if (error) {
    const { message, code } = await extractEdgeFunctionError(error, data, 'Не удалось сохранить доступ');
    throwWithCode(message, code);
  }
  return data as RegisterStudentResult;
}

/** POST student-otp-request — RU-safe magic-link на email (нейтральный ответ). */
export async function requestStudentOtp(email: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('student-otp-request', {
    body: { email },
  });
  if (error) {
    const { message, code } = await extractEdgeFunctionError(error, data, 'Не удалось отправить ссылку');
    throwWithCode(message, code);
  }
}
