-- Признак «сообщение с разметкой фото» + ужесточение записи угла поворота
-- (фикс-пасс по ревью качества волн 1+2, план 1-ancient-quokka).

-- ─── 1. message_kind = 'photo_annotation' ────────────────────────────────────
--
-- Зачем долговечный признак: метрика владельца №2 — «ученик исправил ошибку»
-- (после сообщения с разметкой пришёл новый ответ и балл вырос). Без признака
-- факт разметки пришлось бы восстанавливать по русской строке подписи, а она
-- НЕОБЯЗАТЕЛЬНАЯ и меняется — данные первой волны пилота были бы потеряны.
--
-- ⚠️ CHECK обязателен вместе с кодом: edge уже пишет это значение, и без
-- расширения констрейнта отправка размеченного фото падала бы 23514 —
-- ровно тот класс тихого рассинхрона «код ушёл вперёд CHECK'а», что два месяца
-- ломал шаблоны у 13 репетиторов (rule 40).

ALTER TABLE public.homework_tutor_thread_messages
  DROP CONSTRAINT IF EXISTS homework_tutor_thread_messages_message_kind_check;

ALTER TABLE public.homework_tutor_thread_messages
  ADD CONSTRAINT homework_tutor_thread_messages_message_kind_check
    CHECK (
      message_kind IS NULL OR message_kind IN (
        'answer','hint_request','question','bootstrap','ai_reply','system',
        'check_result','hint_reply','tutor_message','tutor_note','submission',
        'check_failed','photo_annotation'
      )
    );

-- ─── 2. Поворот: где вообще разрешено крутить ────────────────────────────────
--
-- ⚠️ Прежняя версия проверяла только роль: ЛЮБОЙ репетитор, знающий ref, мог
-- изменить ориентацию любого файла — включая общие картинки каталога Банка,
-- которые видят все. Угол это не контент, но общая запись без границ всё равно
-- некорректна, а чинить её после подключения пробников, чата и Банка стало бы
-- миграцией поведения нескольких доменов.
--
-- Полноценная проверка «этот репетитор имеет доступ к этому файлу» требует
-- знания домена по ref и здесь невозможна. Поэтому ограничиваем сознательно и
-- узко: только бакеты, где фото принадлежит конкретной работе и поворот
-- осмыслен. Каталог Банка (`kb-attachments`) в список НЕ входит — там картинки
-- общие, и молчаливый разворот у соседа выглядел бы порчей данных.
--
-- Новый бакет с фото → добавить сюда явной миграцией.

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
  IF v_bucket NOT IN ('homework-images', 'mock-exam-photos', 'tutor-student-chat') THEN
    RAISE EXCEPTION 'Это изображение нельзя поворачивать.'
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
