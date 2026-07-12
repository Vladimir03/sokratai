-- RE-RUN онбординга лидеров (2026-07-12, вторая попытка для Светланы).
--
-- Миграция 20260712120000 применилась ДО того, как Vladimir вручную создал
-- аккаунт lana-tichonova@yandex.ru в Supabase Auth dashboard → для Светланы
-- она была no-op (NOTICE skip). Плюс admin-созданный аккаунт НЕ имеет строки
-- `tutors` (её создаёт регистрационный флоу) — без роли `tutor` вход выбрасывает
-- «Этот аккаунт не репетиторский» (rule 96), а ряд тьюторских surface ждут
-- tutors-строку (resolveTutorPkId).
--
-- Делаем полный идемпотентный проход для ОБОИХ лидеров (Эмилии всё будет no-op):
--   1) роли tutor + moderator;
--   2) строка tutors (user_id, name, subjects) — ON CONFLICT DO NOTHING;
--   3) папки «Черновики для сократа» + «сократ».
-- Нет аккаунта → NOTICE + skip (перезапустить снова).

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

    -- 1. Обе роли (инвариант rule 96: тьютор-модератор = tutor + moderator).
    INSERT INTO public.user_roles (user_id, role)
    VALUES
      (_uid, 'moderator'::public.app_role),
      (_uid, 'tutor'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- 2. Строка tutors (admin-созданный аккаунт её не имеет; регистрационный
    -- флоу не выполнялся). name/subjects — правится в /tutor/profile.
    INSERT INTO public.tutors (user_id, name, subjects)
    VALUES (_uid, _rec.display_name, _rec.subjects)
    ON CONFLICT (user_id) DO NOTHING;

    -- 3. Папки модератора.
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
