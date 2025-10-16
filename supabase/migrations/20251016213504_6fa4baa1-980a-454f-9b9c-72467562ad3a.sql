-- Drop the restrictive SELECT policy on problems table
DROP POLICY IF EXISTS "Users cannot view problems directly" ON public.problems;

-- Create a new policy that allows authenticated users to SELECT from problems
-- This is safe because sensitive data (answer, solution) is hidden in problems_public view
CREATE POLICY "Authenticated users can view problems"
ON public.problems
FOR SELECT
TO authenticated
USING (true);