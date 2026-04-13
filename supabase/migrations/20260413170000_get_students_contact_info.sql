-- RPC to batch-resolve the current login email from auth.users for tutor-side
-- student cards and profile views.
-- SECURITY DEFINER is required because auth.users is not readable directly
-- from the browser client.

CREATE OR REPLACE FUNCTION public.get_students_contact_info(student_ids uuid[])
RETURNS TABLE(student_id uuid, login_email text, has_real_email boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT
    au.id AS student_id,
    au.email AS login_email,
    (au.email IS NOT NULL AND au.email NOT LIKE '%@temp.sokratai.ru') AS has_real_email
  FROM auth.users au
  WHERE au.id = ANY(student_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.get_students_contact_info(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_students_contact_info(uuid[]) TO authenticated;
