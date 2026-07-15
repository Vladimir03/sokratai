/**
 * admin-analytics — данные вкладки «Аналитика» в /admin.
 *
 * Аудит формул 2026-07-15 (запрос владельца) — исправлено:
 * 1. «Активных сегодня» считало СТРОКИ сообщений, а не уникальных пользователей.
 * 2. Активность считалась ТОЛЬКО по AI-чату ученика (chat_messages) — работа в
 *    ДЗ (guided-треды) была невидима; теперь активность = сообщения пользователя
 *    в AI-чате + сообщения ученика/репетитора в тредах ДЗ (author_user_id).
 * 3. Воронка «отправил первое сообщение» делала N+1 запросов (по одному на
 *    пользователя) — теперь одна chunked-выборка, объединённая с ретеншном.
 * 4. Все выборки строк — с пагинацией (PostgREST молча режет на 1000 строк —
 *    сообщения за неделю уже превышали лимит → тихий недосчёт).
 * 5. Premium-сегмент требовал непустой subscription_expires_at — «Премиум
 *    (бессрочно)» (ручные гранты) падал в free/trial.
 * 6. «Сообщений за период» считало и ответы AI (каждое сообщение юзера ×2) —
 *    теперь только сообщения пользователей.
 *
 * Ревью ChatGPT-5.6 (2026-07-15) — дополнительно исправлено:
 * 7. Ретеншн/воронка исключают placeholder-учеников, заведённых репетитором
 *    вручную (registration_source='manual') — их created_at = дата заведения
 *    карточки, а не начала использования, и они хоронили D1/D7.
 * 8. Когорта считалась зрелой в ЕЩЁ ИДУЩИЙ целевой день (target == today) —
 *    теперь `-1` («рано») и для него.
 * 9. Все календарные бакеты («сегодня», дни графиков, дни ретеншна) — по
 *    МОСКОВСКОМУ времени (UTC+3, без DST), не UTC: фаундер и все пользователи в РФ.
 * 10. Пагинация — со стабильным order (offset-страницы без него могут
 *     дублировать/терять строки); user_roles тоже пагинируется.
 *
 * Определения метрик (для tooltips фронта — держать в синхроне):
 * - Активность = сообщение пользователя в AI-чате (chat_messages, role='user')
 *   ИЛИ сообщение в треде ДЗ (homework_tutor_thread_messages, role∈{user,tutor},
 *   по author_user_id). Чат репетитор↔ученик пока не учитывается.
 * - WAU — уникальные активные за ISO-неделю (пн–вс, МСК); крайние недели
 *   диапазона могут быть неполными.
 * - Ретеншн D1/D3/D7 — активность РОВНО в день N после регистрации (bounded
 *   day-N, МСК-дни), только само-зарегистрированные.
 * - Новые за период — все строки profiles, включая manual-placeholder'ов
 *   (в графике регистраций они есть; в ретеншне/воронке — нет).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAGE = 1000;

/** Москва = UTC+3 круглый год (без DST) — безопасная константа. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Календарный день (YYYY-MM-DD) метки времени в московском времени. */
function mskDay(iso: string): string {
  return new Date(new Date(iso).getTime() + MSK_OFFSET_MS).toISOString().split("T")[0];
}

/** PostgREST режет ответ на 1000 строк — читаем до конца пагинацией. */
async function fetchAll<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

/** .in()-выборка чанками по 100 id (лимит длины URL) + пагинация каждого чанка. */
async function fetchAllIn<T>(
  ids: string[],
  makeQuery: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const chunkRows = await fetchAll<T>((from, to) => makeQuery(chunk, from, to), label);
    rows.push(...chunkRows);
  }
  return rows;
}

interface ChatMsgRow {
  user_id: string;
  role: string;
  created_at: string;
}

interface HwMsgRow {
  author_user_id: string | null;
  role: string;
  created_at: string;
}

/** Активность пользователя: {userId, day (YYYY-MM-DD), createdAt}. */
interface ActivityEvent {
  userId: string;
  createdAt: string;
}

