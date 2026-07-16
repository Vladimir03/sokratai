/**
 * CEO-дайджест в Telegram (Stage 2 CEO-аналитики) — Vladimir + Егор.
 *
 * Триггер: pg_cron → POST `Authorization: Bearer ${SCHEDULER_SECRET}`
 * (guard-паттерн tutor-plan-expiry-reminder), body `{ mode: "weekly"|"daily" }`.
 * verify_jwt=false в config.toml. Ручной запуск — тот же curl.
 *
 * weekly (пн 07:00 МСК): шапка здоровья + пре-воронка Метрики + движение
 * воронки за 7 дней + топ-3 «кому написать» — реюз computePulse (ceo-pulse.ts).
 * daily (08:00 МСК): события за 24ч — новые репетиторы (с каналом), оплаты
 * тарифа, новые триалы. ВСЁ ПУСТО → НЕ ШЛЁМ (тишина = ничего не произошло).
 *
 * Получатели: секрет CEO_DIGEST_CHAT_IDS (comma-separated chat id личных
 * чатов с ботом). Имена репетиторов в личке владельцев допустимы — это не
 * analytics_events (PII-контракт таблицы не задет).
 *
 * Идемпотентность: ceo_digest_log UNIQUE(mode, period_key), claim-first
 * (ON CONFLICT DO NOTHING → 0 строк = период уже обработан). Если после
 * claim НИ ОДНА отправка не удалась — claim снимается и возвращается 500
 * (ручной повтор безопасен).
 *
 * ⚠️ Деплой ТОЛЬКО sync-on-push (rule 96 §11a): агентский deploy-тул Lovable
 * включает JWT-гейт вопреки config.toml → gateway отбивал бы Bearer
 * SCHEDULER_SECRET (не JWT) до входа в функцию, cron молча умирал бы.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { computePulse, resolveChannel, type PulsePayload, type PulseTutor } from "../_shared/ceo-pulse.ts";
import { sendTelegramMessage } from "../_shared/telegram-send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const RU_MONTHS_GEN = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function mskDay(d: Date): string {
  return new Date(d.getTime() + MSK_OFFSET_MS).toISOString().split("T")[0];
}

function ruShortDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + MSK_OFFSET_MS);
  return `${d.getUTCDate()} ${RU_MONTHS_GEN[d.getUTCMonth()]}`;
}

/** Имена идут в parse_mode=HTML — экранирование обязательно. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const num = (v: number) => v.toLocaleString("ru-RU");
const signed = (v: number) => (v > 0 ? `+${num(v)}` : num(v));

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ────────────────────────── Weekly ──────────────────────────

/** Подсказка «что с ним не так» для застрявшего на поведенческой ступени k. */
const STUCK_HINTS: Record<number, string> = {
  1: "зарегистрировался, ученика нет",
  2: "ученик есть, ДЗ нет",
  3: "создал ДЗ, не отправил",
  4: "отправил ДЗ, ученик не открыл",
  5: "ученик открыл, но не сдал",
};

