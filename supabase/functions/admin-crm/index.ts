import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const { data: isAdmin } = await admin.rpc("is_admin", {
      _user_id: userData.user.id,
    });
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action: string = body.action || "list";

    if (action === "list") {
      const limit = Math.min(Number(body.limit) || 500, 1000);

      // 1. Pull all chats (newest first by updated_at), limited.
      const { data: chats, error: chatsErr } = await admin
        .from("chats")
        .select("id, title, chat_type, last_message_at, created_at, updated_at, user_id")
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (chatsErr) throw chatsErr;
      if (!chats?.length) return json({ chats: [] });

      const chatIds = chats.map((c) => c.id);

      // 2. Aggregates per chat: count of user messages + last message time.
      // Pull only the columns we need; service-role bypasses RLS.
      // Cap at 50k rows — for far larger volumes we'd need a SQL aggregate.
      const { data: messages, error: msgErr } = await admin
        .from("chat_messages")
        .select("chat_id, role, created_at")
        .in("chat_id", chatIds)
        .order("created_at", { ascending: false })
        .limit(50000);
      if (msgErr) throw msgErr;

      const userCount: Record<string, number> = {};
      const lastMessageAt: Record<string, string> = {};
      messages?.forEach((m) => {
        if (!m.chat_id) return;
        if (m.role === "user") {
          userCount[m.chat_id] = (userCount[m.chat_id] || 0) + 1;
        }
        if (!lastMessageAt[m.chat_id] && m.created_at) {
          lastMessageAt[m.chat_id] = m.created_at;
        }
      });

      const chatsWithMessages = chats.filter((c) => (userCount[c.id] || 0) >= 1);
      const userIds = [...new Set(chatsWithMessages.map((c) => c.user_id))];

      const { data: profiles } = userIds.length
        ? await admin
            .from("profiles")
            .select("id, username, telegram_username, grade")
            .in("id", userIds)
        : { data: [] as Array<{ id: string; username: string | null; telegram_username: string | null; grade: number | null }> };

      const profilesMap = new Map(profiles?.map((p) => [p.id, p]) || []);

      const result = chatsWithMessages.map((c) => ({
        ...c,
        message_count: userCount[c.id] || 0,
        actual_last_message: lastMessageAt[c.id] || c.updated_at,
        user: profilesMap.get(c.user_id) ?? null,
      }));

      result.sort(
        (a, b) =>
          Date.parse(b.actual_last_message) - Date.parse(a.actual_last_message),
      );

      return json({ chats: result });
    }

    if (action === "messages") {
      const chatId: string | undefined = body.chatId;
      if (!chatId) return json({ error: "chatId required" }, 400);

      const { data: messages, error: msgErr } = await admin
        .from("chat_messages")
        .select("id, role, content, created_at, image_url, image_path")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });
      if (msgErr) throw msgErr;

      // Resolve signed URLs for image_path entries.
      const out = await Promise.all(
        (messages || []).map(async (m) => {
          if (m.image_path) {
            const { data: signed } = await admin.storage
              .from("chat-images")
              .createSignedUrl(m.image_path, 3600);
            return { ...m, signedImageUrl: signed?.signedUrl ?? null };
          }
          return { ...m, signedImageUrl: null };
        }),
      );

      return json({ messages: out });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("admin-crm error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  }
});
