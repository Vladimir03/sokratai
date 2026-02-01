-- 1. Добавить колонку invite_code
ALTER TABLE public.tutors
ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;

-- 2. Создать функцию для генерации случайного кода
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE SET search_path = public;

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

-- 4. Установить default для новых записей
ALTER TABLE public.tutors
ALTER COLUMN invite_code SET DEFAULT public.generate_invite_code();

-- 5. Индекс для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_tutors_invite_code ON public.tutors(invite_code);