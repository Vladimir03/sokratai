-- Mock Exams «Пробники» — снять пилотный гейт, открыть всем репетиторам.
-- Контекст: feature_mock_exams_enabled (миграция 20260508120000) был per-tutor
-- staggered roll-out с DEFAULT false; включался точечно (20260521165921 — один
-- user_id). Репетиторы без флага не видели вкладку «Пробники» в SideNav
-- (src/components/tutor/chrome/SideNav.tsx) — для них это выглядело как баг.
-- Решение владельца (2026-06-26): mock-exams выходит из пилота → доступно всем.

-- 1) Новые туторы по умолчанию видят «Пробники».
ALTER TABLE public.tutors
  ALTER COLUMN feature_mock_exams_enabled SET DEFAULT true;

-- 2) Backfill всех существующих туторов (идемпотентно).
UPDATE public.tutors
  SET feature_mock_exams_enabled = true
  WHERE feature_mock_exams_enabled IS DISTINCT FROM true;

COMMENT ON COLUMN public.tutors.feature_mock_exams_enabled IS
  'Per-tutor feature flag для mock-exams. DEFAULT true с 2026-06-26 (пилот завершён, открыто всем). Можно точечно выключить установкой false.';
