-- Создать функцию для проверки роли репетитора
CREATE OR REPLACE FUNCTION public.is_tutor(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'tutor')
$$;