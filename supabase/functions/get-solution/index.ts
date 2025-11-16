import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Supabase Edge Function to fetch solution by ID
 * Used by the Telegram Mini App to load solution details
 */
Deno.serve(async (req) => {
  console.log('🔍 get-solution: Request received');
  console.log('🔍 get-solution: Method:', req.method);
  console.log('🔍 get-solution: URL:', req.url);
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log('🔍 get-solution: Handling CORS preflight');
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get solution ID from request body
    const body = await req.json();
    console.log('🔍 get-solution: Request body:', JSON.stringify(body));
    
    const { id: solutionId } = body;

    if (!solutionId) {
      console.error('❌ get-solution: No solution ID provided');
      throw new Error('Solution ID is required');
    }

    console.log('🔍 get-solution: Looking for solution with ID:', solutionId);

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(solutionId)) {
      console.error('❌ get-solution: Invalid UUID format:', solutionId);
      throw new Error('Invalid solution ID format');
    }

    // Create Supabase client with service role key to bypass RLS
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('❌ get-solution: Missing environment variables');
      throw new Error('Server configuration error');
    }
    
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('🔍 get-solution: Querying database for solution ID:', solutionId);

    // Fetch solution from database
    const { data, error } = await supabaseClient
      .from('solutions')
      .select('*')
      .eq('id', solutionId)
      .single();

    console.log('🔍 get-solution: Database query result:', { 
      hasData: !!data, 
      hasError: !!error,
      error: error?.message,
      solutionId: data?.id,
      problemText: data?.problem_text?.substring(0, 50)
    });

    if (error) {
      console.error('❌ get-solution: Database error:', error);
      throw new Error('Solution not found');
    }

    if (!data) {
      console.error('❌ get-solution: No data returned from database');
      throw new Error('Solution not found');
    }

    console.log('✅ get-solution: Successfully found solution:', {
      id: data.id,
      stepsCount: data.solution_data?.solution_steps?.length || 0,
      hasFinalAnswer: !!data.solution_data?.final_answer
    });

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
    console.error('❌ get-solution: Error:', error);

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
