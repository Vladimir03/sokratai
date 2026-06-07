-- 2026-06-07: прикрепляем PDF с заданиями к Тренировочному варианту 5 (физика
-- ЕГЭ-2026). Раньше V5 был seed'нут без `variant_pdf_url` (form-режим только,
-- т.к. собран из разных вариантов) — Vladimir подготовил единый PDF, добавляем.
--
-- Контракт (mirror вариантов 1 и 2 — `20260515125623` / `20260521151352`):
--   * Bucket `mock-exam-variant-pdfs` — ПУБЛИЧНЫЙ. Файл лежит в корне бакета:
--       variant5-tasks.pdf  (как variant1-tasks.pdf / variant2-tasks.pdf).
--   * `variant_pdf_url` хранит ПРЯМОЙ public URL с host `*.supabase.co` —
--     это ДОКУМЕНТИРОВАННОЕ исключение (rule 95): backend
--     `mock-exam-student-api::handleGetStudentAssignment` оборачивает его в
--     `rewriteToProxy()` на чтении → ученик в РФ получает `api.sokratai.ru`.
--     Поэтому supabase.co здесь не нарушение RU-bypass, а established pattern.
--   * Frontend (`StudentMockExam.tsx`) сам покажет кнопку «Скачать задачи (PDF)»,
--     если поле непусто — изменений в коде не требуется.
--
-- ⚠️ ANTI-LEAK (rule 45): PDF ОБЯЗАН содержать ТОЛЬКО страницы с условиями
-- заданий. Страницы с ответами Части 1 / критериями Части 2 НЕ должны попасть
-- в файл (бакет публичный — утечёт ученикам). Перед загрузкой провизуально
-- проверить КАЖДУЮ страницу.
--
-- Идемпотентно. До загрузки файла URL вернёт 404 — кнопка просто откроет пустую
-- вкладку; после загрузки заработает автоматически.

UPDATE public.mock_exam_variants
SET variant_pdf_url = 'https://vrsseotrfmsxpbciyqzc.supabase.co/storage/v1/object/public/mock-exam-variant-pdfs/variant5-tasks.pdf'
WHERE id = '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid;

-- Validation:
-- SELECT id, title, variant_pdf_url FROM public.mock_exam_variants
--   WHERE id = '03660fb4-5247-5376-a0e9-2eb5faae844e';
