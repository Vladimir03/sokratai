-- Mock Exams — column-GRANT whitelist на mock_exam_variants (P0 hotfix аудирования)
-- ---------------------------------------------------------------------------
-- Дыра (найдена pre-review 2026-07-31, введена миграцией 20260731180000):
--   - 20260508120000:634 — GRANT SELECT ON mock_exam_variants TO authenticated
--     (TABLE-level, все колонки);
--   - 20260720170000 — политика «Mock variants student read assigned» даёт
--     назначенному ученику row-SELECT строки варианта (метаданные «Мои пробники»).
--   ⇒ После добавления listening_transcript назначенный ученик мог ПОСРЕДИ
--   экзамена прочитать транскрипт (= ответы аудирования) прямым PostgREST из
--   консоли: from('mock_exam_variants').select('listening_transcript').
--   Класс rule 40 «Anti-leak слой 2»: RLS фильтрует СТРОКИ, не колонки —
--   единственная защита от прямого PostgREST это column-GRANT whitelist
--   (зеркало 20260516120100 на homework_tutor_task_states).
--
-- Фикс: REVOKE table-SELECT → GRANT SELECT по whitelist ВСЕХ колонок, кроме
-- listening_transcript. Транскрипт читают:
--   - ученик: ТОЛЬКО post-submit через service_role edge (result-эндпоинт);
--   - репетитор (prefill редактора): новый GET /variants/:id/listening в
--     mock-exam-tutor-api (service_role, owner-гейт) — колонка НЕ грантится
--     authenticated вообще (у роли нет tutor/student различия на уровне GRANT).
--
-- ⚠️ Каждая НОВАЯ колонка mock_exam_variants теперь требует явного решения:
-- student-safe → добавить в GRANT-лист миграцией; tutor-only → НЕ добавлять.
-- `*`-select для authenticated заблокирован навсегда (паттерн rule 40).
--
-- Клиентские select'ы сверены (whitelist-совместимы):
--   - useMockExamVariants (listening_transcript УБРАН из select тем же коммитом)
--   - MockExamVariantPreviewSheet (explicit columns, не задет)
-- Idempotent.

REVOKE SELECT ON public.mock_exam_variants FROM anon, authenticated;

GRANT SELECT (
  id,
  title,
  exam_type,
  source,
  source_attribution,
  duration_minutes,
  total_max_score,
  part1_max,
  part2_max,
  task_count,
  created_by,
  created_at,
  variant_pdf_url,
  owner_id,
  subject,
  listening_audio_url
) ON public.mock_exam_variants TO authenticated;

COMMENT ON COLUMN public.mock_exam_variants.listening_transcript IS
  'Транскрипт трека аудирования (ручной ввод, v1). ANTI-LEAK (rule 45): = ответы аудирования. Column-GRANT REVOKED от authenticated (20260731190000) — прямой PostgREST не читает НИ ПРИ КАКОМ RLS-row-доступе. Ученик: только post-submit через service_role result-эндпоинт. Репетитор: GET /variants/:id/listening (mock-exam-tutor-api, owner-гейт).';

-- Validation:
-- SELECT column_name, privilege_type FROM information_schema.column_privileges
--   WHERE table_name = 'mock_exam_variants' AND grantee = 'authenticated';
-- Expected: 16 строк SELECT, БЕЗ listening_transcript.
--
-- Проба под student JWT (ожидаем permission denied / column error):
--   supabase.from('mock_exam_variants').select('listening_transcript')
