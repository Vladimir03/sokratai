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

    const url = new URL(req.url);
    const daysParam = url.searchParams.get("days") || "7";
    const days = parseInt(daysParam, 10);

    // Get analytics data
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const startDateStr = startDate.toISOString();

    // 1. Registration stats by day
    const { data: registrations } = await supabaseAdmin
      .from("profiles")
      .select("created_at")
      .gte("created_at", startDateStr);

    const registrationsByDay: Record<string, number> = {};
    registrations?.forEach((r) => {
      const day = r.created_at?.split("T")[0];
      if (day) registrationsByDay[day] = (registrationsByDay[day] || 0) + 1;
    });

    // 2. Message activity by day
    const { data: messages } = await supabaseAdmin
      .from("chat_messages")
      .select("created_at, user_id")
      .gte("created_at", startDateStr);

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
      .gte("created_at", startDateStr);

    const { count: completedOnboarding } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startDateStr)
      .eq("onboarding_completed", true);

    const { data: usersWithMessages } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .gte("created_at", startDateStr);

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
      .gte("created_at", startDateStr);

    const { count: activeUsersToday } = await supabaseAdmin
      .from("chat_messages")
      .select("user_id", { count: "exact", head: true })
      .gte("created_at", new Date(now.toISOString().split("T")[0]).toISOString());

    // Prepare chart data
    const chartDays: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      chartDays.push(d.toISOString().split("T")[0]);
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
