/**
 * Centralized mapping of auth errors to user-friendly Russian messages.
 *
 * Sources of errors:
 *   1. Supabase Auth API responses (signInWithPassword, signUp, resetPassword)
 *      — English messages from gotrue. Translated to RU via SUPABASE_AUTH_ERRORS.
 *   2. Custom `oauth-google-callback` edge function `redirectToErrorPage(reason)`
 *      — Reason codes returned as `?oauth_error=...` query param on /login.
 *      Translated via OAUTH_CALLBACK_ERRORS.
 *   3. Custom `email-verify` edge function `redirectToError(reason)`
 *      — Reason codes returned as `?email_verify_error=...` query param on /login.
 *      Translated via EMAIL_VERIFY_ERRORS.
 *
 * Why centralized: previously each page rolled its own error handling; toasts
 * showed raw "Invalid login credentials" English text, leaving RU users
 * confused. Reviewer P2 (Round 4 code review 2026-05-16) called this out.
 *
 * Adding a new error source:
 *   - For new Supabase error variants → extend SUPABASE_AUTH_ERRORS keys
 *   - For new oauth-google-callback reasons → extend OAUTH_CALLBACK_ERRORS
 *   - For new email-verify reasons → extend EMAIL_VERIFY_ERRORS
 *   - Don't add raw `console.error` translations here — that's a separate
 *     telemetry concern, not user-facing UX.
 */

/**
 * Supabase Auth API error messages (English) → Russian translations.
 *
 * Match precedence:
 *   1. Exact key match (`error.message === key`)
 *   2. Case-insensitive substring match (lowercase compare)
 *
 * Source: gotrue error strings, https://github.com/supabase/gotrue/blob/master/internal/api/errors.go
 */
const SUPABASE_AUTH_ERRORS: Record<string, string> = {
  "Invalid login credentials":
    "Неверный email или пароль. Проверьте раскладку клавиатуры и регистр.",
  "Email not confirmed":
    "Email не подтверждён. Проверьте почту — там письмо со ссылкой для подтверждения.",
  "User not found":
    "Пользователь с таким email не найден. Возможно вы регистрировались под другим адресом.",
  "User already registered":
    "Этот email уже зарегистрирован. Войдите в существующий аккаунт.",
  "Email rate limit exceeded":
    "Слишком много попыток. Подождите минуту и попробуйте снова.",
  "Signups not allowed for this instance":
    "Регистрация временно отключена. Напишите в поддержку.",
  "Password should be at least 6 characters":
    "Пароль должен содержать минимум 6 символов.",
  "User is banned":
    "Аккаунт заблокирован. Напишите в поддержку.",
  "Email link is invalid or has expired":
    "Ссылка из письма устарела. Регистрируйтесь заново.",
  "Token has expired or is invalid":
    "Сессия истекла. Войдите снова.",
  "Database error saving new user":
    "Не удалось создать аккаунт. Попробуйте через минуту или напишите в поддержку.",
  // gotrue throttle (`over_email_send_rate_limit`): "For security purposes, you can
  // only request this after N seconds" — N varies, so match on the stable prefix.
  "For security purposes, you can only request this":
    "Слишком частые запросы. Подождите минуту и попробуйте снова.",
  "over_email_send_rate_limit":
    "Слишком частые запросы. Подождите минуту и попробуйте снова.",
};

/**
 * Reason codes from the OAuth callback edge functions
 * (oauth-yandex-callback, oauth-vk-callback; legacy oauth-google-callback is
 * DORMANT). Returned as `?oauth_error=<reason>` on /login redirect after a
 * failed OAuth round-trip. The map is shared by ALL providers — keep texts
 * provider-neutral («сервис входа»), never name a specific provider.
 * Provider-prefixed codes (`vk_*`, `yandex_*`, `google_*`) are handled by
 * translateProviderOAuthError below.
 */
const OAUTH_CALLBACK_ERRORS: Record<string, string> = {
  not_configured:
    "Сервис временно недоступен. Попробуйте через несколько минут.",
  missing_code_or_state:
    "Не удалось завершить вход. Попробуйте войти заново.",
  missing_code_state_or_device:
    "Не удалось завершить вход. Попробуйте войти заново.",
  invalid_state:
    "Не удалось завершить вход. Попробуйте ещё раз.",
  token_exchange_failed:
    "Сервис входа не ответил. Попробуйте через минуту или войдите по email.",
  no_access_token:
    "Сервис входа не вернул данные. Попробуйте ещё раз или войдите по email.",
  no_id_token:
    "Сервис входа не вернул данные о пользователе. Попробуйте ещё раз.",
  invalid_id_token:
    "Сервис входа вернул некорректные данные. Попробуйте ещё раз.",
  userinfo_failed:
    "Не удалось получить профиль. Попробуйте ещё раз или войдите по email.",
  no_user_id:
    "Сервис входа не вернул данные о пользователе. Попробуйте ещё раз.",
  email_not_verified:
    "Email в вашем аккаунте не подтверждён. Подтвердите его в настройках сервиса и попробуйте снова.",
  create_user_failed:
    "Не удалось создать аккаунт. Напишите в поддержку.",
  link_failed:
    "Не удалось завершить вход. Попробуйте через email.",
  verify_failed:
    "Не удалось подтвердить вход. Попробуйте ещё раз.",
  role_finalization_failed:
    "Аккаунт создан, но не удалось активировать роль репетитора. Напишите в поддержку — починим за пару минут.",
};

