-- Fix ambiguous column reference in check_problem_answer function
CREATE OR REPLACE FUNCTION public.check_problem_answer(problem_id_input uuid, user_answer_input text)
 RETURNS TABLE(is_correct boolean, correct_answer text, solution text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    (p.answer = user_answer_input) as is_correct,
    p.answer as correct_answer,
    p.solution
  FROM public.problems p
  WHERE p.id = problem_id_input;
END;
$function$;