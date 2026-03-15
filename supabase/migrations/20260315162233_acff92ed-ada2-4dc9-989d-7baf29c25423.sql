ALTER TABLE kb_tasks
  ADD COLUMN IF NOT EXISTS primary_score smallint;

COMMENT ON COLUMN kb_tasks.primary_score IS 'Первичный балл за задачу (ЕГЭ/ОГЭ)';