/**
 * Provider-prefixed reason codes: the callbacks forward the provider's own
 * `?error=` as `vk_<error>` / `yandex_<error>` / `google_<error>`.
 * Returns null when the code has no known provider prefix.
 */
function translateProviderOAuthError(code: string): string | null {
  const m = code.match(/^(vk|yandex|google)_(.+)$/);
  if (!m) return null;
  const reason = m[2];
  if (reason.includes("access_denied") || reason.includes("cancel")) {
    return "Вы отменили вход. Можно попробовать снова или войти по email.";
  }
  return "Сервис входа отклонил запрос. Попробуйте ещё раз или войдите по email.";
}

/**
 * Reason codes from email-verify edge function
 * (supabase/functions/email-verify/index.ts::redirectToError).
 * Returned as `?email_verify_error=<reason>` when user clicks confirmation
 * link from email and something goes wrong.
 */
const EMAIL_VERIFY_ERRORS: Record<string, string> = {
  not_configured:
    "Сервис временно недоступен. Попробуйте через несколько минут.",
  missing_params:
    "Некорректная ссылка подтверждения. Зарегистрируйтесь заново.",
  invalid_type:
    "Некорректная ссылка подтверждения. Зарегистрируйтесь заново.",
  malformed_token:
    "Ссылка подтверждения повреждена. Зарегистрируйтесь заново.",
  redirect_not_allowed:
    "Некорректный redirect в ссылке.",
  token_expired:
    "Ссылка подтверждения истекла. Зарегистрируйтесь заново — мы пришлём новое письмо.",
  token_invalid:
    "Ссылка подтверждения уже использована или недействительна. Попробуйте войти по email и паролю.",
  verify_failed:
    "Не удалось подтвердить email. Попробуйте ещё раз или напишите в поддержку.",
  role_finalization_failed:
    "Email подтверждён, но не удалось активировать роль репетитора. Напишите в поддержку.",
};

/**
 * Translate a raw Supabase Auth error to a user-friendly Russian message.
 * Falls back to the raw message if no translation exists.
 *
 * @param error — Error object, string, or unknown thrown value.
 * @param fallback — Default message if error is empty/unrecognizable.
 */
export function translateAuthError(
  error: unknown,
  fallback: string,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String((error as { message?: string } | null)?.message ?? "");

  if (!raw.trim()) return fallback;

  // 1. Exact match
  if (SUPABASE_AUTH_ERRORS[raw]) {
    return SUPABASE_AUTH_ERRORS[raw];
  }

  // 2. Substring match (Supabase sometimes prefixes/suffixes the canonical message)
  const lower = raw.toLowerCase();
  for (const [key, value] of Object.entries(SUPABASE_AUTH_ERRORS)) {
    if (lower.includes(key.toLowerCase())) return value;
  }

  // 3. Network-level (preserve old getAuthErrorMessage behavior)
  if (lower.includes("fetch") || lower.includes("network")) {
    return "Ошибка сети. Проверьте подключение и попробуйте снова.";
  }

  return raw || fallback;
}

/**
 * Read auth error query params (`email_verify_error`, `oauth_error`) from
 * URLSearchParams and return a translated user-facing message, or null if
 * no auth error is present.
 *
 * Used by Login.tsx + TutorLogin.tsx in useEffect on mount to surface
 * errors that happened in edge function redirects (where there's no
 * client-side toast at the point of failure).
 */
export function readAuthRedirectError(
  params: URLSearchParams,
): { code: string; message: string } | null {
  const emailVerifyErr = params.get("email_verify_error");
  if (emailVerifyErr) {
    return {
      code: emailVerifyErr,
      message:
        EMAIL_VERIFY_ERRORS[emailVerifyErr] ??
        "Не удалось подтвердить email. Попробуйте ещё раз.",
    };
  }

  const oauthErr = params.get("oauth_error");
  if (oauthErr) {
    return {
      code: oauthErr,
      message:
        OAUTH_CALLBACK_ERRORS[oauthErr] ??
        translateProviderOAuthError(oauthErr) ??
        "Не удалось войти. Попробуйте по email и паролю.",
    };
  }

  return null;
}
