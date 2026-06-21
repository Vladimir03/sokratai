-- ══════════════════════════════════════════════════════════════
-- kb_sources — управляемый справочник источников задач
--
-- Запрос Егора: «администратор заранее добавляет источники в отдельный
-- список, а при добавлении задачи тутор выбирает из этого списка».
--
-- Модель: глобальный словарь (read-only для authenticated, запись только
-- модератором через SECURITY DEFINER RPC — зеркало kb_mod_*_subtopic).
-- Гибрид: задача хранит ВЫБРАННОЕ имя в kb_tasks.source_label (как и раньше —
-- бейдж «Моя/Каталог» берётся из owner_id, не из source_label), плюс
-- разрешён свободный ввод «Другой». kb_sources — только vocabulary для
-- выпадающего списка; FK на задачи нет → удаление источника безопасно.
-- ══════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.kb_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'physics',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Case-insensitive уникальность имени (без дублей «ФИПИ» / «фипи»).
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_sources_name_lower
  ON public.kb_sources (lower(name));

ALTER TABLE public.kb_sources ENABLE ROW LEVEL SECURITY;

-- Читают все вошедшие (словарь для выпадающего списка). Запись — только RPC.
DROP POLICY IF EXISTS "KB sources select authenticated" ON public.kb_sources;
CREATE POLICY "KB sources select authenticated"
  ON public.kb_sources FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.kb_sources TO authenticated;

-- ── RPC: create ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kb_mod_create_source(
  p_name TEXT,
  p_sort_order INTEGER DEFAULT 0,
  p_subject TEXT DEFAULT 'physics'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _id UUID; _caller UUID;
BEGIN
  _caller := public.kb_require_moderator();

  IF COALESCE(TRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'Укажите название источника';
  END IF;
  -- '__custom__' — sentinel опции «Другой» в UI-селекторе; нельзя как имя источника.
  IF lower(TRIM(p_name)) = '__custom__' THEN
    RAISE EXCEPTION 'Недопустимое название источника';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kb_sources WHERE lower(name) = lower(TRIM(p_name))) THEN
    RAISE EXCEPTION 'Источник «%» уже есть в списке', TRIM(p_name);
  END IF;

  INSERT INTO public.kb_sources (name, subject, sort_order, created_by)
  VALUES (
    TRIM(p_name),
    COALESCE(NULLIF(TRIM(p_subject), ''), 'physics'),
    COALESCE(p_sort_order, 0),
    _caller
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- ── RPC: update ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kb_mod_update_source(
  p_id UUID,
  p_name TEXT DEFAULT NULL,
  p_sort_order INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.kb_require_moderator();

  IF p_name IS NOT NULL AND lower(TRIM(p_name)) = '__custom__' THEN
    RAISE EXCEPTION 'Недопустимое название источника';
  END IF;
  IF p_name IS NOT NULL AND TRIM(p_name) <> '' AND EXISTS (
    SELECT 1 FROM public.kb_sources WHERE lower(name) = lower(TRIM(p_name)) AND id <> p_id
  ) THEN
    RAISE EXCEPTION 'Источник «%» уже есть в списке', TRIM(p_name);
  END IF;

  UPDATE public.kb_sources SET
    name       = COALESCE(NULLIF(TRIM(p_name), ''), name),
    sort_order = COALESCE(p_sort_order, sort_order)
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Источник не найден';
  END IF;
END;
$$;

-- ── RPC: delete (FK на задачи нет — source_label остаётся строкой у задач) ─────
CREATE OR REPLACE FUNCTION public.kb_mod_delete_source(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.kb_require_moderator();

  DELETE FROM public.kb_sources WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Источник не найден';
  END IF;
END;
$$;

-- ── GRANTS (роль проверяется внутри RPC) ──────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.kb_mod_create_source(TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_update_source(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_source(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.kb_mod_create_source(TEXT, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_update_source(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_source(UUID) TO authenticated;

-- ── Сид частых источников (модератор отредактирует/дополнит) ───────────────────
INSERT INTO public.kb_sources (name, sort_order) VALUES
  ('ФИПИ', 10),
  ('Решу ЕГЭ', 20),
  ('Решу ОГЭ', 30),
  ('Школково', 40),
  ('Учебник', 50),
  ('Авторская задача', 60)
ON CONFLICT (lower(name)) DO NOTHING;

COMMIT;