/** Сообщения пользователей за период из обоих источников (AI-чат + треды ДЗ). */
async function fetchActivityInRange(
  db: SupabaseClient,
  startIso: string,
  endIso: string,
): Promise<ActivityEvent[]> {
  const [chatMsgs, hwMsgs] = await Promise.all([
    fetchAll<ChatMsgRow>(
      (from, to) =>
        db
          .from("chat_messages")
          .select("user_id, role, created_at")
          .eq("role", "user")
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("id")
          .range(from, to),
      "chat_messages_range",
    ),
    fetchAll<HwMsgRow>(
      (from, to) =>
        db
          .from("homework_tutor_thread_messages")
          .select("author_user_id, role, created_at")
          .in("role", ["user", "tutor"])
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("id")
          .range(from, to),
      "hw_messages_range",
    ),
  ]);
  const events: ActivityEvent[] = [];
  for (const m of chatMsgs) events.push({ userId: m.user_id, createdAt: m.created_at });
  for (const m of hwMsgs) {
    if (m.author_user_id) events.push({ userId: m.author_user_id, createdAt: m.created_at });
  }
  return events;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create client with user's token to verify auth
    const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin access using service role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: isAdmin } = await supabaseAdmin.rpc("is_admin", { _user_id: user.id });

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden: Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Support both query params and request body
    const url = new URL(req.url);
    let startDateParam = url.searchParams.get("startDate");
    let endDateParam = url.searchParams.get("endDate");

    if (!startDateParam && !endDateParam) {
      try {
        const body = await req.json();
        startDateParam = body.startDate || null;
        endDateParam = body.endDate || null;
      } catch {
        // No body or invalid JSON, use defaults
      }
    }

    const now = new Date();
    // Параметры дат — календарные дни ФАУНДЕРА (МСК): границы суток строим в +03:00
    const endDate = endDateParam ? new Date(endDateParam + "T23:59:59.999+03:00") : now;
    const startDate = startDateParam
      ? new Date(startDateParam + "T00:00:00.000+03:00")
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const startDateStr = startDate.toISOString();
    const endDateStr = endDate.toISOString();

    // 0. Tutor user IDs (пагинировано — >1000 ролей молча теряло бы репетиторов)
    const tutorRoles = await fetchAll<{ user_id: string }>(
      (from, to) =>
        supabaseAdmin
          .from("user_roles")
          .select("user_id")
          .eq("role", "tutor")
          .order("user_id")
          .range(from, to),
      "user_roles",
    );
    const tutorSet = new Set(tutorRoles.map((r) => r.user_id));

    // 1. Registrations in range (paginated; registration_source — для фильтра
    // manual-placeholder'ов из когорт ретеншна/воронки)
    const registrations = await fetchAll<{ id: string; created_at: string | null; registration_source: string | null }>(
      (from, to) =>
        supabaseAdmin
          .from("profiles")
          .select("id, created_at, registration_source")
          .gte("created_at", startDateStr)
          .lte("created_at", endDateStr)
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to),
      "profiles_range",
    );

    const registrationsByDay: Record<string, { total: number; students: number; tutors: number }> = {};
    registrations.forEach((r) => {
      const day = r.created_at ? mskDay(r.created_at) : null;
      if (day) {
        if (!registrationsByDay[day]) registrationsByDay[day] = { total: 0, students: 0, tutors: 0 };
        registrationsByDay[day].total++;
        if (tutorSet.has(r.id)) {
          registrationsByDay[day].tutors++;
        } else {
          registrationsByDay[day].students++;
        }
      }
    });

    // 2. Активность за период: сообщения пользователей (AI-чат + треды ДЗ)
    const activityEvents = await fetchActivityInRange(supabaseAdmin, startDateStr, endDateStr);

    const messagesByDay: Record<string, number> = {};
    const uniqueUsersByDay: Record<string, Set<string>> = {};
    activityEvents.forEach((ev) => {
      const day = mskDay(ev.createdAt);
      messagesByDay[day] = (messagesByDay[day] || 0) + 1;
      if (!uniqueUsersByDay[day]) uniqueUsersByDay[day] = new Set();
      uniqueUsersByDay[day].add(ev.userId);
    });

    // WAU: ISO-неделя (пн–вс)
    const getMonday = (dateStr: string) => {
      const d = new Date(dateStr);
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      d.setUTCDate(diff);
      return d.toISOString().split("T")[0];
    };

    const uniqueUsersByWeek: Record<string, Set<string>> = {};
    Object.entries(uniqueUsersByDay).forEach(([day, users]) => {
      const monday = getMonday(day);
      if (!uniqueUsersByWeek[monday]) uniqueUsersByWeek[monday] = new Set();
      users.forEach((u) => uniqueUsersByWeek[monday].add(u));
    });

    const wauByDay: Record<string, { total: number; students: number; tutors: number }> = {};
    const processedWeeks = new Set<string>();

    // 3–4. Ретеншн когорт + воронка «первое сообщение» — ОДНА all-time выборка
    // активности когортных пользователей (было: N+1 запросов в воронке).
    // Manual-placeholder'ы (заведены репетитором) ИСКЛЮЧЕНЫ: их created_at —
    // дата заведения карточки, не начала использования (ревью P0 #3).
    const selfRegistered = registrations.filter((r) => r.registration_source !== "manual");
    const cohortUserIds = selfRegistered.map((r) => r.id);
    const allTimeActivityByUser: Record<string, string[]> = {};
    if (cohortUserIds.length > 0) {
      const [cohortChat, cohortHw] = await Promise.all([
        fetchAllIn<ChatMsgRow>(
          cohortUserIds,
          (chunk, from, to) =>
            supabaseAdmin
              .from("chat_messages")
              .select("user_id, role, created_at")
              .eq("role", "user")
              .in("user_id", chunk)
              .order("id")
              .range(from, to),
          "chat_messages_cohort",
        ),
        fetchAllIn<HwMsgRow>(
          cohortUserIds,
          (chunk, from, to) =>
            supabaseAdmin
              .from("homework_tutor_thread_messages")
              .select("author_user_id, role, created_at")
              .in("role", ["user", "tutor"])
              .in("author_user_id", chunk)
              .order("id")
              .range(from, to),
          "hw_messages_cohort",
        ),
      ]);
      for (const m of cohortChat) {
        (allTimeActivityByUser[m.user_id] ||= []).push(m.created_at);
      }
      for (const m of cohortHw) {
        if (!m.author_user_id) continue;
        (allTimeActivityByUser[m.author_user_id] ||= []).push(m.created_at);
      }
    }

    // Retention: активность РОВНО в день N после регистрации (bounded day-N,
    // МСК-дни; только self-registered). Когорта считается зрелой ТОЛЬКО после
    // завершения целевого дня (`>=` — ревью P1 #6: день ещё идёт → «рано»).
    const usersByDate: Record<string, string[]> = {};
    selfRegistered.forEach((r) => {
      const regDate = r.created_at ? mskDay(r.created_at) : null;
      if (regDate) {
        (usersByDate[regDate] ||= []).push(r.id);
      }
    });

    const todayMsk = mskDay(now.toISOString());
    const cohortRetention = Object.entries(usersByDate).map(([regDate, users]) => {
      const cohortSize = users.length;

      const calcRetention = (retentionDay: number) => {
        // Дата-арифметика на UTC-полночи МСК-лейбла — даёт следующий МСК-лейбл
        const target = new Date(new Date(regDate).getTime() + retentionDay * 24 * 60 * 60 * 1000);
        const targetDay = target.toISOString().split("T")[0];
        if (targetDay >= todayMsk) {
          return { retained: -1, rate: -1 }; // целевой день не завершён — рано
        }
        let retained = 0;
        for (const userId of users) {
          const userActivity = allTimeActivityByUser[userId] || [];
          if (userActivity.some((ts) => mskDay(ts) === targetDay)) retained++;
        }
        return {
          retained,
          rate: cohortSize > 0 ? Math.round((retained / cohortSize) * 100) : 0,
        };
      };

      return {
        date: regDate,
        cohortSize,
        d1: calcRetention(1),
        d3: calcRetention(3),
        d7: calcRetention(7),
      };
    });

    // Funnel
    const { count: completedOnboarding, error: onboardingError } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startDateStr)
      .lte("created_at", endDateStr)
      .eq("onboarding_completed", true);
    if (onboardingError) throw new Error(`onboarding: ${onboardingError.message}`);

    const sentFirstMessage = cohortUserIds.filter(
      (id) => (allTimeActivityByUser[id]?.length ?? 0) > 0,
    ).length;

    // 5. Summary stats
    const allProfiles = await fetchAll<{ id: string }>(
      (from, to) => supabaseAdmin.from("profiles").select("id").order("id").range(from, to),
      "profiles_all",
    );
    const totalUsers = allProfiles.length;
    const totalTutors = allProfiles.filter((p) => tutorSet.has(p.id)).length;
    const totalStudents = totalUsers - totalTutors;

    const newUsers = registrations.length;
    const newTutors = registrations.filter((r) => tutorSet.has(r.id)).length;
    const newStudents = newUsers - newTutors;

    // Сообщений за период = сообщения ПОЛЬЗОВАТЕЛЕЙ (без ответов AI), оба источника
    const totalMessages = activityEvents.length;

    // Активных сегодня = УНИКАЛЬНЫЕ пользователи с активностью с начала МОСКОВСКИХ суток
    const todayStartIso = new Date(todayMsk + "T00:00:00.000+03:00").toISOString();
    const todayEvents = await fetchActivityInRange(supabaseAdmin, todayStartIso, now.toISOString());
    const activeUsersToday = new Set(todayEvents.map((ev) => ev.userId)).size;

    // 6. Сегменты (premium: NULL expires = бессрочный премиум, mirror admin_list_tutor_plans)
    const calculateSegments = async () => {
      const nowDate = new Date();

      const segProfiles = await fetchAll<{
        id: string;
        subscription_tier: string | null;
        subscription_expires_at: string | null;
        trial_ends_at: string | null;
      }>(
        (from, to) =>
          supabaseAdmin
            .from("profiles")
            .select("id, subscription_tier, subscription_expires_at, trial_ends_at")
            .order("id")
            .range(from, to),
        "profiles_segments",
      );

      const segments: { premium: string[]; trial: string[]; free: string[] } = {
        premium: [],
        trial: [],
        free: [],
      };

      segProfiles.forEach((profile) => {
        const isPremium =
          profile.subscription_tier === "premium" &&
          (profile.subscription_expires_at == null ||
            new Date(profile.subscription_expires_at) > nowDate);

        const isTrial =
          !isPremium &&
          profile.trial_ends_at &&
          new Date(profile.trial_ends_at) > nowDate;

        if (isPremium) {
          segments.premium.push(profile.id);
        } else if (isTrial) {
          segments.trial.push(profile.id);
        } else {
          segments.free.push(profile.id);
        }
      });

      // Активность за 7 дней (оба источника) для средних
      const sevenDaysAgo = new Date(nowDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentEvents = await fetchActivityInRange(supabaseAdmin, sevenDaysAgo, nowDate.toISOString());

      const userDailyMessages: Record<string, Record<string, number>> = {};
      recentEvents.forEach((ev) => {
        const day = ev.createdAt.split("T")[0];
        if (!userDailyMessages[ev.userId]) userDailyMessages[ev.userId] = {};
        userDailyMessages[ev.userId][day] = (userDailyMessages[ev.userId][day] || 0) + 1;
      });

      const calculateSegmentMetrics = (userIds: string[]) => {
        if (userIds.length === 0) {
          return { count: 0, avgMessagesPerDay: 0, highlyActive: 0 };
        }

        let totalDailyMessages = 0;
        let totalDays = 0;
        let highlyActive = 0;

        userIds.forEach((userId) => {
          const dailyData = userDailyMessages[userId] || {};
          const days = Object.keys(dailyData);

          if (days.length > 0) {
            const totalMsgs = Object.values(dailyData).reduce((a, b) => a + b, 0);
            totalDailyMessages += totalMsgs;
            totalDays += days.length;

            const hasHighActivity = Object.values(dailyData).some((count) => count >= 8);
            if (hasHighActivity) highlyActive++;
          }
        });

        const avgMessagesPerDay = totalDays > 0 ? totalDailyMessages / totalDays : 0;

        return {
          count: userIds.length,
          avgMessagesPerDay: Math.round(avgMessagesPerDay * 10) / 10,
          highlyActive,
        };
      };

      return {
        premium: calculateSegmentMetrics(segments.premium),
        trial: calculateSegmentMetrics(segments.trial),
        free: calculateSegmentMetrics(segments.free),
      };
    };

    const segmentsData = await calculateSegments();

    // 7. Топ-10 активных за период (активность = оба источника)
    const calculateTopUsers = async () => {
      const nowDate = new Date();
      const daysDiff = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

      if (activityEvents.length === 0) return [];

      const messageCounts: Record<string, number> = {};
      activityEvents.forEach((ev) => {
        messageCounts[ev.userId] = (messageCounts[ev.userId] || 0) + 1;
      });

      const sortedUsers = Object.entries(messageCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      const topUserIds = sortedUsers.map(([id]) => id);
      if (topUserIds.length === 0) return [];

      const { data: profiles, error: topProfilesError } = await supabaseAdmin
        .from("profiles")
        .select("id, username, telegram_username, subscription_tier, subscription_expires_at, trial_ends_at")
        .in("id", topUserIds);
      if (topProfilesError) throw new Error(`profiles_top: ${topProfilesError.message}`);
      if (!profiles) return [];

      const profileMap = new Map(profiles.map((p) => [p.id, p]));

      return sortedUsers.map(([userId, messageCount]) => {
        const profile = profileMap.get(userId);
        if (!profile) {
          return null;
        }

        const isPremium =
          profile.subscription_tier === "premium" &&
          (profile.subscription_expires_at == null ||
            new Date(profile.subscription_expires_at) > nowDate);

        const isTrial =
          !isPremium &&
          profile.trial_ends_at &&
          new Date(profile.trial_ends_at) > nowDate;

        const segment = isPremium ? "premium" : isTrial ? "trial" : "free";

        return {
          id: profile.id,
          username: profile.username || "Unknown",
          telegramUsername: profile.telegram_username || null,
          segment,
          messageCount,
          avgPerDay: Math.round((messageCount / daysDiff) * 10) / 10,
        };
      }).filter(Boolean);
    };

    const topUsersData = await calculateTopUsers();

    // Prepare chart data — все дни диапазона как МОСКОВСКИЕ календарные лейблы
    const chartDays: string[] = [];
    const startDayMsk = mskDay(startDate.toISOString());
    const endDayMsk = mskDay(endDate.toISOString());
    for (const d = new Date(startDayMsk); ; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().split("T")[0];
      if (key > endDayMsk) break;
      chartDays.push(key);
    }

    const registrationsChart = chartDays.map(day => {
      const d = registrationsByDay[day];
      return {
        date: day,
        value: d?.total || 0,
        students: d?.students || 0,
        tutors: d?.tutors || 0,
      };
    });

    const messagesChart = chartDays.map(day => ({
      date: day,
      value: messagesByDay[day] || 0,
    }));

    // WAU chart: compute per-week, assign to Monday of each week
    chartDays.forEach((day) => {
      const monday = getMonday(day);
      if (!processedWeeks.has(monday)) {
        processedWeeks.add(monday);
        const weekUsers = uniqueUsersByWeek[monday] || new Set<string>();
        let tutors = 0;
        let students = 0;
        weekUsers.forEach((uid) => {
          if (tutorSet.has(uid)) tutors++;
          else students++;
        });
        wauByDay[monday] = { total: weekUsers.size, students, tutors };
      }
    });

    const wauChart = [...processedWeeks].sort().map(monday => ({
      date: monday,
      value: wauByDay[monday]?.total || 0,
      students: wauByDay[monday]?.students || 0,
      tutors: wauByDay[monday]?.tutors || 0,
    }));

    const analytics = {
      summary: {
        totalUsers: totalUsers || 0,
        totalTutors,
        totalStudents,
        newUsers: newUsers || 0,
        newTutors,
        newStudents,
        totalMessages: totalMessages || 0,
        activeUsersToday: activeUsersToday || 0,
      },
      registrations: registrationsChart,
      messages: messagesChart,
      wau: wauChart,
      cohortRetention,
      funnel: {
        // Только self-registered — иначе manual-placeholder'ы раздували знаменатель,
        // а sentFirstMessage считался по очищенной когорте (несопоставимо)
        registered: selfRegistered.length,
        completedOnboarding: completedOnboarding || 0,
        sentFirstMessage,
      },
      segments: segmentsData,
      topUsers: topUsersData,
    };

    return new Response(JSON.stringify(analytics), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
