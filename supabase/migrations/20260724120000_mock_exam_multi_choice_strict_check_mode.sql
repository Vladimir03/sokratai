-- ============================================================
-- Новый режим проверки Части 1: multi_choice_strict (обществознание ЕГЭ)
-- ============================================================
-- Репорт Милады (модератор-обществовед, 2026-07-23): в задании с выбором
-- нескольких верных эталон «135», ответ ученика «123» система оценила в 1 балл,
-- а по критериям ФИПИ обществознания это 0.
--
-- Критерий обществознания: «1 балл — если указан ОДИН лишний элемент наряду со
-- всеми верными ЛИБО не указан ровно ОДИН из верных (лишних нет). Если
-- одновременно есть и лишний, и недостающий (ЗАМЕНА цифры) — 0. Две и более
-- ошибок — 0.»
--
-- Существующий `multi_choice` (физика КИМ 5/9/14/18) ЗАМЕНУ засчитывает: у
-- ФИПИ-ФИЗИКИ явный критерий «1 балл, если только один из символов не
-- соответствует эталону». У каждого предмета СВОИ критерии (решение владельца
-- 2026-07-22) → новый режим, физика байт-в-байт не тронута.
--
-- Семантика multi_choice_strict (множества):
--   missing = |C \ S|, extra = |S \ C|
--   (0,0) → max; (1,0) или (0,1) → 1 (при max ≥ 2); иначе → 0
-- Реализация — оба зеркала чекера (rule 45 Deno-mirror invariant):
--   src/lib/mockExamPart1Checker.ts + supabase/functions/_shared/mock-exam-part1-checker.ts
--
-- Здесь — расширение ДВУХ CHECK-констрейнтов mock_exam_variant_tasks
-- (зеркало миграции 20260723100000 для ordered_lenient).
-- Additive: старые значения остаются валидными, данные не трогаем.

BEGIN;

-- 1. Снять существующие check_mode-констрейнты (имена могут отличаться между
--    средами — ищем по определению).
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

-- 2. Вернуть оба CHECK с multi_choice_strict в списке.
ALTER TABLE public.mock_exam_variant_tasks
  ADD CONSTRAINT mock_exam_variant_tasks_check_mode_check CHECK (
    check_mode IS NULL OR check_mode IN (
      'strict', 'ordered', 'ordered_lenient', 'unordered', 'multi_choice',
      'multi_choice_strict', 'task20', 'pair', 'manual'
    )
  );

ALTER TABLE public.mock_exam_variant_tasks
  ADD CONSTRAINT mock_exam_variant_tasks_part1_needs_check_mode CHECK (
    part = 2 OR check_mode IN (
      'strict', 'ordered', 'ordered_lenient', 'unordered', 'multi_choice',
      'multi_choice_strict', 'task20', 'pair'
    )
  );

COMMENT ON COLUMN public.mock_exam_variant_tasks.check_mode IS
  'strict — точное совпадение. ordered — последовательность через запятую (физика: длина ≠ → 0). ordered_lenient — последовательность, 1 ошибка/лишняя/недостающая позиция = 1 балл (обществознание № 6/13/15). multi_choice — несколько вариантов, ЗАМЕНА = 1 балл (физика КИМ 5/9/14/18). multi_choice_strict — несколько вариантов по критериям обществознания: 1 балл только за один лишний ИЛИ один недостающий, замена → 0. task20 — набор цифр, порядок неважен, всё-или-ничего. pair — пара значение/единица. manual — оценивает tutor (Часть 2).';

COMMIT;
