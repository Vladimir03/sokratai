-- Mock Exams — column-GRANT для «Блоков заданий» (20260801100000)
-- ---------------------------------------------------------------------------
-- Продолжение инварианта 20260731190000: table-level SELECT на
-- mock_exam_variants отозван, доступ authenticated идёт строго по whitelist.
-- Каждая НОВАЯ колонка требует явного решения — вот оно:
--
--   task_blocks_json        → STUDENT-SAFE. Это УСЛОВИЕ: название блока,
--     текст-инструкция («Vous allez entendre…»), фото документа, storage://ref
--     аудиотрека. Ученик обязан это видеть во время экзамена. Ref в приватном
--     бакете сам по себе не даёт доступа — файл открывается только подписанным
--     URL из service_role edge.
--
--   block_transcripts_json  → TUTOR-ONLY, НЕ ГРАНИТСЯ. Транскрипт трека = ответы
--     аудирования (leak-класс solution_text, rule 45). У назначенного ученика
--     ЕСТЬ row-SELECT строки варианта (политика «Mock variants student read
--     assigned»), поэтому без column-GRANT-whitelist он читал бы транскрипт
--     прямым PostgREST ПОСРЕДИ экзамена. RLS фильтрует СТРОКИ, не колонки.
--
-- GRANT выдаётся ЯВНЫМ полным списком, а не «добавь одну колонку»: так список
-- в миграции остаётся самодокументируемым контрактом того, что видит клиент.
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
  listening_audio_url,
  task_blocks_json
) ON public.mock_exam_variants TO authenticated;

-- Validation:
-- SELECT column_name FROM information_schema.column_privileges
--   WHERE table_name = 'mock_exam_variants' AND grantee = 'authenticated'
--   ORDER BY column_name;
-- Expected: 17 строк, task_blocks_json ЕСТЬ,
--           listening_transcript и block_transcripts_json ОТСУТСТВУЮТ.
