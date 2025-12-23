import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // 1. Registration stats by day
    const { data: registrations } = await supabaseAdmin
      .from("profiles")
      .select("created_at")
      .gte("created_at", startDateStr)
      .lte("created_at", endDateStr);

    const registrationsByDay: Record<string, number> = {};
    registrations?.forEach((r) => {
      const day = r.created_at?.split("T")[0];
      if (day) registrationsByDay[day] = (registrationsByDay[day] || 0) + 1;
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

    const dauByDay: Record<string, number> = {};
    Object.entries(uniqueUsersByDay).forEach(([day, users]) => {
      dauByDay[day] = users.size;
    });

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

    // 5. Summary stats
    const { count: totalUsers } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });

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

    // Prepare chart data - iterate through all days in the range
    const chartDays: string[] = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      chartDays.push(currentDate.toISOString().split("T")[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const registrationsChart = chartDays.map(day => ({
      date: day,
      value: registrationsByDay[day] || 0,
    }));

    const messagesChart = chartDays.map(day => ({
      date: day,
      value: messagesByDay[day] || 0,
    }));

    const dauChart = chartDays.map(day => ({
      date: day,
      value: dauByDay[day] || 0,
    }));

    const analytics = {
      summary: {
        totalUsers: totalUsers || 0,
        newUsers: totalRegistered || 0,
        totalMessages: totalMessages || 0,
        activeUsersToday: activeUsersToday || 0,
      },
      registrations: registrationsChart,
      messages: messagesChart,
      dau: dauChart,
      cohortRetention,
      funnel: {
        registered: totalRegistered || 0,
        completedOnboarding: completedOnboarding || 0,
        sentFirstMessage,
      },
      segments: segmentsData,
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
