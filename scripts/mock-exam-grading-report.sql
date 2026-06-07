-- ============================================================================
-- Mock Exam Grading Report — диагностика проверки Часть 2 (ЕГЭ-физика пилот)
-- ============================================================================
-- Назначение: измерять точность AI-проверки Часть 2 ПРОТИВ финального балла
-- репетитора и причины «пасов» (когда AI не ставит балл). Используется как
-- before/after метрика для фичи docs/delivery/features/mock-exam-grading-v2/spec.md.
--
-- Как запускать: вставить блок в SQL-редактор Lovable Cloud / Supabase.
--   READ-ONLY. Никаких write-операций, миграций, изменений RLS. Запускать
--   запросы по одному (A..F).
--
-- Ключевые таблицы:
--   mock_exam_attempt_part2_solutions  -- PK (attempt_id, kim_number)
--       ai_draft_json->>'suggested_score'  = балл AI (null = «пас»)
--       ai_draft_json->>'confidence'       = low|medium|high
--       ai_draft_json->'flags'             = массив сигналов (photo_missing, awaiting_regrade, ...)
--       tutor_score                        = финальный балл репетитора
--       status                             = awaiting_review | tutor_approved | tutor_modified
--   mock_exam_attempts(part2_bulk_photo_urls, assignment_id, status)
--   mock_exam_assignments(variant_id)
--   mock_exam_variant_tasks(variant_id, kim_number, part, max_score)
--
-- Фильтр «ground truth» везде: status IN ('tutor_approved','tutor_modified')
--   = задачи, по которым репетитор реально вынес решение.
--
-- Если упадёт на ::numeric — в каком-то ai_draft_json suggested_score не число;
--   добавь в WHERE: AND sol.ai_draft_json->>'suggested_score' ~ '^-?[0-9.]+$'
--
-- ----------------------------------------------------------------------------
-- BASELINE (2026-06-07, n=107):
--   A: оценённых 52 → correction_pct=2%, mae=0.02, bias=-0.02 (только КИМ25 1/11)
--   B: все 52 оценённых = confidence 'high' (спектра нет)
--   C/D/E: пасов 55/107; photo_missing=29, awaiting_regrade=20, kim21_qualitative=7,
--          photo_off_topic=5; attempt_had_photos=47, tutor_gave_points=14, tutor_gave_zero=41
-- ============================================================================


-- A. Точность по каждому КИМ Часть 2 + итог (ROLLUP) -------------------------
--    bias = AVG(tutor - ai):  + => AI ЗАНИЖАЕТ (тутор добавляет)
--                             - => AI ЗАВЫШАЕТ (опаснее при rubber-stamp)
--    correction_pct = доля задач, где |tutor - ai| > 0.5
SELECT
  sol.kim_number,
  COUNT(*)                                                                                 AS n,
  ROUND(AVG(t.max_score), 1)                                                               AS max_ball,
  ROUND(AVG(sol.tutor_score - (sol.ai_draft_json->>'suggested_score')::numeric), 2)        AS bias,
  ROUND(AVG(ABS(sol.tutor_score - (sol.ai_draft_json->>'suggested_score')::numeric)), 2)   AS mae,
  ROUND(100.0 * AVG((ABS(sol.tutor_score - (sol.ai_draft_json->>'suggested_score')::numeric) > 0.5)::int), 0) AS correction_pct
FROM mock_exam_attempt_part2_solutions sol
JOIN mock_exam_attempts      a   ON a.id   = sol.attempt_id
JOIN mock_exam_assignments   asg ON asg.id = a.assignment_id
JOIN mock_exam_variant_tasks t   ON t.variant_id = asg.variant_id
                                AND t.kim_number = sol.kim_number
                                AND t.part = 2
WHERE sol.status IN ('tutor_approved', 'tutor_modified')
  AND sol.tutor_score IS NOT NULL
  AND sol.ai_draft_json->>'suggested_score' IS NOT NULL
GROUP BY ROLLUP (sol.kim_number)
ORDER BY sol.kim_number NULLS LAST;


-- B. Калибровка уверенности (работает ли триаж по confidence?) ---------------
--    Если у 'high' и 'low' ошибка близка — confidence бесполезен для триажа.
SELECT
  COALESCE(sol.ai_draft_json->>'confidence', '(нет)')                                      AS confidence,
  COUNT(*)                                                                                 AS n,
  ROUND(AVG(ABS(sol.tutor_score - (sol.ai_draft_json->>'suggested_score')::numeric)), 2)   AS mae,
  ROUND(100.0 * AVG((ABS(sol.tutor_score - (sol.ai_draft_json->>'suggested_score')::numeric) > 0.5)::int), 0) AS correction_pct
