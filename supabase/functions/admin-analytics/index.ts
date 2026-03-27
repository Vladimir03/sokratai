import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    
    // Also check request body if no query params
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
    const endDate = endDateParam ? new Date(endDateParam + "T23:59:59.999Z") : now;
    const startDate = startDateParam 
      ? new Date(startDateParam + "T00:00:00.000Z") 
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const startDateStr = startDate.toISOString();
    const endDateStr = endDate.toISOString();

    // 0. Get tutor user IDs
    const { data: tutorRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "tutor");
    const tutorSet = new Set((tutorRoles || []).map((r: { user_id: string }) => r.user_id));

    // 1. Registration stats by day (with tutor/student split)
    const { data: registrations } = await supabaseAdmin
      .from("profiles")
      .select("id, created_at")
      .gte("created_at", startDateStr)
      .lte("created_at", endDateStr);

    const registrationsByDay: Record<string, { total: number; students: number; tutors: number }> = {};
    registrations?.forEach((r) => {
      const day = r.created_at?.split("T")[0];
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

    // 2. Message activity by day
    const { data: messages } = await supabaseAdmin
      .from("chat_messages")
      .select("created_at, user_id")
      .gte("created_at", startDateStr)
      .lte("created_at", endDateStr);

    const messagesByDay: Record<string, number> = {};
    const uniqueUsersByDay: Record<string, Set<string>> = {};
    
    messages?.forEach((m) => {
      const day = m.created_at?.split("T")[0];
      if (day) {
        messagesByDay[day] = (messagesByDay[day] || 0) + 1;
        if (!uniqueUsersByDay[day]) uniqueUsersByDay[day] = new Set();
        uniqueUsersByDay[day].add(m.user_id);
      }
    });

    // WAU: for each day, count unique users active in the ISO week (Mon-Sun) containing that day
    const getMonday = (dateStr: string) => {
      const d = new Date(dateStr);
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      d.setUTCDate(diff);
      return d.toISOString().split("T")[0];
    };

    // Group unique users by week
    const uniqueUsersByWeek: Record<string, Set<string>> = {};
    Object.entries(uniqueUsersByDay).forEach(([day, users]) => {
      const monday = getMonday(day);
      if (!uniqueUsersByWeek[monday]) uniqueUsersByWeek[monday] = new Set();
      users.forEach((u) => uniqueUsersByWeek[monday].add(u));
    });

    // For each chart day, look up its week
    const wauByDay: Record<string, { total: number; students: number; tutors: number }> = {};
    const processedWeeks = new Set<string>();

    // 3. Cohort retention calculation
    const calculateCohortRetention = async () => {
      // Get all users registered in the selected period
      const { data: cohortUsers } = await supabaseAdmin
        .from("profiles")
        .select("id, created_at")
        .gte("created_at", startDateStr)
        .lte("created_at", endDateStr)
        .order("created_at", { ascending: true });

      if (!cohortUsers || cohortUsers.length === 0) {
        return [];
      }

      // Group users by registration date
      const usersByDate: Record<string, string[]> = {};
      cohortUsers.forEach((user) => {
        const regDate = user.created_at?.split("T")[0];
        if (regDate) {
          if (!usersByDate[regDate]) usersByDate[regDate] = [];
          usersByDate[regDate].push(user.id);
        }
      });

      // Get all messages for these users
      const userIds = cohortUsers.map(u => u.id);
      const { data: allMessages } = await supabaseAdmin
        .from("chat_messages")
        .select("user_id, created_at")
        .in("user_id", userIds);

      // Index messages by user
      const messagesByUser: Record<string, string[]> = {};
      allMessages?.forEach((m) => {
        if (!messagesByUser[m.user_id]) messagesByUser[m.user_id] = [];
        messagesByUser[m.user_id].push(m.created_at);
      });

      // Calculate retention for each cohort date
      const cohortRetention: Array<{
        date: string;
        cohortSize: number;
        d1: { retained: number; rate: number };
        d3: { retained: number; rate: number };
        d7: { retained: number; rate: number };
      }> = [];

      const today = new Date(now.toISOString().split("T")[0]);

      for (const [regDate, users] of Object.entries(usersByDate)) {
        const cohortDate = new Date(regDate);
        const cohortSize = users.length;

        const calcRetention = (retentionDay: number) => {
          const targetDate = new Date(cohortDate.getTime() + retentionDay * 24 * 60 * 60 * 1000);
          
          // Check if enough time has passed for this retention metric
          if (targetDate > today) {
            return { retained: -1, rate: -1 }; // Not yet available
          }

          let retained = 0;
          for (const userId of users) {
            const userMessages = messagesByUser[userId] || [];
            const hasActivity = userMessages.some((msgDate) => {
              const msgDay = msgDate.split("T")[0];
              return msgDay === targetDate.toISOString().split("T")[0];
            });
            if (hasActivity) retained++;
          }

          return {
            retained,
            rate: cohortSize > 0 ? Math.round((retained / cohortSize) * 100) : 0,
          };
        };

        cohortRetention.push({
          date: regDate,
          cohortSize,
          d1: calcRetention(1),
          d3: calcRetention(3),
          d7: calcRetention(7),
        });
      }

      return cohortRetention;
    };

    const cohortRetention = await calculateCohortRetention();

    // 4. Conversion funnel
    const { count: totalRegistered } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startDateStr)
      .lte("created_at", endDateStr);

    const { count: completedOnboarding } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startDateStr)
      .lte("created_at", endDateStr)
      .eq("onboarding_completed", true);

    const { data: usersWithMessages } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .gte("created_at", startDateStr)
      .lte("created_at", endDateStr);

    let sentFirstMessage = 0;
    if (usersWithMessages) {
      for (const user of usersWithMessages) {
        const { count } = await supabaseAdmin
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("role", "user");
        if (count && count > 0) sentFirstMessage++;
      }
    }

    // 5. Summary stats (with tutor/student split)
    const { data: allProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id");
    const totalUsers = allProfiles?.length || 0;
    const totalTutors = allProfiles?.filter((p) => tutorSet.has(p.id)).length || 0;
    const totalStudents = totalUsers - totalTutors;

    const newUsers = registrations?.length || 0;
    const newTutors = registrations?.filter((r) => tutorSet.has(r.id)).length || 0;
    const newStudents = newUsers - newTutors;

    const { count: totalMessages } = await supabaseAdmin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startDateStr)
      .lte("created_at", endDateStr);

    const { count: activeUsersToday } = await supabaseAdmin
      .from("chat_messages")
      .select("user_id", { count: "exact", head: true })
      .gte("created_at", new Date(now.toISOString().split("T")[0]).toISOString());

    // 6. User segments analytics
    const calculateSegments = async () => {
      const nowDate = new Date();
      
      // Get all profiles with subscription info
      const { data: allProfiles } = await supabaseAdmin
        .from("profiles")
        .select("id, subscription_tier, subscription_expires_at, trial_ends_at");

      if (!allProfiles) {
        return {
          premium: { count: 0, avgMessagesPerDay: 0, highlyActive: 0 },
          trial: { count: 0, avgMessagesPerDay: 0, highlyActive: 0 },
          free: { count: 0, avgMessagesPerDay: 0, highlyActive: 0 },
        };
      }

      // Categorize users into segments
      const segments: { premium: string[]; trial: string[]; free: string[] } = {
        premium: [],
        trial: [],
        free: [],
      };

      allProfiles.forEach((profile) => {
        const isPremium = 
          profile.subscription_tier === "premium" && 
          profile.subscription_expires_at && 
          new Date(profile.subscription_expires_at) > nowDate;
        
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

      // Get messages from last 7 days for daily averages
      const sevenDaysAgo = new Date(nowDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const { data: recentMessages } = await supabaseAdmin
        .from("chat_messages")
        .select("user_id, created_at")
        .eq("role", "user")
        .gte("created_at", sevenDaysAgo);

      // Count messages per user per day
      const userDailyMessages: Record<string, Record<string, number>> = {};
      
      recentMessages?.forEach((m) => {
        const userId = m.user_id;
        const day = m.created_at?.split("T")[0];
        if (userId && day) {
          if (!userDailyMessages[userId]) userDailyMessages[userId] = {};
          userDailyMessages[userId][day] = (userDailyMessages[userId][day] || 0) + 1;
        }
      });

      // Calculate metrics for each segment
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
            const avgPerDay = totalMsgs / days.length;
            
            totalDailyMessages += totalMsgs;
            totalDays += days.length;
            
            // Check if user has 8+ messages on any day
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

    // 7. Top 10 active users for the period
    const calculateTopUsers = async () => {
      const nowDate = new Date();
      const daysDiff = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

      // Get user message counts for the period
      const { data: userMessages } = await supabaseAdmin
        .from("chat_messages")
        .select("user_id")
        .eq("role", "user")
        .gte("created_at", startDateStr)
        .lte("created_at", endDateStr);

      if (!userMessages || userMessages.length === 0) {
        return [];
      }

      // Count messages per user
      const messageCounts: Record<string, number> = {};
      userMessages.forEach((m) => {
        messageCounts[m.user_id] = (messageCounts[m.user_id] || 0) + 1;
      });

      // Sort and get top 10 user IDs
      const sortedUsers = Object.entries(messageCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      const topUserIds = sortedUsers.map(([id]) => id);

      if (topUserIds.length === 0) {
        return [];
      }

      // Get profile info for top users
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, username, telegram_username, subscription_tier, subscription_expires_at, trial_ends_at")
        .in("id", topUserIds);

      if (!profiles) {
        return [];
      }

      // Create a map for quick profile lookup
      const profileMap = new Map(profiles.map((p) => [p.id, p]));

      // Build top users array with segment info
      return sortedUsers.map(([userId, messageCount]) => {
        const profile = profileMap.get(userId);
        if (!profile) {
          return null;
        }

        // Determine segment
        const isPremium = 
          profile.subscription_tier === "premium" && 
          profile.subscription_expires_at && 
          new Date(profile.subscription_expires_at) > nowDate;
        
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

    // Prepare chart data - iterate through all days in the range
    const chartDays: string[] = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      chartDays.push(currentDate.toISOString().split("T")[0]);
      currentDate.setDate(currentDate.getDate() + 1);
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
        registered: newUsers || 0,
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
