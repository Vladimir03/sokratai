-- Grant moderator role and create default folders for milada.met@yandex.ru
-- Idempotent: no-op if the user hasn't registered yet.
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'milada.met@yandex.ru' LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User milada.met@yandex.ru not registered yet — skipping. Re-run migration after signup.';
    RETURN;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'moderator')
  ON CONFLICT (user_id, role) DO NOTHING;

  RAISE NOTICE 'Granted moderator role to %', v_user_id;
END $$;