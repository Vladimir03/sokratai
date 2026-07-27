import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Ops-эндпоинт: перенастраивает webhook БОЕВОГО бота. До 2026-07-27
  // исполнялся БЕЗ какой-либо авторизации — любой, кто знает URL, дёргал
  // Telegram setWebhook (аудит declared-vs-live 2026-07-27).
  // Гард fail-closed и на том же SCHEDULER_SECRET, что у cron-функций
  // (notify-booking и др.) — секрет уже заведён, новых ops-шагов не нужно.
  // Автовызовов у функции нет: ни CI, ни pg_cron, ни клиент её не дёргают,
  // поэтому гард ничего не ломает — только ручной запуск станет с секретом.
  const authHeader = req.headers.get('Authorization');
  const expectedSecret = Deno.env.get('SCHEDULER_SECRET');
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(
      JSON.stringify({
        error: 'Требуется ops-секрет. Вызывать вручную с SCHEDULER_SECRET.',
        code: 'UNAUTHORIZED',
      }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    // Construct webhook URL
    const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`;

    console.log('Setting webhook to:', webhookUrl);

    // Set webhook
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query'],
        }),
      }
    );

    const result = await response.json();
    console.log('Webhook setup result:', result);

    // Get webhook info to verify
    const infoResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
    );
    const webhookInfo = await infoResponse.json();
    console.log('Current webhook info:', webhookInfo);

    return new Response(
      JSON.stringify({
        success: result.ok,
        webhook_url: webhookUrl,
        telegram_response: result,
        webhook_info: webhookInfo,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error setting up webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
