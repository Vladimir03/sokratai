-- 2026-06-05 (item 5): reference-solution images for Часть 2 (mock exams).
--
-- Tutor + student see the эталонное решение for Part 2 tasks (21-26). Today
-- `mock_exam_variant_tasks.solution_text` is TEXT-only; the source Word file has
-- diagrams/figures that belong with the solution. Add an images column.
--
-- Dual-format TEXT (mirror homework `homework_tutor_tasks.solution_image_urls`,
-- rule 40): a single "storage://bucket/path" ref OR a JSON-array of refs.
-- Read/write only via parseAttachmentUrls / serializeAttachmentUrls.
--
-- Content (Vladimir, manual): images live in bucket `mock-exam-variant-tasks/
-- variant1/`; a follow-up resync migration UPDATEs solution_image_urls per KIM.
-- Visibility: revealed to the student post-submit (item 2) AND to the tutor —
-- this is INTENTIONAL for mock exams (one-shot exam; the эталон is the value).
-- Contrast homework, where solution_image_urls is tutor-only forever.
--
-- Additive; no backfill.

ALTER TABLE public.mock_exam_variant_tasks
  ADD COLUMN IF NOT EXISTS solution_image_urls TEXT NULL;

COMMENT ON COLUMN public.mock_exam_variant_tasks.solution_image_urls IS
  '2026-06-05 (item 5): фото эталонного решения Часть 2. Dual-format TEXT: single "storage://..." ref ИЛИ JSON-array. Видно тутору + ученику (post-submit, mock-exam — НЕ как homework). Read via parseAttachmentUrls.';
