import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

function supabaseForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "get_current_user",
  title: "Get current user",
  description:
    "Return the signed-in Сократ AI user's profile (id, email, role). Useful as a first call to confirm authentication and detect the user's role (student / tutor / admin).",
  inputSchema: {},
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return {
        content: [{ type: "text", text: "Not authenticated." }],
        isError: true,
      };
    }
    const userId = ctx.getUserId();
    const email = ctx.getUserEmail() ?? null;
    const db = supabaseForUser(ctx);

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, full_name, role, telegram_user_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      return {
        content: [{ type: "text", text: `Profile lookup failed: ${profileError.message}` }],
        isError: true,
      };
    }

    const { data: roles } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    const payload = {
      user_id: userId,
      email,
      profile: profile ?? null,
      roles: (roles ?? []).map((r: { role: string }) => r.role),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});