function buildWeeklyMessage(pulse: PulsePayload, now: Date): string {
  const h = pulse.header;
  const weekFrom = ruShortDate(new Date(now.getTime() - 7 * 864e5).toISOString());
  const weekTo = ruShortDate(now.toISOString());
  const lines: string[] = [];

  lines.push(`📊 <b>SokratAI · неделя ${weekFrom} — ${weekTo}</b>`);
  lines.push(
    `💰 MRR (run-rate): <b>${num(h.mrr)} ₽</b> (Δ ${signed(h.deltas.mrr)})`,
  );
  lines.push(
    `Платящих: <b>${h.payingTutors}</b> · Триалов: ${h.trialTutors} · WAU реп.: ${h.tutorWAU}`,
  );
  lines.push(`🧲 Новых репетиторов: <b>${h.newTutors7d}</b> (${signed(h.deltas.newTutors)})`);
  const nsmNames = h.weeklyValueTutors.names.slice(0, 4).map(escapeHtml).join(", ");
  lines.push(
    `⭐ Weekly Value (NSM): <b>${h.weeklyValueTutors.count}</b> (${signed(h.deltas.weeklyValue)})` +
      (nsmNames ? ` — ${nsmNames}` : ""),
  );

  // Пре-воронка Метрики (агрегаты; блок пропускается, если токен не настроен)
  if (pulse.preFunnel.available) {
    const p = pulse.preFunnel;
    lines.push("");
    lines.push(
      `🌐 До регистрации (7д): <b>${num(p.landingVisitors7d)}</b> визитов → ` +
        `${num(p.ctaClicks7d)} CTA → ${num(p.signupFormOpens7d)} открыли форму → ` +
        `${h.newTutors7d} регистраций`,
    );
    if (p.qrVisits7d > 0 || p.deltas.qrVisits !== 0) {
      lines.push(`📇 QR Егора: ${num(p.qrVisits7d)} визитов (${signed(p.deltas.qrVisits)})`);
    }
    if (p.missingGoals.length > 0) {
      lines.push(`⚠️ Цели не заведены в Метрике: ${p.missingGoals.length} шт (клики CTA занижены)`);
    }
  }

  // Движение воронки: у кого stageDates попали в последние 7 дней.
  // Полный список репетиторов собирается из stuck-списков ПОВЕДЕНЧЕСКИХ
  // ступеней — каждый репетитор ровно в одной (stage === k); trial/paid-списки
  // дублируют тех же людей и на полноту не влияют (Map дедупит).
  const d7 = new Date(now.getTime() - 7 * 864e5).toISOString();
  const allTutors = new Map<string, PulseTutor>();
  for (const stage of pulse.funnel) {
    for (const t of stage.stuck) allTutors.set(t.tutorId, t);
  }
  const moveCounts: Array<{ label: string; count: number }> = [];
  const keys: Array<{ key: keyof PulseTutor["stageDates"]; label: string }> = [
    { key: "student_added", label: "«Добавил ученика»" },
    { key: "hw_created", label: "«Создал ДЗ»" },
    { key: "hw_sent", label: "«Отправил ДЗ»" },
    { key: "student_opened", label: "«Ученик открыл»" },
    { key: "student_submitted", label: "«Ученик сдал»" },
    { key: "paid", label: "оплата" },
  ];
  for (const { key, label } of keys) {
    let count = 0;
    for (const t of allTutors.values()) {
      const at = t.stageDates[key];
      if (at && at >= d7) count++;
    }
    if (count > 0) moveCounts.push({ label, count });
  }
  lines.push("");
  lines.push(
    moveCounts.length > 0
      ? `📈 Воронка за неделю: ${moveCounts.map((m) => `+${m.count} ${m.label}`).join(", ")}`
      : "📈 Воронка за неделю: без движения",
  );

  // Кому написать: сперва at-risk (платящие/триальные без ценности), затем
  // свежие застрявшие на ступенях 1–4
  const suggestions: string[] = [];
  const used = new Set<string>();
  for (const r of pulse.atRisk) {
    if (suggestions.length >= 3) break;
    used.add(r.tutorId);
    const status = r.isPaying ? "платит" : "триал";
    const value = r.daysSinceValue == null ? "сдач не было" : `${r.daysSinceValue} дн без сдач`;
    suggestions.push(`• ${escapeHtml(r.name)} — ${status}, ${value}`);
  }
  if (suggestions.length < 3) {
    const stuckCandidates: Array<{ t: PulseTutor; hint: string }> = [];
    for (const stage of pulse.funnel) {
      const idx = ["registered", "student_added", "hw_created", "hw_sent"].indexOf(stage.key);
      if (idx === -1) continue;
      for (const t of stage.stuck) {
        if (!used.has(t.tutorId)) stuckCandidates.push({ t, hint: STUCK_HINTS[idx + 1] });
      }
    }
    stuckCandidates.sort((a, b) => (a.t.registeredAt < b.t.registeredAt ? 1 : -1));
    for (const { t, hint } of stuckCandidates) {
      if (suggestions.length >= 3) break;
      used.add(t.tutorId);
      suggestions.push(`• ${escapeHtml(t.name)} — ${hint} (рег. ${ruShortDate(t.registeredAt)})`);
    }
  }
  if (suggestions.length > 0) {
    lines.push("");
    lines.push("✍️ Кому написать:");
    lines.push(...suggestions);
  }

  lines.push("");
  lines.push(`Полная картина: https://sokratai.ru/admin`);
  return lines.join("\n");
}

