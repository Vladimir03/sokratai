/**
 * Extract a human-readable error message from a `supabase.functions.invoke()` failure.
 *
 * `supabase-js` wraps non-2xx responses in a `FunctionsHttpError` whose generic
 * `.message` is "Edge Function returned a non-2xx status code" — useless for users.
 * The real body lives on `error.context` (a `Response`). This helper reads it once
 * and pulls a Russian message + optional structured `code` from the edge function.
 *
 * Contract on the server side: every non-2xx response MUST be JSON of the form
 *   `{ error: string, code?: string }`
 * with a human-readable Russian `error`. See `.claude/rules/97-edge-function-error-contract.md`.
 */
export async function extractEdgeFunctionError(
  error: unknown,
  data: unknown,
  fallback: string,
): Promise<{ message: string; code: string | null }> {
  // 1) Some invocations parse the body successfully and surface `{ error }` in `data`.
  if (data && typeof data === "object") {
    const maybeErr = (data as { error?: unknown }).error;
    const maybeCode = (data as { code?: unknown }).code;
    if (typeof maybeErr === "string" && maybeErr.trim()) {
      return {
        message: maybeErr.trim(),
        code: typeof maybeCode === "string" ? maybeCode : null,
      };
    }
  }

  // 2) Otherwise read raw body from FunctionsHttpError.context (a Response).
  const ctx = (error as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).text === "function") {
    try {
      const raw = await (ctx as Response).text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { error?: unknown; code?: unknown };
          if (typeof parsed.error === "string" && parsed.error.trim()) {
            return {
              message: parsed.error.trim(),
              code: typeof parsed.code === "string" ? parsed.code : null,
            };
          }
        } catch {
          // Body wasn't JSON — fall through to raw text if it's short and readable.
          if (raw.length < 500) return { message: raw, code: null };
        }
      }
    } catch {
      // ignore — fall through to fallback
    }
  }

  const generic = (error as { message?: unknown })?.message;
  if (typeof generic === "string" && generic && !generic.includes("non-2xx")) {
    // `FunctionsFetchError` ("Failed to send a request to the Edge Function"):
    // the browser never got a CORS-valid response — function undeployed/boot-crash
    // or network drop. Raw English text must not reach the user.
    if (generic.includes("Failed to send a request")) {
      return {
        message:
          "Сервер временно недоступен. Проверьте интернет и попробуйте ещё раз через минуту.",
        code: "EDGE_UNREACHABLE",
      };
    }
    return { message: generic, code: null };
  }
  return { message: fallback, code: null };
}
