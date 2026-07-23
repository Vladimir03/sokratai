/**
 * Серверная воронка активации (онбординг v2) — единый writer для analytics_events.
 *
 * Таблица append-only, service_role-only (миграция 20260701120100). PII-free:
 * НИКОГДА не передавай сюда имена/email/тексты — только id, категории, счётчики.
 *
 * Fire-and-forget: ошибка записи телеметрии НЕ должна ломать основной flow —
 * все функции глотают ошибку (лог без PII) и возвращают void.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type AnalyticsEventName =
  // репетитор
  | "tutor_first_student_added"
  | "invite_generated"
  | "tutor_first_homework_created"
  | "homework_sent_to_student"
  | "student_received_and_opened" // cross-side «ага»
  // ученик
  | "invite_claimed"
  | "student_first_login"
  | "student_registered"
  | "student_first_homework_opened"
  | "student_first_submission"
  // воронка оплаты тарифа репетитора (round 3, 2026-07-02; CHECK-whitelist
  // расширен миграцией 20260702130000)
  | "tutor_payment_created"
  | "tutor_payment_succeeded"
  // демо-разбор «как Сократ проверяет» — сдвиг aha влево (v2.1 W1;
  // CHECK-whitelist расширен миграцией 20260708130000)
  | "tutor_demo_check_viewed" // открыл готовый пример разбора (A)
  | "tutor_demo_check_ran" // прогнал разбор своей задачи (B)
  // чат репетитор↔ученик (CHECK-whitelist расширен миграцией 20260712150300)
  | "chat_first_message_sent" // в беседе появилось первое сообщение
  | "tutor_chat_ai_ran" // @СократAI вызван репетитором (COUNT за сутки = cap)
  | "student_chat_ai_ran" // @СократAI вызван учеником
  // QR-онбординг лидов Егора (CHECK-whitelist расширен миграцией 20260713140000)
  | "qr_lead_registered" // репетитор зарегистрировался из QR-канала (ref/promo)
  | "promo_captured" // промокод действующей акции закреплён на аккаунте
  | "community_cta_clicked" // клик по community-CTA (TG/VK) на /tutor/home
  // клиентские краши ErrorBoundary/MarkdownErrorBoundary (CHECK-whitelist
  // расширен миграцией 20260715120000; writer — edge client-error-report).
  // ОСОЗНАННОЕ исключение из «meta без свободного текста»: meta.message =
  // технический текст ошибки (усечён + route санитизирован на edge).
  | "client_error"
  // рефералка v1 (CHECK-whitelist расширен миграцией 20260716120000; в union
  // добавлены 2026-07-23 — дрейф: Deno-код не тайпчекается пайплайном)
  | "referral_attributed"
  | "referral_code_copied"
  // предметная персонализация Ф1/Ф2 (CHECK-whitelist расширен миграцией
  // 20260723120000; writer — tutor-progress-api POST /track)
  | "subjects_gate_shown"
  | "subjects_gate_postponed"
  | "subjects_gate_saved" // once-per-tutor (данные гасят гейт — честно 1 раз)
  | "subject_default_overridden"; // {surface, from, to} — канонические id

export interface AnalyticsEventInput {
  event_name: AnalyticsEventName;
  actor_user_id?: string | null;
  tutor_id?: string | null;
  student_id?: string | null;
  tutor_student_id?: string | null;
  assignment_id?: string | null;
  source?: string | null;
  /** Только счётчики/флаги/категории — без свободного текста (PII-free). */
  meta?: Record<string, unknown> | null;
}

/**
 * Записать событие воронки. Никогда не бросает; возвращает `true` при
 * успешном INSERT (ревью 2026-07-15 P2: writer'ам, чья единственная задача —
 * запись события, напр. edge `client-error-report`, нужен honest-результат
 * вместо молчаливого проглатывания). Существующие fire-and-forget callsites
 * игнорируют возврат — совместимо.
 */
export async function logAnalyticsEvent(
  db: SupabaseClient,
  input: AnalyticsEventInput,
): Promise<boolean> {
  try {
    const { error } = await db.from("analytics_events").insert({
      event_name: input.event_name,
      actor_user_id: input.actor_user_id ?? null,
      tutor_id: input.tutor_id ?? null,
      student_id: input.student_id ?? null,
      tutor_student_id: input.tutor_student_id ?? null,
      assignment_id: input.assignment_id ?? null,
      source: input.source ?? null,
      meta: input.meta ?? null,
    });
    if (error) {
      // PII-free: только имя события + код ошибки.
      console.warn(
        JSON.stringify({
          event: "analytics_event_insert_failed",
          event_name: input.event_name,
          error: error.message,
        }),
      );
      return false;
    }
    return true;
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "analytics_event_insert_threw",
        event_name: input.event_name,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return false;
  }
}

/**
 * Записать событие ТОЛЬКО если для него ещё нет строки с тем же event_name и
 * указанным scope-фильтром (для `*_first_*` событий). Best-effort, не атомарно
 * (дубль при гонке приемлем для аналитики). Fire-and-forget.
 *
 * @param scope — колонки-ключ дедупа, напр. `{ tutor_id }` или `{ student_id }`.
 */
export async function logAnalyticsEventOnce(
  db: SupabaseClient,
  input: AnalyticsEventInput,
  scope: Partial<
    Pick<
      AnalyticsEventInput,
      "tutor_id" | "student_id" | "tutor_student_id" | "assignment_id" | "source"
    >
  >,
): Promise<void> {
  try {
    let query = db
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("event_name", input.event_name);

    for (const [key, value] of Object.entries(scope)) {
      if (value == null) {
        // Без валидного scope «once» не имеет смысла — пишем обычным путём.
        await logAnalyticsEvent(db, input);
        return;
      }
      query = query.eq(key, value as string);
    }

    const { count, error } = await query;
    if (error) {
      // При сбое проверки — лучше записать (может задвоить), чем потерять сигнал.
      await logAnalyticsEvent(db, input);
      return;
    }
    if ((count ?? 0) > 0) return; // уже было — пропускаем
    await logAnalyticsEvent(db, input);
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "analytics_event_once_threw",
        event_name: input.event_name,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}