// ────────────────────────── Daily ──────────────────────────

interface DailyEvents {
  newTutors: Array<{ name: string; channel: string }>;
  payments: Array<{ name: string; amount: number }>;
  newTrials: string[];
}

async function collectDailyEvents(
  db: ReturnType<typeof createClient>,
  now: Date,
): Promise<DailyEvents> {
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  const { data: tutorRows, error: tutorsError } = await db
    .from("tutors")
    .select("user_id, name, created_at")
    .gte("created_at", since);
  if (tutorsError) throw new Error(`tutors: ${tutorsError.message}`);
  const newTutorRows = tutorRows ?? [];

  // Каналы новичков + свежие триалы — один запрос profiles.
  const { data: allTutorIds, error: allTutorsError } = await db
    .from("tutors")
    .select("user_id, name, referral_code");
  if (allTutorsError) throw new Error(`tutors_all: ${allTutorsError.message}`);
  const tutorNameByUserId = new Map(
    (allTutorIds ?? []).map((t) => [t.user_id as string, (t.name as string) ?? "Без имени"]),
  );
  // Справочник реферальных кодов — канал «Реф: Эмилия» у новичков (Stage 3).
  const referrerNameByCode = new Map<string, string>();
  for (const t of allTutorIds ?? []) {
    if (typeof t.referral_code === "string" && t.referral_code) {
      referrerNameByCode.set(t.referral_code, (t.name as string) ?? "Коллега");
    }
  }

  const profileIds = [
    ...new Set([...newTutorRows.map((t) => t.user_id as string), ...tutorNameByUserId.keys()]),
  ];
  const profileById = new Map<string, { registration_source: string | null; promo_code: string | null; referred_by_code: string | null; trial_started_at: string | null }>();
  for (let i = 0; i < profileIds.length; i += 100) {
    const chunk = profileIds.slice(i, i + 100);
    const { data, error } = await db
      .from("profiles")
      .select("id, registration_source, promo_code, referred_by_code, trial_started_at")
      .in("id", chunk);
    if (error) throw new Error(`profiles: ${error.message}`);
    for (const p of data ?? []) {
      profileById.set(p.id as string, {
        registration_source: p.registration_source as string | null,
        promo_code: p.promo_code as string | null,
        referred_by_code: p.referred_by_code as string | null,
        trial_started_at: p.trial_started_at as string | null,
      });
    }
  }

  const newTutors = newTutorRows.map((t) => ({
    name: (t.name as string) ?? "Без имени",
    channel: resolveChannel(profileById.get(t.user_id as string), referrerNameByCode).label,
  }));

  // Оплаты тарифа за 24ч — по факту АКТИВАЦИИ (точный серверный момент).
  const { data: paymentRows, error: paymentsError } = await db
    .from("payments")
    .select("user_id, amount")
    .eq("plan", "tutor_ai_start")
    .eq("status", "succeeded")
    .gte("subscription_activated_at", since);
  if (paymentsError) throw new Error(`payments: ${paymentsError.message}`);
  const payments = (paymentRows ?? []).map((p) => ({
    name: tutorNameByUserId.get(p.user_id as string) ?? "Без имени",
    amount: Math.round(Number(p.amount ?? 0)),
  }));

  // Новые триалы за 24ч (только владельцы tutors-строк — премиум учеников не трогаем)
  const newTrials: string[] = [];
  for (const [userId, name] of tutorNameByUserId) {
    const trialAt = profileById.get(userId)?.trial_started_at;
    if (trialAt && trialAt >= since) newTrials.push(name);
  }

  return { newTutors, payments, newTrials };
}

