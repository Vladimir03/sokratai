-- Заполнять profiles.full_name из метаданных при регистрации нового пользователя.
--
-- Провайдеры входа Yandex ID / VK ID (и email/telegram, если передают) кладут имя
-- в raw_user_meta_data.full_name (см. oauth-yandex-callback / oauth-vk-callback:
-- user_metadata.full_name). Раньше триггер handle_new_user копировал в профиль
-- только username (= префикс почты), поэтому имя из Яндекса/VK не попадало в
-- кабинет. Теперь копируем full_name → кабинет показывает реальное имя.
--
-- Почта НЕ добавляется в profiles (rule 70 — email живёт только в auth.users,
-- используется как логин; колонки email в profiles нет и не должно быть).
-- Аватар НЕ копируется (решение владельца 2026-07-08) — остаётся в user_metadata.
--
-- Затрагивает ТОЛЬКО новые регистрации (триггер на INSERT auth.users);
-- существующие профили не перезаписываются. Тьюторы дополнительно получают имя в
-- tutors.name (assignTutorRoleIfNeeded), кабинет тьютора читает оттуда.

-- Defensive: колонка full_name уже существует (rule 40 resolveStudentDisplayName
-- каскадит по profiles.full_name), но IF NOT EXISTS делает миграцию самодостаточной.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, trial_ends_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NOW() + INTERVAL '7 days'
  );
  RETURN NEW;
END;
$$;
