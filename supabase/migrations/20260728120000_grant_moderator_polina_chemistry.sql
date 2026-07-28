-- Онбординг Полины (химия, polina.mari4eva@yandex.ru) модератором каталога Сократа (2026-07-28).
--
-- Уже действующий репетитор-пилот: роль tutor + строка tutors (subjects=['chemistry'])
-- существуют с 2026-04-09. Не хватает только роли moderator — она открывает
-- модераторский KB-UI (useIsModerator) и, вместе с уже выставленным subjects=['chemistry'],
-- удовлетворяет kb_require_moderator_subject('chemistry') для дальнейших модераторских
-- операций (создание тем, публикация, удаление разделов).
--
-- Личные папки «сократ» + «Черновики для сократа» создавать вручную НЕ нужно —
-- триггер trg_kb_moderator_folders (20260722140000) делает это автоматически при
-- INSERT в user_roles. Идемпотентно.

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'moderator'::public.app_role
FROM auth.users
WHERE lower(email) = lower('polina.mari4eva@yandex.ru')
ON CONFLICT (user_id, role) DO NOTHING;
