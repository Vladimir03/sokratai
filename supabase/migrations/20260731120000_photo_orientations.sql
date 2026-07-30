-- Поворот фото на 90° в кабинете репетитора (волна 1, план 1-ancient-quokka).
--
-- Джоб (Ульяна, химия, 30.07.2026, U21/U22): фото решений учеников приходят
-- боком, и «его нельзя развернуть» — приходится копировать наружу.
--
-- ⚠️ Почему ОТДЕЛЬНАЯ таблица, а не колонка в 6 доменных схемах:
--   • фото живут в ДЗ, пробниках, чате, Банке знаний и материалах занятий —
--     колонка в каждой означала бы 6 миграций и новые write-site в местах,
--     где у нас уже есть двойной write-path (rule 40);
--   • угол привязан к ФАЙЛУ, а не к домену: одна и та же картинка, скопированная
--     из Банка в ДЗ, повёрнута одинаково;
--   • оригинал ученика остаётся нетронутым (альтернатива — перекодировать JPEG —
--     стоила бы 1,5–7 с ожидания на каждый поворот и генерационной потери
--     качества на рукописи с индексами).
--
-- ⚠️ ANTI-LEAK: `ref` — это путь в storage, поэтому СПИСОК ref'ов не отдаётся
-- никому. Прямых GRANT'ов на таблицу у anon/authenticated НЕТ; чтение только
-- через `photo_orientations_get(text[])`, который возвращает строки лишь для
-- УЖЕ ИЗВЕСТНЫХ вызывающему ref'ов. Ни `select *`, ни выборки по префиксу.

CREATE TABLE IF NOT EXISTS public.photo_orientations (
  -- `storage://<bucket>/<path>` — тот же формат, что в attachmentRefs.ts.
  ref text PRIMARY KEY,
  degrees smallint NOT NULL DEFAULT 0
    CONSTRAINT chk_photo_orientation_degrees CHECK (degrees IN (0, 90, 180, 270)),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.photo_orientations ENABLE ROW LEVEL SECURITY;

-- Ни одной политики: весь доступ идёт через SECURITY DEFINER функции ниже.
REVOKE ALL ON public.photo_orientations FROM PUBLIC;
REVOKE ALL ON public.photo_orientations FROM anon, authenticated;
-- Явный GRANT обязателен: default privileges схемы public для новых таблиц
-- не покрывают service_role, и edge упал бы permission denied на первом запросе
-- (урок миграций доски, 29.07).
GRANT ALL ON public.photo_orientations TO service_role;

-- ─── Чтение: только по известным ref'ам, пачкой ──────────────────────────────
--
-- Доступно и ученику: смысл фичи в том, что повёрнутое репетитором фото
-- ученик видит так же. Ученик не может ПЕРЕЧИСЛИТЬ чужие ref'ы — он передаёт
-- те, что ему и так отдали студенческие эндпоинты.

CREATE OR REPLACE FUNCTION public.photo_orientations_get(p_refs text[])
RETURNS TABLE (ref text, degrees smallint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT po.ref, po.degrees
  FROM public.photo_orientations po
  -- Кап на размер пачки: функция не должна превращаться в дешёвый оракул
  -- «какие фото вообще поворачивали». 200 с запасом покрывает любой экран
  -- (максимум фото на задачу — 5, на бланк — единицы).
  WHERE po.ref = ANY (p_refs[1:200])
    AND auth.uid() IS NOT NULL;
$$;

-- ─── Запись: только репетитор ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.photo_orientations_set(p_ref text, p_degrees int)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_norm smallint;
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

-- Порядок обязателен: сначала GRANT, потом REVOKE (rule 99) — иначе отнимем
-- доступ у тех, у кого он держался на PUBLIC.
GRANT EXECUTE ON FUNCTION public.photo_orientations_get(text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.photo_orientations_get(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.photo_orientations_get(text[]) FROM anon;

GRANT EXECUTE ON FUNCTION public.photo_orientations_set(text, int) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.photo_orientations_set(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.photo_orientations_set(text, int) FROM anon;

COMMENT ON TABLE public.photo_orientations IS
  'Угол показа фото (0/90/180/270) по storage-ref. Файл не перезаписывается: '
  'угол применяется transform''ом на клиенте и запекается в пиксели только '
  'при рендере размеченной картинки. Доступ ТОЛЬКО через photo_orientations_get/set — '
  'список ref''ов не отдаётся никому (anti-leak, rule 40).';
