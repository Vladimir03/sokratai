-- Create table to track answer attempts
CREATE TABLE public.answer_attempts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_id uuid NOT NULL REFERENCES public.problems(id) ON DELETE CASCADE,
  attempt_time timestamp with time zone NOT NULL DEFAULT now(),
  was_correct boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, problem_id, attempt_time)
);

-- Enable RLS
ALTER TABLE public.answer_attempts ENABLE ROW LEVEL SECURITY;

-- Users can only view their own attempts
CREATE POLICY "Users can view own attempts"
ON public.answer_attempts
FOR SELECT
USING (auth.uid() = user_id);

-- System can insert attempts (will be done via function)
CREATE POLICY "System can insert attempts"
ON public.answer_attempts
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Add index for performance
CREATE INDEX idx_answer_attempts_user_problem_time 
ON public.answer_attempts(user_id, problem_id, attempt_time DESC);

-- Update check_problem_answer function with rate limiting
CREATE OR REPLACE FUNCTION public.check_problem_answer(problem_id_input uuid, user_answer_input text)
RETURNS TABLE(is_correct boolean, correct_answer text, solution text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_attempt_count integer;
  v_is_correct boolean;
  v_correct_answer text;
  v_solution text;
BEGIN
  -- Check rate limit: max 5 attempts per minute
  SELECT COUNT(*)
  INTO v_attempt_count
  FROM public.answer_attempts
  WHERE user_id = auth.uid()
    AND problem_id = problem_id_input
    AND attempt_time > now() - INTERVAL '1 minute';

  IF v_attempt_count >= 5 THEN
    RAISE EXCEPTION 'Слишком много попыток. Подождите минуту.';
  END IF;

  -- Check the answer
  SELECT 
    (p.answer = user_answer_input),
    p.answer,
    p.solution
  INTO v_is_correct, v_correct_answer, v_solution
  FROM public.problems p
  WHERE p.id = problem_id_input;

  -- Log the attempt
  INSERT INTO public.answer_attempts (user_id, problem_id, was_correct)
  VALUES (auth.uid(), problem_id_input, v_is_correct);

  -- Return result
  RETURN QUERY SELECT v_is_correct, v_correct_answer, v_solution;
END;
$function$;