import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Temporary edge function to check solutions table
 * This is for debugging purposes only
 */
Deno.serve(async (req) => {
  console.log('🔍 check-solutions: Request received');

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role key to bypass RLS
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing environment variables');
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('🔍 Fetching last 5 solutions...');

    // Fetch last 5 solutions
    const { data: solutions, error } = await supabaseClient
      .from('solutions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('❌ Database error:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    if (!solutions || solutions.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No solutions found in database',
          count: 0,
          solutions: []
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`✅ Found ${solutions.length} solutions`);

    // Process solutions to extract key info
    const processedSolutions = solutions.map(solution => {
      const solutionData = solution.solution_data as any;

      return {
        id: solution.id,
        created_at: solution.created_at,
        problem_text: solution.problem_text,
        telegram_user_id: solution.telegram_user_id,
        data_structure: {
          has_solution_data: !!solutionData,
          keys: solutionData ? Object.keys(solutionData) : [],
          steps_count: solutionData?.solution_steps?.length || 0,
          has_final_answer: !!solutionData?.final_answer,
          final_answer: solutionData?.final_answer,
          first_step: solutionData?.solution_steps?.[0] ? {
            number: solutionData.solution_steps[0].number,
            title: solutionData.solution_steps[0].title,
            has_content: !!solutionData.solution_steps[0].content,
            content_preview: solutionData.solution_steps[0].content?.substring(0, 100),
            has_formula: !!solutionData.solution_steps[0].formula,
            formula: solutionData.solution_steps[0].formula,
            method: solutionData.solution_steps[0].method
          } : null,
          all_step_titles: solutionData?.solution_steps?.map((s: any) => s.title) || []
        }
      };
    });

    return new Response(
      JSON.stringify({
        success: true,
        count: solutions.length,
        solutions: processedSolutions
      }, null, 2),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('❌ Error:', error);

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
