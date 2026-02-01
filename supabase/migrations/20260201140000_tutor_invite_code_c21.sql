-- =============================================
-- MVP C2.1: Подключение ученика к AI
-- Добавление invite_code для репетиторов
-- =============================================

-- 1. Добавить колонку invite_code
ALTER TABLE public.tutors
ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;

COMMENT ON COLUMN public.tutors.invite_code IS 'Уникальный код приглашения для учеников (многоразовый)';

-- 2. Создать функцию для генерации случайного кода
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghjkmnpqrstuvwxyz23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  -- Генерируем 8-символьный код (без путающих символов: 0, O, l, 1, I)
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- 3. Backfill: заполнить invite_code для существующих репетиторов
DO $$
DECLARE
  tutor_record RECORD;
  new_code TEXT;
  code_exists BOOLEAN;
BEGIN
  FOR tutor_record IN SELECT id FROM public.tutors WHERE invite_code IS NULL LOOP
    LOOP
      new_code := public.generate_invite_code();
      SELECT EXISTS(SELECT 1 FROM public.tutors WHERE invite_code = new_code) INTO code_exists;
      EXIT WHEN NOT code_exists;
    END LOOP;
    
    UPDATE public.tutors SET invite_code = new_code WHERE id = tutor_record.id;
  END LOOP;
END $$;

-- 4. Сделать колонку NOT NULL после backfill и добавить default
ALTER TABLE public.tutors
ALTER COLUMN invite_code SET DEFAULT public.generate_invite_code();

-- 5. Индекс для быстрого поиска по invite_code
CREATE INDEX IF NOT EXISTS idx_tutors_invite_code ON public.tutors(invite_code);

-- 6. RLS: разрешить публичный SELECT по invite_code (для валидации на invite-странице)
-- (уже есть policy "Anyone can view tutor by booking_link" с USING (booking_link IS NOT NULL))
-- Добавим отдельную политику для invite_code
CREATE POLICY "Anyone can view tutor by invite_code"
  ON public.tutors FOR SELECT
  USING (invite_code IS NOT NULL);
