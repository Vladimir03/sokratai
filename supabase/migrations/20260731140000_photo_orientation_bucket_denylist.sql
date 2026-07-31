-- Починка гарда бакетов у поворота фото (31.07.2026, живой прогон владельца).
--
-- ⚠️ ЧТО СЛОМАЛОСЬ. Предыдущая миграция ввела ALLOWLIST бакетов, а имена в нём
-- были взяты по памяти и оказались выдуманными: `tutor-student-chat` вместо
-- реального `tutor-chat-uploads`, `mock-exam-photos` — которого нет вовсе, и
-- при этом пропущены `homework-task-images`, `homework-submissions`,
-- `chat-images`, `homework-materials`. В результате поворот отвергался и на
-- условии задачи, и на фото решения ученика — то есть ровно там, ради чего
-- фича делалась.
--
-- ⚠️ ПОЧЕМУ ТЕПЕРЬ DENYLIST, А НЕ ИСПРАВЛЕННЫЙ ALLOWLIST. Защищать нужно ровно
-- одно: ОБЩИЕ картинки каталога Банка, которые видят все репетиторы, — их
-- молчаливый разворот у соседа выглядел бы порчей данных. Всё остальное — фото
-- конкретной работы конкретного ученика, и там поворот безвреден и нужен.
--
-- У allowlist здесь плохая асимметрия отказа: забыли внести новый бакет —
-- фича МОЛЧА не работает на новой поверхности (что и случилось). У denylist
-- забыли внести новый ОБЩИЙ бакет — кто-то может развернуть общую картинку,
-- то есть поменять угол показа. Цена второй ошибки несопоставимо ниже, а
-- вероятность её ниже: общие бакеты заводят редко и осознанно.
--
-- Новый бакет с ОБЩИМ (не принадлежащим одной работе) контентом → добавить
-- сюда явной миграцией.

CREATE OR REPLACE FUNCTION public.photo_orientations_set(p_ref text, p_degrees int)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_norm smallint;
  v_bucket text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Нужно войти в аккаунт, чтобы повернуть фото.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_tutor(v_uid) THEN
    RAISE EXCEPTION 'Поворачивать фото может только репетитор.'
      USING ERRCODE = '42501';
  END IF;

  IF p_ref IS NULL OR length(p_ref) = 0 OR length(p_ref) > 1024 THEN
    RAISE EXCEPTION 'Некорректная ссылка на фото.'
      USING ERRCODE = '22023';
  END IF;

  IF p_ref NOT LIKE 'storage://%/%' THEN
    RAISE EXCEPTION 'Некорректная ссылка на фото.'
      USING ERRCODE = '22023';
  END IF;

  v_bucket := split_part(substring(p_ref from 11), '/', 1);
  -- Общий каталог Банка: картинку видят все репетиторы сразу, поэтому угол
  -- показа там не личное дело одного.
  IF v_bucket IN ('kb-attachments') THEN
    RAISE EXCEPTION 'Общие картинки каталога поворачивать нельзя.'
      USING ERRCODE = '42501';
  END IF;

  -- Нормализуем на сервере тоже: клиент мог прислать -90 или 450.
  v_norm := (((p_degrees % 360) + 360) % 360)::smallint;
  IF v_norm NOT IN (0, 90, 180, 270) THEN
    RAISE EXCEPTION 'Поворот возможен только шагом 90°.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.photo_orientations (ref, degrees, updated_by, updated_at)
  VALUES (p_ref, v_norm, v_uid, now())
  ON CONFLICT (ref) DO UPDATE
    SET degrees = EXCLUDED.degrees,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;

  RETURN v_norm;
END;
$$;

GRANT EXECUTE ON FUNCTION public.photo_orientations_set(text, int) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.photo_orientations_set(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.photo_orientations_set(text, int) FROM anon;
