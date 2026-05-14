-- Mock Exams v1 — service_role GRANT для invite links + anonymous leads
-- ----------------------------------------------------------------------
-- TASK-11 review fix (Vladimir QA 2026-05-14):
-- Edge function `mock-exam-tutor-api::handleListInviteLinks` под `service_role`
-- получала Postgres grant denial при SELECT на `mock_exam_public_links` →
-- HTTP 500 → frontend `MockExamInviteLinksSection` вечно показывал
-- «Не удалось загрузить ссылки. Повторить» для любого ассигнмента
-- (включая новые без ссылок).
--
-- Root cause: схема `20260508120000_mock_exams_v1_schema.sql:631-641` выдала
-- GRANT'ы только `authenticated`-роли. service_role в Supabase должен
-- иметь явный GRANT на каждую таблицу созданную после первичной project setup
-- (default-acl на public schema, выставленный при project create, не
-- покрывает таблицы созданные позже миграциями).
--
-- Также превентивно добавлены GRANT'ы для всех остальных mock-exam v1
-- таблиц — edge functions используют service_role для bypass RLS, и
-- любая из них может молча упасть с denied permission в будущем.
--
-- Idempotent: повторное применение GRANT — no-op.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_public_links TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_anonymous_leads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_variants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_variant_tasks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_assignments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_attempts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_attempt_part1_answers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_attempt_part2_solutions TO service_role;

COMMIT;

-- Validation:
-- SELECT grantee, table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND grantee = 'service_role'
--   AND table_name LIKE 'mock_exam_%'
-- ORDER BY table_name, privilege_type;
-- Expected: 32 rows (8 tables × 4 privileges each).
