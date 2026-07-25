/**
 * Лог отказов Lovable AI Gateway + мгновенный алерт владельцу (T0, 2026-07-25).
 *
 * ЗАЧЕМ. `token_usage_logs` пишет только УСПЕШНЫЕ вызовы, поэтому исчерпание
 * AI-кредитов не видно нигде: 24–25.07.2026 шлюз отбивал всё подряд 20+ часов,
 * и обнаружил это репетитор, а не мы. Здесь фиксируется обратная сторона —
 * финальные отказы вызова (после ретраев) — и при массовом отказе владельцу
 * уходит одно сообщение в Telegram.
 *
 * Контракт (зеркало `_shared/token-usage.ts`):
 *   - Fire-and-forget: НИКОГДА не бросает и не задерживает ответ AI-пути.
 *     Вызывать через `void logAiGatewayError(...)`, не await'ить в hot-path.
 *   - PII-free: только `source` (telemetryTag), HTTP-статус и короткий код.
 *     Тело ответа шлюза НЕ пишем — оно может нести фрагменты промпта / текст
 *     задачи / вывод модели (rule 40).
 *   - Ноль зависимостей: прямой fetch на PostgREST RPC, без SDK — хелпер линкуется
 *     в КАЖДУЮ функцию, которая зовёт шлюз, и не должен тянуть за собой бандл.
 *   - Решение «пора алертить» принимает БД (`ai_gateway_error_log` под
 *     advisory-lock): при массовом отказе десятки isolate зовут её одновременно.
 *
 * Миграция: `20260725120000_ai_gateway_errors_and_credit_usage.sql`.
 */

/** Короткий классификатор отказа (пишется в `ai_gateway_errors.error_code`). */
export type AiGatewayErrorCode =
  | "http" //            шлюз ответил не-2xx (статус в http_status)
  | "timeout" //         AbortError — вызов не уложился в лимит
  | "network" //         TypeError — соединение не установилось
  | "empty_response" //  HTTP 200, но модель вернула пустой контент
  | "invalid_json"; //   HTTP 200, но JSON не распарсился

const ALERT_TEXT =
  "🚨 <b>AI-шлюз отбивает вызовы</b>\n" +
  "Похоже, исчерпан лимит AI-кредитов Lovable — проверь Settings → Usage.\n" +
  "Пока шлюз молчит, у учеников падает автопроверка ДЗ.";

/**
 * Записать один отказ шлюза; при >= 3 отказах за 15 минут (и не чаще раза в час)
 * отправить владельцу Telegram-алерт. Все ошибки глотаются.
 */
export async function logAiGatewayError(input: {
  source: string;
  httpStatus?: number | null;
  code?: AiGatewayErrorCode | null;
}): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return;

    const resp = await fetch(`${url}/rest/v1/rpc/ai_gateway_error_log`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_source: input.source,
        p_http_status: typeof input.httpStatus === "number" ? input.httpStatus : null,
        p_error_code: input.code ?? null,
      }),
    });

    if (!resp.ok) {
      // PII-free: только статус. Пропущенная запись лога не должна ничего ронять.
      console.warn("ai_gateway_error_log_failed", { status: resp.status });
      return;
    }

    const shouldAlert = (await resp.json().catch(() => null)) === true;
    if (!shouldAlert) return;

    const recipients = (Deno.env.get("CEO_DIGEST_CHAT_IDS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (recipients.length === 0) return;

    // Динамический импорт: telegram-send нужен только в редкой ветке алерта,
    // а этот модуль линкуется во все AI-функции (rule 98 — лишний top-level
    // импорт в горячем графе = риск 503 boot-crash на всей функции).
    const { sendTelegramMessage } = await import("./telegram-send.ts");
    for (const chatId of recipients) {
      await sendTelegramMessage(chatId, ALERT_TEXT);
    }
    console.warn("ai_gateway_alert_sent", { recipients: recipients.length });
  } catch (error) {
    console.warn("ai_gateway_error_log_exception", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

/**
 * Классифицировать перехваченную ошибку вызова шлюза для лога.
 * `status` берётся из HttpStatusError-подобного объекта вызывающего (у каждого
 * `callLovableJson` свой локальный класс — структурная проверка вместо instanceof).
 */
export function classifyAiGatewayError(error: unknown): {
  code: AiGatewayErrorCode;
  httpStatus: number | null;
} {
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return { code: "http", httpStatus: status };
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") return { code: "timeout", httpStatus: null };
    if (error.name === "TypeError") return { code: "network", httpStatus: null };
    if (error.message.includes("Model response is empty")) {
      return { code: "empty_response", httpStatus: null };
    }
    if (error.message.includes("Failed to extract valid JSON")) {
      return { code: "invalid_json", httpStatus: null };
    }
  }
  return { code: "network", httpStatus: null };
}
