-- =====================================================
-- Помечаем задачи для диагностики
-- Выбираем по 1-2 задачи на каждый номер ЕГЭ (1-12)
-- средней сложности для объективной оценки
-- =====================================================

-- Помечаем задачи для диагностики (выбираем первые подходящие по каждому номеру)
-- Это временное решение - позже можно выбрать конкретные калиброванные задачи

WITH diagnostic_selection AS (
  SELECT 
    id,
    ege_number,
    ROW_NUMBER() OVER (PARTITION BY ege_number ORDER BY created_at) as rn
  FROM ege_problems
  WHERE is_active = true
    AND ege_number BETWEEN 1 AND 12
    AND difficulty = 2  -- Средняя сложность
)
UPDATE ege_problems
SET is_diagnostic = true
WHERE id IN (
  SELECT id 
  FROM diagnostic_selection 
  WHERE rn <= 2  -- По 2 задачи на номер
);

-- Если мало задач средней сложности, добавляем задачи любой сложности
WITH additional_selection AS (
  SELECT 
    ep.id,
    ep.ege_number,
    ROW_NUMBER() OVER (PARTITION BY ep.ege_number ORDER BY ep.created_at) as rn
  FROM ege_problems ep
  LEFT JOIN (
    SELECT ege_number, COUNT(*) as cnt 
    FROM ege_problems 
    WHERE is_diagnostic = true 
    GROUP BY ege_number
  ) diag ON ep.ege_number = diag.ege_number
  WHERE ep.is_active = true
    AND ep.ege_number BETWEEN 1 AND 12
    AND ep.is_diagnostic = false
    AND (diag.cnt IS NULL OR diag.cnt < 1)  -- Номера без диагностических задач
)
UPDATE ege_problems
SET is_diagnostic = true
WHERE id IN (
  SELECT id 
  FROM additional_selection 
  WHERE rn <= 2
);

-- Проверяем результат
DO $$
DECLARE
  total_diagnostic INT;
  numbers_covered INT;
BEGIN
  SELECT COUNT(*) INTO total_diagnostic 
  FROM ege_problems WHERE is_diagnostic = true;
  
  SELECT COUNT(DISTINCT ege_number) INTO numbers_covered 
  FROM ege_problems WHERE is_diagnostic = true;
  
  RAISE NOTICE 'Diagnostic problems: %, Numbers covered: %', total_diagnostic, numbers_covered;
END $$;

