-- Доска, Этап 5 (UX-фикс по фидбэку Елены, 30.07): участник доски = ТАКЖЕ
-- владелец зоны на ней. До этого is_board_participant знал только владельца,
-- board.student_id и группу занятия — ученик с зоной на standalone-доске
-- (розданной новым пикером «Раздать зоны») не мог ни читать листы (RLS),
-- ни подписаться на revs, ни войти в private live-канал.
--
-- CREATE OR REPLACE меняет тело; политики (board_pages/boards/board_page_revs/
-- realtime.messages) ссылаются на функцию и подхватывают ветку автоматически.
-- Идемпотентна.

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
        AND ms.student_id = auth.uid() AND ms.archived_at IS NULL)
    -- Владелец зоны на доске (Этап 5): зоны раздаются пикером на любой доске,
    -- без привязки к занятию. Зона снята/ученик архивирован → доступ пропал.
    OR EXISTS (
      SELECT 1 FROM board_pages p
      JOIN tutor_students zs ON zs.id = p.zone_tutor_student_id
      WHERE p.board_id = _board_id
        AND zs.student_id = auth.uid() AND zs.archived_at IS NULL);
$$;

-- Гранты не меняются (уже выданы миграцией 20260730120000); REPLACE их сохраняет.
