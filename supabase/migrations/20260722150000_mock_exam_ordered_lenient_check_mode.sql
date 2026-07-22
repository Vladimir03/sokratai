-- ============================================================
-- Новый режим проверки Части 1: ordered_lenient (обществознание ЕГЭ № 6/13/15)
-- ============================================================
-- Репорт Милады (модератор-обществовед, 2026-07-22): по критериям ФИПИ
-- обществознания в заданиях-последовательностях № 6, 13, 15 «одна ошибка
-- (неверный символ, ЛИШНЯЯ или НЕДОСТАЮЩАЯ позиция) — 1 балл; две и более — 0;
-- цифры верны, но не в той последовательности — 0».
--
-- Существующий `ordered` (физика КИМ 6/10/15/17) — Hamming: длина ≠ → 0, потому
-- что у ФИПИ-ФИЗИКИ явный критерий «если количество символов в ответе больше
-- требуемого, выставляется 0 баллов». У каждого предмета СВОИ критерии (решение
-- владельца 2026-07-22) → новый режим, физика байт-в-байт не тронута.
--
-- Семантика ordered_lenient (Левенштейн): dist 0 → max; dist 1 → 1 (при max ≥ 2);
-- dist ≥ 2 → 0. Реализация — оба зеркала чекера (rule 45 Deno-mirror invariant):
--   src/lib/mockExamPart1Checker.ts + supabase/functions/_shared/mock-exam-part1-checker.ts
--
-- Здесь — расширение ДВУХ CHECK-констрейнтов mock_exam_variant_tasks:
--   1) анонимный column-CHECK со списком режимов (имя авто-генерённое);
--   2) mock_exam_variant_tasks_part1_needs_check_mode (part=1 → режим из списка).
-- Additive: старые значения остаются валидными, данные не трогаем.

BEGIN;

-- 1. Снять анонимный column-CHECK (авто-имя может отличаться между средами —
--    ищем по определению) + именованный part1-CHECK.
DO $$
DECLARE
  _con RECORD;
BEGIN
  FOR _con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.mock_exam_variant_tasks'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%check_mode%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.mock_exam_variant_tasks DROP CONSTRAINT %I',
      _con.conname
    );
  END LOOP;
END $$;

-- 2. Вернуть оба CHECK с ordered_lenient в списке (теперь именованные).
ALTER TABLE public.mock_exam_variant_tasks
  ADD CONSTRAINT mock_exam_variant_tasks_check_mode_check CHECK (
    check_mode IS NULL OR check_mode IN (
      'strict', 'ordered', 'ordered_lenient', 'unordered', 'multi_choice',
      'task20', 'pair', 'manual'
    )
  );

ALTER TABLE public.mock_exam_variant_tasks
  ADD CONSTRAINT mock_exam_variant_tasks_part1_needs_check_mode CHECK (
    part = 2 OR check_mode IN (
      'strict', 'ordered', 'ordered_lenient', 'unordered', 'multi_choice',
      'task20', 'pair'
    )
  );

COMMENT ON COLUMN public.mock_exam_variant_tasks.check_mode IS
  'strict — точное совпадение. ordered — последовательность через запятую (физика: длина ≠ → 0). ordered_lenient — последовательность, 1 ошибка/лишняя/недостающая позиция = 1 балл (обществознание № 6/13/15). unordered — множество без порядка. multi_choice — несколько вариантов (1 ошибка = 1 балл). task20 — набор цифр, порядок неважен, всё-или-ничего. pair — пара значение/единица. manual — оценивает tutor (Часть 2).';

COMMIT;
