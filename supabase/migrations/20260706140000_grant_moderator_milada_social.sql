-- Онбординг модератора обществознания (Milada, milada.met@yandex.ru), 2026-07-06.
-- Зеркало онбординга Егора (20260318134400): роль moderator + личные папки
-- «Черновики для сократа» и «сократ» (магический якорь авто-публикации в каталог,
-- kb_is_in_socrat_tree). Идемпотентно; если аккаунта ещё нет — no-op + NOTICE
-- (после регистрации миграцию можно перезапустить). Темы обществознания Milada
-- заводит self-serve в табе «Обществознание» (kb_mod_create_topic, subject='social').

DO $milada$ DECLARE
  _milada_id UUID;
  _drafts_folder_id UUID;
  _ready_folder_id UUID;
BEGIN
  SELECT id INTO _milada_id
  FROM auth.users
  WHERE email = 'milada.met@yandex.ru'
  LIMIT 1;

  IF _milada_id IS NULL THEN
    RAISE NOTICE 'User milada.met@yandex.ru not found — skipping (re-run after signup)';
    RETURN;
  END IF;

  -- 1. Роль модератора (открывает модераторский UI: useIsModerator → true).
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_milada_id, 'moderator')
  ON CONFLICT (user_id, role) DO NOTHING;
  RAISE NOTICE 'Granted moderator role to milada.met@yandex.ru (%)', _milada_id;

  -- 2. Личные папки модератора.
  SELECT id INTO _drafts_folder_id
  FROM public.kb_folders
  WHERE owner_id = _milada_id AND name = 'Черновики для сократа' AND parent_id IS NULL
  LIMIT 1;

  IF _drafts_folder_id IS NULL THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (_milada_id, NULL, 'Черновики для сократа', 0)
    RETURNING id INTO _drafts_folder_id;
    RAISE NOTICE 'Created folder "Черновики для сократа": %', _drafts_folder_id;
  ELSE
    RAISE NOTICE 'Folder "Черновики для сократа" already exists: %', _drafts_folder_id;
  END IF;

  SELECT id INTO _ready_folder_id
  FROM public.kb_folders
  WHERE owner_id = _milada_id AND name = 'сократ' AND parent_id IS NULL
  LIMIT 1;

  IF _ready_folder_id IS NULL THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (_milada_id, NULL, 'сократ', 1)
    RETURNING id INTO _ready_folder_id;
    RAISE NOTICE 'Created folder "сократ": %', _ready_folder_id;
  ELSE
    RAISE NOTICE 'Folder "сократ" already exists: %', _ready_folder_id;
  END IF;

END $milada$;
