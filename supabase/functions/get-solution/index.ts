import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Supabase Edge Function to fetch solution by ID
 * Used by the Telegram Mini App to load solution details
 */
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get solution ID from query parameters
    const url = new URL(req.url);
    const solutionId = url.searchParams.get('id');

    if (!solutionId) {
      throw new Error('Solution ID is required');
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(solutionId)) {
      throw new Error('Invalid solution ID format');
    }

    // Create Supabase client with service role key to bypass RLS
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch solution from database
    const { data, error } = await supabaseClient
      .from('solutions')
      .select('*')
      .eq('id', solutionId)
      .single();

    if (error) {
      console.error('Database error:', error);
      throw new Error('Solution not found');
    }

    if (!data) {
      throw new Error('Solution not found');
    }

    // Return solution data
    return new Response(
      JSON.stringify({
        success: true,
        data: data
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error fetching solution:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
