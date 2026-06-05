-- 2026-06-05 (item 5): attach reference-solution IMAGES to Часть 2 KIM 25/26 of
-- variant 1 (физика ЕГЭ-2026). Vladimir предоставил картинки из исходного Word:
--   KIM 25 — два рисунка хода лучей (solution_text просит «сделай два рисунка
--            хода лучей»: действительное + мнимое изображение, S1/S1' и S2/S2').
--   KIM 26 — рисунок сил на брусок + доску (solution_text просит «сделай
--            схематичный рисунок с указанием сил»).
--
-- Storage convention (mirror task images, см. seed mock_exams_variant_1.sql):
--   storage://mock-exam-variant-tasks/variant1/<filename>
-- Dual-format `solution_image_urls` (rule 40): JSON-array для 2+ фото, single
-- ref для одного. Read via parseAttachmentUrls на бэкенде (student + tutor).
--
-- !!! ТРЕБУЕТСЯ ЗАГРУЗКА (Vladimir, Lovable Cloud Studio → Storage →
--     bucket `mock-exam-variant-tasks`, папка `variant1/`), ИМЕНА ТОЧНО:
--       solution-25-1.png  — PNG 1 (ход лучей, источник S1: действительное)
--       solution-25-2.png  — PNG 2 (ход лучей, источник S2: мнимое)
--       solution-26-1.png  — PNG 3 (силы на брусок и доску)
--     До загрузки signed-URL резолв вернёт null → галерея просто не отрисуется
--     (graceful). После загрузки фото появятся у тутора и ученика автоматически.
--
-- IMPORTANT (rule 45): mock_exam_variant_tasks НЕ имеет колонки updated_at —
-- НЕ добавлять SET updated_at = now(). Idempotent (повторное применение = тот же
-- результат). solution_text НЕ трогаем (зафиксирован в 20260516120000).

BEGIN;

-- KIM 25 — два фото (JSON-array, dual-format).
UPDATE public.mock_exam_variant_tasks
SET solution_image_urls =
  '["storage://mock-exam-variant-tasks/variant1/solution-25-1.png","storage://mock-exam-variant-tasks/variant1/solution-25-2.png"]'
WHERE id = 'e9fd88a9-0969-5419-a9c5-012e506682e2'::uuid;

-- KIM 26 — одно фото (single ref, dual-format).
UPDATE public.mock_exam_variant_tasks
SET solution_image_urls =
  'storage://mock-exam-variant-tasks/variant1/solution-26-1.png'
WHERE id = '6f2508b7-6902-567c-9b0f-2afe0b0ea796'::uuid;

COMMIT;

-- Validation:
-- SELECT kim_number, solution_image_urls FROM public.mock_exam_variant_tasks
--   WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131'
--     AND kim_number IN (25, 26) ORDER BY kim_number;
-- Expected: KIM 25 = JSON-array из 2 refs; KIM 26 = single ref.
