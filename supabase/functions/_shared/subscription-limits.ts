// Shared AI-quota / subscription helper for edge functions.
//
// Канонический gate для дневного лимита AI-сообщений. Используется и /chat
// (chat-discuss, bootstrap intro, voice transcription), и /homework-api guard'ами
// (check answer, hint). Один счётчик per-user (daily_message_limits), но разный
// порог в зависимости от контекста и того, есть ли у студента платящий тутор —
// логика инкапсулирована в RPC get_subscription_status(p_user_id, p_context).
//
// При расширении гейта (новые AI-пути) — импортировать checkAiQuota / buildLimitReachedResponse,
// не дублировать RPC-логику. См. .claude/plans/mutable-dancing-alpaca.md.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const FREE_DAILY_LIMIT = 10;

export type AiQuotaContext = "chat" | "homework";

export interface AiQuotaCheckOptions {
  /** Increment usage counter when allowed (default true). Voice→chat re-entry passes false. */
  incrementUsage?: boolean;
  /** Determines threshold (10 vs 50 for free students with paid tutor). */
  context?: AiQuotaContext;
}

export interface AiQuotaCheckResult {
  allowed: boolean;
  isPremium: boolean;
  isTrialActive: boolean;
  trialEndsAt: string | null;
  messagesUsed: number;
  limit: number;
  /** Marketing nudge — student has tutor(s) but none paying. Surface upgrade CTA in 429 toast. */
  tutorCanUpgrade: boolean;
}

/**
 * Check AI-quota for user given context.
 * Premium/trial users → allowed, unlimited (-1). Free → enforced daily_limit from RPC.
 *
 * Returns { allowed, limit, messagesUsed, ... }. On RPC failure falls back to permissive
 * (allowed: true, limit: FREE_DAILY_LIMIT) to avoid blocking users during outage.
 */
export async function checkAiQuota(
  userId: string,
  adminSupabase: SupabaseClient,
  options: AiQuotaCheckOptions = {},
): Promise<AiQuotaCheckResult> {
  const shouldIncrementUsage = options.incrementUsage ?? true;
  const context: AiQuotaContext = options.context ?? "chat";

  try {
    const { data: status, error } = await adminSupabase
      .rpc("get_subscription_status", { p_user_id: userId, p_context: context })
      .single();

    if (error || !status) {
      throw error || new Error("No subscription status returned");
    }

    const isPremium = Boolean(status.is_premium);
    const isTrialActive = Boolean(status.is_trial_active);
    const trialEndsAt = status.trial_ends_at || null;
    const dailyLimit = status.daily_limit ?? FREE_DAILY_LIMIT;
    const messagesUsed = status.messages_used ?? 0;
    const limitReached = Boolean(status.limit_reached);
    const tutorCanUpgrade = Boolean(status.tutor_can_upgrade);

    if (isPremium) {
      console.log("✅ Premium user - no message limits");
      return {
        allowed: true,
        isPremium: true,
        isTrialActive: false,
        trialEndsAt: null,
        messagesUsed: 0,
        limit: -1,
        tutorCanUpgrade: false,
      };
    }

    if (isTrialActive) {
      const daysLeft = status.trial_days_left ?? 0;
      console.log(`🎁 Trial active - ${daysLeft} days left, no message limits`);
      return {
        allowed: true,
        isPremium: false,
        isTrialActive: true,
        trialEndsAt,
        messagesUsed: 0,
        limit: -1,
        tutorCanUpgrade: false,
      };
    }

    // Free users: enforce daily limit
    if (limitReached) {
      console.log(
        `❌ Daily limit reached (${context}): ${messagesUsed}/${dailyLimit}` +
          (tutorCanUpgrade ? " — tutor_can_upgrade" : ""),
      );
      return {
        allowed: false,
        isPremium: false,
        isTrialActive: false,
        trialEndsAt,
        messagesUsed,
        limit: dailyLimit,
        tutorCanUpgrade,
      };
    }

    if (!shouldIncrementUsage) {
      console.log(
        `📊 Limit check passed without increment (${context}): ${messagesUsed}/${dailyLimit}`,
      );
      return {
        allowed: true,
        isPremium: false,
        isTrialActive: false,
        trialEndsAt,
        messagesUsed,
        limit: dailyLimit,
        tutorCanUpgrade,
      };
    }

    // Increment counter atomically for current day
    const today = new Date().toISOString().split("T")[0];
    await adminSupabase.from("daily_message_limits").upsert(
      {
        user_id: userId,
        messages_today: messagesUsed + 1,
        last_reset_date: today,
      },
      { onConflict: "user_id" },
    );

    console.log(`📊 Message count (${context}): ${messagesUsed + 1}/${dailyLimit}`);
    return {
      allowed: true,
      isPremium: false,
      isTrialActive: false,
      trialEndsAt,
      messagesUsed: messagesUsed + 1,
      limit: dailyLimit,
      tutorCanUpgrade,
    };
  } catch (err) {
    console.error("Error checking subscription via RPC, falling back:", err);

    // Fallback: read profile directly to avoid blocking users on RPC outage.
    // Note: fallback does NOT consult tutor_students (homework-context boost is skipped).
    // Acceptable degradation — RPC outage is rare.
    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("subscription_tier, subscription_expires_at, trial_ends_at")
      .eq("id", userId)
      .single();

    if (profileError) {
      console.error("Fallback profile fetch failed:", profileError);
      return {
        allowed: true,
        isPremium: false,
        isTrialActive: false,
        trialEndsAt: null,
        messagesUsed: 0,
        limit: FREE_DAILY_LIMIT,
        tutorCanUpgrade: false,
      };
    }

    const isPremiumFallback = profile?.subscription_tier === "premium"
      && (!profile?.subscription_expires_at
        || new Date(profile.subscription_expires_at) > new Date());

    if (isPremiumFallback) {
      return {
        allowed: true,
        isPremium: true,
        isTrialActive: false,
        trialEndsAt: null,
        messagesUsed: 0,
        limit: -1,
        tutorCanUpgrade: false,
      };
    }

    const isTrialActiveFallback = profile?.trial_ends_at
      && new Date(profile.trial_ends_at) > new Date();
    if (isTrialActiveFallback) {
      return {
        allowed: true,
        isPremium: false,
        isTrialActive: true,
        trialEndsAt: profile.trial_ends_at,
        messagesUsed: 0,
        limit: -1,
        tutorCanUpgrade: false,
      };
    }

    return {
      allowed: true,
      isPremium: false,
      isTrialActive: false,
      trialEndsAt: profile?.trial_ends_at || null,
      messagesUsed: 0,
      limit: FREE_DAILY_LIMIT,
      tutorCanUpgrade: false,
    };
  }
}

/**
 * Build a 429 Response for a limit-reached AiQuotaCheckResult.
 * Wire format compatible with existing client-side handlers (LIMIT_REACHED toast in Chat.tsx).
 *
 * tutor_can_upgrade signals to the frontend that the limit could be raised to 50/day if the
 * student's tutor upgrades to AI-старт — surface as an upgrade nudge in the toast.
 */
export function buildLimitReachedResponse(
  result: AiQuotaCheckResult,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: "limit_reached",
      message: `Вы достигли дневного лимита в ${result.limit} сообщений. Оформите подписку для безлимитного доступа!`,
      messages_used: result.messagesUsed,
      limit: result.limit,
      isPremium: result.isPremium,
      tutor_can_upgrade: result.tutorCanUpgrade,
    }),
    {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
