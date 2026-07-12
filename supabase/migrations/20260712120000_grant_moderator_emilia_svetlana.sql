-- Онбординг предметных лидеров модераторами (2026-07-12):
--   Эмилия (французский, pacane@gmail.com) — действующий репетитор-пилот;
--   Светлана (математика, lana-tichonova@yandex.ru) — новый лидер.
--
-- Зеркало онбординга Милады (20260706140000) + урок хотфикса 20260707120000:
-- тьютор-модератор ОБЯЗАН иметь ОБЕ роли `tutor` + `moderator` сразу (KB-модерация
-- живёт под /tutor/knowledge/* → вход требует роль tutor; TutorGuard). Выдаём обе
-- за один проход + личные папки «Черновики для сократа» и «сократ» (якорь
-- авто-публикации в каталог, kb_is_in_socrat_tree).
--
-- Идемпотентно; аккаунта нет → no-op + NOTICE (перезапустить после регистрации).
-- Темы (математика / французский) лидеры заводят self-serve (kb_mod_create_topic).
-- Витрина уже показывает предметы «Математика»/«Французский» (KB_SUBJECTS).

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

    -- 1. Обе роли (инвариант rule 96: тьютор-модератор = tutor + moderator).
    INSERT INTO public.user_roles (user_id, role)
    VALUES
      (_uid, 'moderator'::public.app_role),
      (_uid, 'tutor'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Granted moderator+tutor to % (%)', _email, _uid;

    -- 2. Личная папка «Черновики для сократа» (скрытая, ревью до публикации).
    SELECT id INTO _folder_id
    FROM public.kb_folders
    WHERE owner_id = _uid AND name = 'Черновики для сократа' AND parent_id IS NULL
    LIMIT 1;
    IF _folder_id IS NULL THEN
      INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
      VALUES (_uid, NULL, 'Черновики для сократа', 0);
      RAISE NOTICE '  created folder "Черновики для сократа" for %', _email;
    END IF;

    -- 3. Личная папка «сократ» (магический якорь авто-публикации в каталог).
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
