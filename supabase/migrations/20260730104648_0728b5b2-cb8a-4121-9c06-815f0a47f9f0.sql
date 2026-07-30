CREATE OR REPLACE FUNCTION public.is_board_participant(_board_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM boards b JOIN tutors t ON t.id = b.tutor_id
      WHERE b.id = _board_id AND t.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM boards b JOIN tutor_students ts ON ts.id = b.student_id
      WHERE b.id = _board_id AND ts.student_id = auth.uid() AND ts.archived_at IS NULL)
    OR EXISTS (
      SELECT 1 FROM boards b
      JOIN tutor_lessons l ON l.id = b.lesson_id
      JOIN tutor_group_memberships m ON m.tutor_group_id = l.group_source_tutor_group_id
      JOIN tutor_students ms ON ms.id = m.tutor_student_id
      WHERE b.id = _board_id AND m.is_active
        AND ms.student_id = auth.uid() AND ms.archived_at IS NULL)
    OR EXISTS (
      SELECT 1 FROM board_pages p
      JOIN tutor_students zs ON zs.id = p.zone_tutor_student_id
      WHERE p.board_id = _board_id
        AND zs.student_id = auth.uid() AND zs.archived_at IS NULL);
$$;