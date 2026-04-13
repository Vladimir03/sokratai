-- RPC to batch-check whether students have a real (non-temp) email.
-- SECURITY DEFINER allows reading auth.users from client-side via PostgREST.
-- Used by getTutorStudents() to populate has_real_email on student cards.

CREATE OR REPLACE FUNCTION public.get_students_real_email_flags(student_ids uuid[])
RETURNS TABLE(student_id uuid, has_real_email boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT au.id AS student_id,
         (au.email IS NOT NULL AND au.email NOT LIKE '%@temp.sokratai.ru') AS has_real_email
  FROM auth.users au
  WHERE au.id = ANY(student_ids);
END;
$$;

-- Only authenticated users can call this RPC.
REVOKE ALL ON FUNCTION public.get_students_real_email_flags(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_students_real_email_flags(uuid[]) TO authenticated;
