-- HOTFIX (2026-07-07): Milada (milada.met@yandex.ru) не могла войти в кабинет.
--
-- Онбординг-миграция 20260706140000 выдала ей роль `moderator` и создала папки,
-- но НЕ роль `tutor`. Вход в кабинет репетитора (TutorLogin → is_tutor; TutorGuard)
-- жёстко требует роль `tutor` — а KB-модерация живёт под `/tutor/knowledge/*`.
-- Модератор БЕЗ роли tutor логинится и тут же получает «Этот аккаунт не
-- репетиторский» (signOut). Тьютор-модератор (как Егор) обязан иметь ОБЕ роли.
--
-- Фикс: выдать роль `tutor`. Идемпотентно; нет аккаунта → no-op (SELECT пуст).
-- `moderator` уже выдан миграцией 20260706140000 — здесь не дублируем.
--
-- Инвариант на будущее: онбординг тьютора-модератора = tutor + moderator роли
-- (KB-модераторский UI доступен только внутри кабинета репетитора).

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'tutor'::public.app_role
FROM auth.users
WHERE email = 'milada.met@yandex.ru'
ON CONFLICT (user_id, role) DO NOTHING;
