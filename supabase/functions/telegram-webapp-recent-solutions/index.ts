import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function verifyInitData(initData: string, botToken: string): Promise<{
  userId: number;
  authDate: number | null;
} | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) return null;

  const dataCheckParts: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    dataCheckParts.push(`${key}=${value}`);
  }

  dataCheckParts.sort();
  const dataCheckString = dataCheckParts.join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode(botToken), "WebAppData");
  const signature = await hmacSha256(secretKey, dataCheckString);
  const calculatedHash = bufferToHex(signature);

  if (calculatedHash !== hash) {
    return null;
  }

  const userRaw = params.get("user");
  if (!userRaw) return null;

  let user: { id: number } | null = null;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return null;
  }

  const authDate = params.get("auth_date");
  const authDateNum = authDate ? Number(authDate) : null;
  if (authDateNum && Number.isNaN(authDateNum)) {
    return null;
  }

  return { userId: user.id, authDate: authDateNum };
}

function makePreview(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 120) return cleaned;
  return `${cleaned.slice(0, 117)}...`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { initData } = await req.json();
    if (!initData || typeof initData !== "string") {
      return new Response(JSON.stringify({ error: "initData is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verified = await verifyInitData(initData, TELEGRAM_BOT_TOKEN);
    if (!verified) {
      return new Response(JSON.stringify({ error: "Invalid initData" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userId } = verified;

    const { data, error } = await supabase
      .from("solutions")
      .select("id, created_at, problem_text, solution_data")
      .eq("telegram_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8);

    if (error) {
      console.error("Failed to load recent solutions:", error);
      return new Response(JSON.stringify({ error: "Failed to load solutions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const solutions = (data || []).map((row: any) => ({
      id: row.id,
      created_at: row.created_at,
      problem_preview: makePreview(row.problem_text || row.solution_data?.problem || "Задача"),
      subject: row.solution_data?.subject ?? null,
    }));

    return new Response(JSON.stringify({ solutions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("telegram-webapp-recent-solutions error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
