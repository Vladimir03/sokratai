/**
 * Sets up the Telegram webhook for the RAG Competitor Bot.
 * Call once after deploying rag-competitor-bot.
 *
 * Env vars: RAG_BOT_TOKEN, SUPABASE_URL
 */

const RAG_BOT_TOKEN = Deno.env.get("RAG_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    if (!RAG_BOT_TOKEN) throw new Error("RAG_BOT_TOKEN not set");

    const webhookUrl = `${SUPABASE_URL}/functions/v1/rag-competitor-bot`;
    console.log("Setting RAG bot webhook to:", webhookUrl);

    const response = await fetch(
      `https://api.telegram.org/bot${RAG_BOT_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ["message"],
        }),
      }
    );

    const result = await response.json();
    console.log("Webhook result:", result);

    const infoResponse = await fetch(
      `https://api.telegram.org/bot${RAG_BOT_TOKEN}/getWebhookInfo`
    );
    const webhookInfo = await infoResponse.json();

    return new Response(
      JSON.stringify({
        success: result.ok,
        webhook_url: webhookUrl,
        telegram_response: result,
        webhook_info: webhookInfo,
      }),
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
    });
  }
});
