-- ══════════════════════════════════════════════════════════════
-- Единая модель задач (unified-task-model, Фаза 0 / M2b) — 2026-07-05
-- Hardening: каталог kb_tasks читают ТОЛЬКО туторы/модераторы.
--
-- До этой миграции policy «KB tasks select public or own» (20260312120000)
-- отдавала каталожные строки (owner_id IS NULL) ЛЮБОМУ authenticated —
-- включая УЧЕНИКОВ, которые через прямой PostgREST могли читать `solution`
-- (пред-существующая дыра). С M2 (20260705120100) в каталог едут ещё и
-- rubric_text / grading_criteria_json → сужение обязательно.
--
-- Новая политика: личные строки — только владельцу (без изменений); каталог —
-- только туторам (public.is_tutor, SECURITY DEFINER helper из 20260117211049 —
-- та же роль, что гейтит TutorGuard и KB tutor-guard RLS, rule 45) и
-- модераторам. KB — tutor-домен: ни одна student-поверхность не читает
-- kb_tasks напрямую (тренажёр — статический движок; публичные share — свои
-- edge под service_role; student homework — homework_tutor_tasks). Edge-функции
-- на service_role обходят RLS — не затронуты.
-- ══════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "KB tasks select public or own" ON public.kb_tasks;

CREATE POLICY "KB tasks select catalog tutors or own"
  ON public.kb_tasks
  FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR (
      owner_id IS NULL
      AND (public.is_tutor(auth.uid()) OR public.has_role(auth.uid(), 'moderator'))
    )
  );

COMMIT;
