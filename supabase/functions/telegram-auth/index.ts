import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

async function verifyTelegramAuth(data: TelegramAuthData, botToken: string): Promise<boolean> {
  const encoder = new TextEncoder();
  
  // Create check string from all fields except hash
  const checkArr: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'hash' && value !== undefined) {
      checkArr.push(`${key}=${value}`);
    }
  }
  checkArr.sort();
  const checkString = checkArr.join('\n');
  
  // Create secret key: SHA256(bot_token)
  const secretKey = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(botToken)
  );
  
  // Create HMAC-SHA256
  const key = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(checkString)
  );
  
  // Convert to hex
  const hashArray = Array.from(new Uint8Array(signature));
  const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return computedHash === data.hash;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const telegramData: TelegramAuthData = await req.json();
    console.log('Received Telegram auth data for user:', telegramData.id);

    // Validate required fields
    if (!telegramData.id || !telegramData.hash || !telegramData.auth_date) {
      console.error('Missing required fields');
      return new Response(
        JSON.stringify({ error: 'Missing required Telegram data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check auth_date (not older than 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime - telegramData.auth_date > 300) {
      console.error('Auth data expired');
      return new Response(
        JSON.stringify({ error: 'Auth data expired' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify Telegram hash
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN not configured');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isValid = await verifyTelegramAuth(telegramData, botToken);
    if (!isValid) {
      console.error('Invalid Telegram hash');
      return new Response(
        JSON.stringify({ error: 'Invalid authentication data' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Telegram auth verified successfully');

    // Initialize Supabase admin client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Check if user exists by telegram_user_id
    const { data: existingProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, telegram_username')
      .eq('telegram_user_id', telegramData.id)
      .maybeSingle();

    if (profileError) {
      console.error('Error checking profile:', profileError);
      return new Response(
        JSON.stringify({ error: 'Database error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let userId: string;

    if (existingProfile) {
      // User exists - use their auth id
      userId = existingProfile.id;
      console.log('Found existing user:', userId);

      // Update telegram_username if changed
      if (telegramData.username && telegramData.username !== existingProfile.telegram_username) {
        await supabase
          .from('profiles')
          .update({ telegram_username: telegramData.username })
          .eq('id', userId);
      }
    } else {
      // Create new user
      const email = `telegram_${telegramData.id}@sokrat.local`;
      const password = crypto.randomUUID() + crypto.randomUUID(); // Random secure password
      
      const username = telegramData.username || 
                       telegramData.first_name || 
                       `user_${telegramData.id}`;

      console.log('Creating new user with email:', email);

      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username,
          telegram_user_id: telegramData.id,
          telegram_username: telegramData.username,
        }
      });

      if (authError) {
        console.error('Error creating auth user:', authError);
        return new Response(
          JSON.stringify({ error: 'Failed to create user' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      userId = authData.user.id;

      // Update profile with telegram data (profile is auto-created by trigger)
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          telegram_user_id: telegramData.id,
          telegram_username: telegramData.username,
          registration_source: 'telegram_web'
        })
        .eq('id', userId);

      if (updateError) {
        console.error('Error updating profile:', updateError);
      }

      console.log('Created new user:', userId);
    }

    // Generate session for the user
    const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: `telegram_${telegramData.id}@sokrat.local`,
    });

    if (sessionError || !sessionData) {
      console.error('Error generating session link:', sessionError);
      
      // Fallback: sign in with password (we need to update user password first)
      const newPassword = crypto.randomUUID() + crypto.randomUUID();
      await supabase.auth.admin.updateUserById(userId, { password: newPassword });
      
      // Now sign in
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: `telegram_${telegramData.id}@sokrat.local`,
        password: newPassword,
      });

      if (signInError || !signInData.session) {
        console.error('Error signing in:', signInError);
        return new Response(
          JSON.stringify({ error: 'Failed to create session' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Session created successfully via password');
      return new Response(
        JSON.stringify({ 
          session: signInData.session,
          user: signInData.user
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract token from magic link and exchange for session
    const url = new URL(sessionData.properties.action_link);
    const token = url.searchParams.get('token');
    const type = url.searchParams.get('type');

    if (token && type) {
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: type as any,
      });

      if (verifyError || !verifyData.session) {
        console.error('Error verifying OTP:', verifyError);
        return new Response(
          JSON.stringify({ error: 'Failed to verify session' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Session created successfully via magic link');
      return new Response(
        JSON.stringify({ 
          session: verifyData.session,
          user: verifyData.user
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Failed to generate session' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