FROM mock_exam_attempt_part2_solutions sol
WHERE sol.status IN ('tutor_approved', 'tutor_modified')
  AND sol.tutor_score IS NOT NULL
  AND sol.ai_draft_json->>'suggested_score' IS NOT NULL
GROUP BY sol.ai_draft_json->>'confidence'
ORDER BY CASE sol.ai_draft_json->>'confidence'
           WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END;


-- C. Чтение фото vs грейдинг (приоритет №1) ----------------------------------
--    n_photo_flags = AI пожаловался на фото; n_ai_punted = AI не поставил балл.
SELECT
  sol.kim_number,
  COUNT(*)                                                                          AS n_reviewed,
  SUM((jsonb_array_length(COALESCE(sol.ai_draft_json->'flags', '[]'::jsonb)) > 0)::int) AS n_photo_flags,
  SUM((sol.ai_draft_json->>'suggested_score' IS NULL)::int)                         AS n_ai_punted
FROM mock_exam_attempt_part2_solutions sol
WHERE sol.status IN ('tutor_approved', 'tutor_modified')
GROUP BY ROLLUP (sol.kim_number)
ORDER BY sol.kim_number NULLS LAST;


-- D. Диагноз пасов (почему AI не поставил балл) ------------------------------
--    tutor_gave_points = ответ был и читаем ⇒ AI ЗРЯ спасовал (восстановимо)
--    attempt_had_photos = в пакете попытки фото были (но не доехали до задачи)
SELECT
  COUNT(*)                                                                              AS n_punts,
  SUM((a.part2_bulk_photo_urls IS NOT NULL AND length(a.part2_bulk_photo_urls) > 2)::int) AS attempt_had_photos,
  SUM((COALESCE(sol.tutor_score, 0) > 0)::int)                                          AS tutor_gave_points,
  SUM((COALESCE(sol.tutor_score, 0) = 0)::int)                                          AS tutor_gave_zero
FROM mock_exam_attempt_part2_solutions sol
JOIN mock_exam_attempts a ON a.id = sol.attempt_id
WHERE sol.status IN ('tutor_approved', 'tutor_modified')
  AND sol.ai_draft_json->>'suggested_score' IS NULL;


-- E. Какие именно флаги ставит AI при пасе -----------------------------------
--    (строка паса может нести несколько флагов → сумма n > числа пасов)
SELECT
  flag,
  COUNT(*) AS n
FROM mock_exam_attempt_part2_solutions sol
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(sol.ai_draft_json->'flags', '[]'::jsonb)) AS flag
WHERE sol.status IN ('tutor_approved', 'tutor_modified')
  AND sol.ai_draft_json->>'suggested_score' IS NULL
GROUP BY flag
ORDER BY n DESC;


-- F. Пасы по причине × восстановимость (что чинить первым) --------------------
--    recoverable = тутор поставил >0 ⇒ ответ был ⇒ AI зря спасовал.
SELECT
  CASE
    WHEN sol.ai_draft_json->'flags' @> '["awaiting_regrade"]' THEN 'awaiting_regrade (тутор переназначил, AI не пересчитал)'
    WHEN sol.ai_draft_json->'flags' @> '["photo_missing"]'    THEN 'photo_missing (фото не привязано к задаче)'
    WHEN sol.ai_draft_json->'flags' @> '["photo_off_topic"]'  THEN 'photo_off_topic (фото не от той задачи)'
    ELSE 'other'
  END                                                                                   AS reason,
  COUNT(*)                                                                              AS n_punts,
  SUM((COALESCE(sol.tutor_score, 0) > 0)::int)                                          AS recoverable,
  SUM((a.part2_bulk_photo_urls IS NOT NULL AND length(a.part2_bulk_photo_urls) > 2)::int) AS attempt_had_photos
FROM mock_exam_attempt_part2_solutions sol
JOIN mock_exam_attempts a ON a.id = sol.attempt_id
WHERE sol.status IN ('tutor_approved', 'tutor_modified')
  AND sol.ai_draft_json->>'suggested_score' IS NULL
GROUP BY 1
ORDER BY n_punts DESC;
