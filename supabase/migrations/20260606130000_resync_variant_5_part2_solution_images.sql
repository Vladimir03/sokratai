-- 2026-06-06 (item 5): attach reference-solution IMAGES to Часть 2 of variant 5
-- (физика ЕГЭ-2026, тренировочный вариант 5). Vladimir предоставил картинки из
-- исходного Word — по одному рисунку на задание:
--   KIM 21 — график цикла в координатах p–V (термодинамика, гелий).
--   KIM 23 — геометрия поля двух точечных зарядов (электростатика).
--   KIM 25 — ход лучей через рассеивающую линзу (оптика).
--   KIM 26 — схема сил на брусок и доску (динамика, трение).
-- KIM 22 и 24 картинок не имеют → их solution_image_urls остаётся NULL.
--
-- Storage convention (mirror task images, см. seed mock_exams_variant_5.sql):
--   storage://mock-exam-variant-tasks/variant5/<filename>
-- Dual-format `solution_image_urls` (rule 40): single ref для одного фото
-- (здесь у всех по одному). Read via parseAttachmentUrls на бэкенде
-- (student handleGetResult + tutor handleGetAttempt; видно post-submit, rule 45).
--
-- !!! ТРЕБУЕТСЯ ЗАГРУЗКА (Vladimir, Lovable Cloud Studio → Storage →
--     bucket `mock-exam-variant-tasks`, папка `variant5/`), ИМЕНА ТОЧНО:
--       solution-21-1.png  — график цикла p–V (KIM 21)
--       solution-23-1.png  — поле двух зарядов (KIM 23)
--       solution-25-1.png  — ход лучей, рассеивающая линза (KIM 25)
--       solution-26-1.png  — силы на брусок и доску (KIM 26)
--     До загрузки signed-URL резолв вернёт null → галерея просто не отрисуется
--     (graceful). После загрузки фото появятся у тутора и ученика автоматически.
--
-- IMPORTANT (rule 45): mock_exam_variant_tasks НЕ имеет колонки updated_at —
-- НЕ добавлять SET updated_at = now(). Idempotent (повторное применение = тот же
-- результат). solution_text / correct_answer / max_score НЕ трогаем.

BEGIN;

-- KIM 21 — одно фото (single ref, dual-format).
UPDATE public.mock_exam_variant_tasks
SET solution_image_urls =
  'storage://mock-exam-variant-tasks/variant5/solution-21-1.png'
WHERE id = 'cf09af0f-e797-5516-9237-3e5c0ba09285'::uuid;

-- KIM 23 — одно фото (single ref, dual-format).
UPDATE public.mock_exam_variant_tasks
SET solution_image_urls =
  'storage://mock-exam-variant-tasks/variant5/solution-23-1.png'
WHERE id = 'b1d54c12-5bd5-5f7c-bd38-d9c37e123330'::uuid;

-- KIM 25 — одно фото (single ref, dual-format).
UPDATE public.mock_exam_variant_tasks
SET solution_image_urls =
  'storage://mock-exam-variant-tasks/variant5/solution-25-1.png'
WHERE id = '788566ee-b291-5643-af38-b2e5dc857e5e'::uuid;

-- KIM 26 — одно фото (single ref, dual-format).
UPDATE public.mock_exam_variant_tasks
SET solution_image_urls =
  'storage://mock-exam-variant-tasks/variant5/solution-26-1.png'
WHERE id = '84e6761c-f24e-5044-b558-8f73aedc7087'::uuid;

COMMIT;

-- Validation:
-- SELECT kim_number, solution_image_urls FROM public.mock_exam_variant_tasks
--   WHERE variant_id = '03660fb4-5247-5376-a0e9-2eb5faae844e'
--     AND kim_number IN (21, 23, 25, 26) ORDER BY kim_number;
-- Expected: KIM 21/23/25/26 = single ref; KIM 22/24 остаются NULL.
