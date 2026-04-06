-- Seed check_format for existing kb_tasks based on kim_number
-- KIM 21-26 require detailed solutions; others accept short answers

UPDATE kb_tasks
SET check_format = CASE
  WHEN kim_number >= 21 AND kim_number <= 26 THEN 'detailed_solution'
  ELSE 'short_answer'
END
WHERE kim_number IS NOT NULL AND check_format IS NULL;
