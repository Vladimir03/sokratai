-- Доска, фаза P0 Этап 2: зоны учеников, гостевой доступ, сигнальный синк.
-- План: ~/.claude/plans/shiny-leaping-stardust.md. Полностью идемпотентна
-- (Lovable исторически кладёт свою дубль-копию — оба файла обязаны переживать
-- повторный прогон).

-- ─── 1. Зона ученика на листе (рулон = несколько строк одного ученика) ────────

ALTER TABLE public.board_pages
  ADD COLUMN IF NOT EXISTS zone_tutor_student_id uuid NULL
    REFERENCES public.tutor_students(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_board_pages_zone
  ON public.board_pages(zone_tutor_student_id) WHERE zone_tutor_student_id IS NOT NULL;

-- Участникам нужно видеть, чья зона (RLS фильтрует строки, не колонки — rule 40).
GRANT SELECT (zone_tutor_student_id) ON public.board_pages TO authenticated;

-- ─── 2. Гостевые ссылки и гости (bearer'ы; RLS deny-all, только service_role) ─

CREATE TABLE IF NOT EXISTS public.board_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  tutor_id uuid NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bsl_active_board
  ON public.board_share_links(board_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.board_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  share_link_id uuid NOT NULL REFERENCES public.board_share_links(id) ON DELETE CASCADE,
  -- NULL = зритель без зоны (свободное имя). rule 60: явный ON DELETE.
  tutor_student_id uuid NULL REFERENCES public.tutor_students(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  guest_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_board_guests_token ON public.board_guests(guest_token);
CREATE INDEX IF NOT EXISTS idx_board_guests_board ON public.board_guests(board_id);

ALTER TABLE public.board_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_guests ENABLE ROW LEVEL SECURITY;
-- Ни одной политики: slug и guest_token — bearer'ы, клиентского доступа нет
-- вовсе; репетитор получает slug только ответом edge (rule 96 №10: не логировать).
REVOKE ALL ON public.board_share_links FROM PUBLIC;
REVOKE ALL ON public.board_share_links FROM anon, authenticated;
REVOKE ALL ON public.board_guests FROM PUBLIC;
REVOKE ALL ON public.board_guests FROM anon, authenticated;
GRANT ALL ON public.board_share_links TO service_role;
GRANT ALL ON public.board_guests TO service_role;

-- ─── 3. Сигнальная таблица синка (board_pages в publication НЕ добавлять:
--        elements 0.5–4 МБ ехали бы в WAL целиком при каждом автосейве) ────────

CREATE TABLE IF NOT EXISTS public.board_page_revs (
  page_id uuid PRIMARY KEY REFERENCES public.board_pages(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  rev bigint NOT NULL DEFAULT 1,
  -- 'tutor' | 'student:<ts_id>' | 'guest:<guest_id>' (формат chalk_holder).
  updated_by text NOT NULL DEFAULT 'tutor',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bpr_board_time ON public.board_page_revs(board_id, updated_at);

INSERT INTO public.board_page_revs (page_id, board_id)
SELECT id, board_id FROM public.board_pages
ON CONFLICT (page_id) DO NOTHING;

ALTER TABLE public.board_page_revs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.board_page_revs FROM PUBLIC;
REVOKE ALL ON public.board_page_revs FROM anon, authenticated;
GRANT ALL ON public.board_page_revs TO service_role;
GRANT SELECT (page_id, board_id, rev, updated_by, updated_at)
  ON public.board_page_revs TO authenticated;

-- ─── 4. Участник доски (живое членство, rule 100; FK-дрейф rule 60) ───────────

CREATE OR REPLACE FUNCTION public.is_board_participant(_board_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Репетитор-владелец (tutors.user_id — единственная сверка с auth.uid).
    EXISTS (
      SELECT 1 FROM boards b JOIN tutors t ON t.id = b.tutor_id
      WHERE b.id = _board_id AND t.user_id = auth.uid())
    -- Индивидуальная привязка: boards.student_id → tutor_students.id (НЕ auth.uid).
    OR EXISTS (
      SELECT 1 FROM boards b JOIN tutor_students ts ON ts.id = b.student_id
      WHERE b.id = _board_id AND ts.student_id = auth.uid() AND ts.archived_at IS NULL)
    -- Групповое занятие: живое членство (убрали из группы → доступ пропал сразу).
    OR EXISTS (
      SELECT 1 FROM boards b
      JOIN tutor_lessons l ON l.id = b.lesson_id
      JOIN tutor_group_memberships m ON m.tutor_group_id = l.group_source_tutor_group_id
      JOIN tutor_students ms ON ms.id = m.tutor_student_id
      WHERE b.id = _board_id AND m.is_active
        AND ms.student_id = auth.uid() AND ms.archived_at IS NULL);
$$;

-- Тройной REVOKE (rule 99): default privileges грантят PUBLIC/anon напрямую.
GRANT EXECUTE ON FUNCTION public.is_board_participant(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_board_participant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_board_participant(uuid) FROM anon;

-- ─── 5. Participant-политики (добавляются к tutor-политикам, OR-семантика) ────

DROP POLICY IF EXISTS boards_participant_select ON public.boards;
CREATE POLICY boards_participant_select ON public.boards
  FOR SELECT TO authenticated USING (public.is_board_participant(id));

DROP POLICY IF EXISTS board_pages_participant_select ON public.board_pages;
CREATE POLICY board_pages_participant_select ON public.board_pages
  FOR SELECT TO authenticated USING (public.is_board_participant(board_id));

DROP POLICY IF EXISTS board_sessions_participant_select ON public.board_sessions;
CREATE POLICY board_sessions_participant_select ON public.board_sessions
  FOR SELECT TO authenticated USING (public.is_board_participant(board_id));

DROP POLICY IF EXISTS board_page_revs_participant_select ON public.board_page_revs;
CREATE POLICY board_page_revs_participant_select ON public.board_page_revs
  FOR SELECT TO authenticated USING (public.is_board_participant(board_id));

-- ─── 6. Realtime publication (идемпотентный guard, эталон 20260712150100) ─────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'board_page_revs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.board_page_revs;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
