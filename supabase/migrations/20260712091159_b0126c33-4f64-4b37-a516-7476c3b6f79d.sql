DO $onboard$ DECLARE
  _email TEXT;
  _uid UUID;
  _folder_id UUID;
BEGIN
  FOREACH _email IN ARRAY ARRAY['pacane@gmail.com', 'lana-tichonova@yandex.ru'] LOOP
    SELECT id INTO _uid FROM auth.users WHERE email = _email LIMIT 1;

    IF _uid IS NULL THEN
      RAISE NOTICE 'User % not found — skipping (re-run after signup)', _email;
      CONTINUE;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES
      (_uid, 'moderator'::public.app_role),
      (_uid, 'tutor'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Granted moderator+tutor to % (%)', _email, _uid;

    SELECT id INTO _folder_id
    FROM public.kb_folders
    WHERE owner_id = _uid AND name = 'Черновики для сократа' AND parent_id IS NULL
    LIMIT 1;
    IF _folder_id IS NULL THEN
      INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
      VALUES (_uid, NULL, 'Черновики для сократа', 0);
      RAISE NOTICE '  created folder "Черновики для сократа" for %', _email;
    END IF;

    SELECT id INTO _folder_id
    FROM public.kb_folders
    WHERE owner_id = _uid AND name = 'сократ' AND parent_id IS NULL
    LIMIT 1;
    IF _folder_id IS NULL THEN
      INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
      VALUES (_uid, NULL, 'сократ', 1);
      RAISE NOTICE '  created folder "сократ" for %', _email;
    END IF;
  END LOOP;
END $onboard$;

DO $rerun$ DECLARE
  _rec RECORD;
  _uid UUID;
  _folder_id UUID;
BEGIN
  FOR _rec IN
    SELECT * FROM (VALUES
      ('pacane@gmail.com',          'Эмилия',   ARRAY['french']),
      ('lana-tichonova@yandex.ru',  'Светлана', ARRAY['maths'])
    ) AS t(email, display_name, subjects)
  LOOP
    SELECT id INTO _uid FROM auth.users WHERE email = _rec.email LIMIT 1;

    IF _uid IS NULL THEN
      RAISE NOTICE 'User % not found — skipping (re-run after signup)', _rec.email;
      CONTINUE;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES
      (_uid, 'moderator'::public.app_role),
      (_uid, 'tutor'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.tutors (user_id, name, subjects)
    VALUES (_uid, _rec.display_name, _rec.subjects)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT id INTO _folder_id
    FROM public.kb_folders
    WHERE owner_id = _uid AND name = 'Черновики для сократа' AND parent_id IS NULL
    LIMIT 1;
    IF _folder_id IS NULL THEN
      INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
      VALUES (_uid, NULL, 'Черновики для сократа', 0);
    END IF;

    SELECT id INTO _folder_id
    FROM public.kb_folders
    WHERE owner_id = _uid AND name = 'сократ' AND parent_id IS NULL
    LIMIT 1;
    IF _folder_id IS NULL THEN
      INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
      VALUES (_uid, NULL, 'сократ', 1);
    END IF;

    RAISE NOTICE 'Onboarded % (%): roles tutor+moderator, tutors row, folders', _rec.email, _uid;
  END LOOP;
END $rerun$;