function buildDailyMessage(events: DailyEvents): string {
  const lines: string[] = ["📌 <b>SokratAI · за сутки</b>"];
  if (events.newTutors.length > 0) {
    lines.push(
      `🆕 Регистрации: ${events.newTutors
        .map((t) => `${escapeHtml(t.name)} (${escapeHtml(t.channel)})`)
        .join(", ")}`,
    );
  }
  for (const p of events.payments) {
    lines.push(`💳 Оплата тарифа: ${escapeHtml(p.name)} — <b>${num(p.amount)} ₽</b>`);
  }
  if (events.newTrials.length > 0) {
    lines.push(`🚀 Новый триал: ${events.newTrials.map(escapeHtml).join(", ")}`);
  }
  return lines.join("\n");
}

// ────────────────────────── Server ──────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Scheduler guard (verbatim tutor-plan-expiry-reminder).
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("SCHEDULER_SECRET");
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  try {
    let mode: string = "weekly";
    try {
      const body = await req.json();
      if (body?.mode === "daily" || body?.mode === "weekly") mode = body.mode;
    } catch {
      // без body → weekly
    }

    const recipients = (Deno.env.get("CEO_DIGEST_CHAT_IDS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      console.error("ceo_digest_no_recipients (CEO_DIGEST_CHAT_IDS not set)");
      return jsonResponse(500, { error: "CEO_DIGEST_CHAT_IDS not configured" });
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();
    const periodKey = mskDay(now);

    // ── Claim-first идемпотентность ──
    const { data: claimed, error: claimError } = await db
      .from("ceo_digest_log")
      .upsert(
        { mode, period_key: periodKey, outcome: "sent" },
        { onConflict: "mode,period_key", ignoreDuplicates: true },
      )
      .select("id");
    if (claimError) {
      console.error("ceo_digest_claim_failed", claimError.message);
      return jsonResponse(500, { error: "Claim failed" });
    }
    if (!claimed || claimed.length === 0) {
      return jsonResponse(200, { skipped: true, reason: "already_processed", period: periodKey });
    }
    const claimId = claimed[0].id as number;
    const releaseClaim = async () => {
      await db.from("ceo_digest_log").delete().eq("id", claimId);
    };

    // ── Сборка сообщения ──
    let message: string | null = null;
    if (mode === "weekly") {
      const pulse = await computePulse(db, now);
      message = buildWeeklyMessage(pulse, now);
    } else {
      const events = await collectDailyEvents(db, now);
      const hasEvents =
        events.newTutors.length > 0 || events.payments.length > 0 || events.newTrials.length > 0;
      if (!hasEvents) {
        // Тишина = ничего не произошло (решение владельца). Период помечен.
        await db.from("ceo_digest_log").update({ outcome: "empty" }).eq("id", claimId);
        console.log("ceo_digest_daily_empty", periodKey);
        return jsonResponse(200, { sent: 0, empty: true, period: periodKey });
      }
      message = buildDailyMessage(events);
    }

    // ── Отправка ──
    let sent = 0;
    for (const chatId of recipients) {
      if (await sendTelegramMessage(chatId, message)) sent++;
    }
    if (sent === 0) {
      // Все отправки упали — снимаем claim, чтобы ручной повтор сработал.
      await releaseClaim();
      console.error("ceo_digest_all_sends_failed", mode, periodKey);
      return jsonResponse(500, { error: "All sends failed" });
    }

    console.log("ceo_digest_sent", JSON.stringify({ mode, period: periodKey, sent, recipients: recipients.length }));
    return jsonResponse(200, { sent, recipients: recipients.length, period: periodKey });
  } catch (error) {
    console.error("ceo_digest_error", error instanceof Error ? error.message : String(error));
    return jsonResponse(500, { error: "Internal error" });
  }
});
