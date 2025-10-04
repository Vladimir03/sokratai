-- Fix PUBLIC_DATA_EXPOSURE: Create view without answers and update RLS
CREATE VIEW public.problems_public AS
SELECT id, question, topic, level, created_at
FROM public.problems;

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Anyone can view problems" ON public.problems;

-- Create restrictive policy on problems table
CREATE POLICY "Users cannot view problems directly" 
ON public.problems 
FOR SELECT 
USING (false);

-- Add explicit write policies for clarity (using WITH CHECK for INSERT)
CREATE POLICY "Problems are read-only for users" 
ON public.problems 
FOR INSERT 
WITH CHECK (false);

CREATE POLICY "Problems cannot be updated by users" 
ON public.problems 
FOR UPDATE 
USING (false);

CREATE POLICY "Problems cannot be deleted by users" 
ON public.problems 
FOR DELETE 
USING (false);

-- Create a secure function to validate answers server-side
CREATE OR REPLACE FUNCTION public.check_problem_answer(
  problem_id_input UUID,
  user_answer_input TEXT
)
RETURNS TABLE(is_correct BOOLEAN, correct_answer TEXT, solution TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (answer = user_answer_input) as is_correct,
    answer as correct_answer,
    solution
  FROM public.problems
  WHERE id = problem_id_input;
END;
$$;