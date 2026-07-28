-- Онлайн-доска, Фаза 1 (docs/delivery/features/whiteboard/spec.md §5, задача W1.1).
--
-- Три таблицы: boards (доска, опционально привязана к занятию и ученику),
-- board_pages (страница = отдельная сцена, единица навигации и листа PDF),
-- board_sessions (держатель «мела» — пишется начиная с Фазы 2, создаётся здесь
-- заранее, чтобы не менять схему позже).
--
-- Записи ТОЛЬКО через edge `whiteboard-api` под service_role: клиентских
-- INSERT/UPDATE/DELETE-политик нет (та же модель, что у tutor_lesson_materials).
--
-- ⚠️ FK-дрейф (rule 60): boards.tutor_id → public.tutors.id (PK), НЕ auth.users.id.
--    tutor_lessons.tutor_id и tutor_students.tutor_id тоже → tutors.id, поэтому
--    здесь конверсия не нужна; в edge она делается через resolveTutorPkId.
--
-- Фаза 1 — доска ОДНОПОЛЬЗОВАТЕЛЬСКАЯ: студенческих SELECT-политик нет намеренно.
-- Ученик получает ценность через PDF в материалах занятия (существующий путь
-- tutor_lesson_materials). Доступ ученика к самой доске появится в Фазе 2 вместе
-- с передачей мела (W2.9–W2.14).

-- ─── boards ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  -- ON DELETE явно (rule 60): без него FK тихо блокирует удаление ученика/занятия.
  student_id uuid NULL REFERENCES public.tutor_students(id) ON DELETE SET NULL,
  lesson_id uuid NULL REFERENCES public.tutor_lessons(id) ON DELETE SET NULL,
  title text NULL,
  -- Материал-конспект, созданный последним экспортом этой доски. SET NULL (а не
  -- CASCADE): репетитор удалил PDF из материалов → доска просто забывает ссылку
  -- и следующий экспорт создаст новый материал, а не упрётся в кап 5 PDF.
  export_material_id uuid NULL REFERENCES public.tutor_lesson_materials(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_tutor ON public.boards(tutor_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_boards_lesson ON public.boards(lesson_id) WHERE lesson_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_boards_student ON public.boards(student_id) WHERE student_id IS NOT NULL;

-- ─── board_pages ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.board_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  -- НЕ unique: удаление страницы переиндексирует хвост, уникальность потребовала
  -- бы DEFERRABLE. Порядок = (page_index, created_at) — tie-breaker обязателен
  -- (тот же урок, что с sort_order материалов занятия, rule 98).
  page_index int NOT NULL DEFAULT 0,
  elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  app_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  background text NOT NULL DEFAULT 'grid',
  grid_mm int NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_board_page_background CHECK (background IN ('blank', 'grid', 'lines', 'dots')),
  CONSTRAINT chk_board_page_grid_mm CHECK (grid_mm IN (5, 10))
);

CREATE INDEX IF NOT EXISTS idx_board_pages_board ON public.board_pages(board_id, page_index, created_at);

-- ─── board_sessions (Фаза 2: передача мела) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.board_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  lesson_id uuid NULL REFERENCES public.tutor_lessons(id) ON DELETE SET NULL,
  -- 'tutor' | 'student:<tutor_students.id>' — резолвится в Фазе 2.
  chalk_holder text NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_board_sessions_board ON public.board_sessions(board_id, started_at DESC);

-- ─── updated_at ────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_boards_updated_at ON public.boards;
CREATE TRIGGER trg_boards_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_board_pages_updated_at ON public.board_pages;
CREATE TRIGGER trg_board_pages_updated_at
  BEFORE UPDATE ON public.board_pages
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── SECURITY DEFINER хелпер ───────────────────────────────────────────────────
--
-- ⚠️ Прямой подзапрос к boards внутри политики board_pages дал бы false-negative:
-- на промежуточной таблице тоже висит RLS (тот же класс, что в rule 100 с
-- tutor_lesson_participants). Поэтому владение резолвится SECURITY DEFINER-хелпером.

CREATE OR REPLACE FUNCTION public.board_owned_by_tutor(_board_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.boards b
    JOIN public.tutors t ON t.id = b.tutor_id
    WHERE b.id = _board_id
      AND t.user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.board_owned_by_tutor(uuid) TO authenticated;

-- ─── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boards_tutor_select ON public.boards;
CREATE POLICY boards_tutor_select ON public.boards
  FOR SELECT TO authenticated
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS board_pages_tutor_select ON public.board_pages;
CREATE POLICY board_pages_tutor_select ON public.board_pages
  FOR SELECT TO authenticated
  USING (public.board_owned_by_tutor(board_id));

DROP POLICY IF EXISTS board_sessions_tutor_select ON public.board_sessions;
CREATE POLICY board_sessions_tutor_select ON public.board_sessions
  FOR SELECT TO authenticated
  USING (public.board_owned_by_tutor(board_id));

-- Никаких INSERT/UPDATE/DELETE-политик: единственный write-path — edge
-- `whiteboard-api` под service_role.

-- ─── Column grants ─────────────────────────────────────────────────────────────
--
-- RLS фильтрует СТРОКИ, не колонки (rule 40, слой 2). `tutor_id` наружу не отдаём —
-- клиенту он не нужен, а `select('*')` под authenticated должен оставаться закрытым.

REVOKE ALL ON public.boards FROM anon, authenticated;
REVOKE ALL ON public.board_pages FROM anon, authenticated;
REVOKE ALL ON public.board_sessions FROM anon, authenticated;

GRANT SELECT (id, student_id, lesson_id, title, export_material_id, created_at, updated_at)
  ON public.boards TO authenticated;
GRANT SELECT (id, board_id, page_index, elements, app_state, background, grid_mm, created_at, updated_at)
  ON public.board_pages TO authenticated;
GRANT SELECT (id, board_id, lesson_id, chalk_holder, started_at, ended_at)
  ON public.board_sessions TO authenticated;

COMMENT ON TABLE public.boards IS
  'Онлайн-доска репетитора. tutor_id → tutors.id (PK). Записи только через edge whiteboard-api.';
COMMENT ON TABLE public.board_pages IS
  'Страница доски = отдельная сцена и один лист PDF. Порядок: (page_index, created_at).';
COMMENT ON TABLE public.board_sessions IS
  'Держатель «мела» — используется с Фазы 2 (передача мела ученику).';
